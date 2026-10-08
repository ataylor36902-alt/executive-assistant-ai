import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  failedReport, parseNightlyReport, renderNightlyReport, validateNightlyEnvironment,
  type NightlyReport,
} from "./credits-nightly-report";

type RunnerConnector = Pick<ReplitConnectors, "proxy">;

export interface NightlyRunnerDependencies {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  spawnProcess?: typeof spawn;
  createConnectors?: () => RunnerConnector;
  log?: (message: string) => void;
  error?: (message: string) => void;
  maxRuntimeMs?: number;
  mailTimeoutMs?: number;
  exit?: (code: number) => void;
}

const maxOutputBytes = 8 * 1024 * 1024;

async function check(
  env: NodeJS.ProcessEnv,
  spawnProcess: typeof spawn,
  maxRuntimeMs: number,
): Promise<NightlyReport> {
  if (!validateNightlyEnvironment(env)) return failedReport("configuration");
  return new Promise((resolve) => {
    const child = spawnProcess(process.execPath, [
      "--import", "tsx", fileURLToPath(new URL("./reconcile-classscribe-credits.ts", import.meta.url)),
    ], {
      env: {
        ...env,
        // A separate project gets its own managed DATABASE_URL. Never use
        // that implicit connection to check the original published app.
        DATABASE_URL: env.CREDITS_RECONCILIATION_DATABASE_URL,
        // App tables, migration control, and ledger must remain read-only.
        PGOPTIONS: `${env.PGOPTIONS ?? ""} -c default_transaction_read_only=on -c statement_timeout=120000`,
        CREDITS_RECONCILIATION_READ_ONLY_REQUIRED: "1",
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    let bytes = 0;
    let timedOut = false;
    let oversized = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, maxRuntimeMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxOutputBytes) {
        if (!oversized) { oversized = true; stop(); }
        return;
      }
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(failedReport("check_failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(timedOut ? failedReport("timeout") :
        oversized ? failedReport("invalid_report") : parseNightlyReport(stdout, code));
    });
  });
}

async function notify(
  report: NightlyReport,
  testDelivery: boolean,
  env: NodeJS.ProcessEnv,
  createConnectors: () => RunnerConnector,
): Promise<boolean> {
  // No implicit support-address fallback: the owner must approve a recipient.
  const recipient = env.CREDITS_RECONCILIATION_OWNER_EMAIL ?? "";
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) return false;
  const connectors = createConnectors();
  const profileResponse = await connectors.proxy("google-mail", "/gmail/v1/users/me/profile", { method: "GET" });
  if (!profileResponse.ok) return false;
  const profile = await profileResponse.json() as { emailAddress?: unknown };
  if (typeof profile.emailAddress !== "string" ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(profile.emailAddress)) return false;
  const subject = testDelivery ? "ClassScribe credit check delivery test" :
    `ClassScribe credit check: ${report.status === "failed" ? "FAILED RUN" : "OWNER REVIEW REQUIRED"}`;
  const mime = [
    `From: ClassScribe Billing <${profile.emailAddress}>`, `To: <${recipient}>`,
    `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64", "",
    Buffer.from(renderNightlyReport(report, testDelivery)).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "",
  ].join("\r\n");
  // No retries: an unknown response may already have sent this email.
  const response = await connectors.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }),
  });
  if (!response.ok) return false;
  const sent = await response.json() as { id?: unknown };
  if (typeof sent.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(sent.id)) return false;
  // Read back sender-side acceptance; inbox receipt is a separate owner check.
  const readback = await connectors.proxy("google-mail",
    `/gmail/v1/users/me/messages/${encodeURIComponent(sent.id)}?format=minimal`, { method: "GET" });
  if (!readback.ok) return false;
  const message = await readback.json() as { id?: unknown; labelIds?: unknown };
  return message.id === sent.id && Array.isArray(message.labelIds) && message.labelIds.includes("SENT");
}

export async function runNightlyCredits(dependencies: NightlyRunnerDependencies = {}): Promise<number> {
  const env = dependencies.env ?? process.env;
  const argv = dependencies.argv ?? process.argv.slice(2);
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const createConnectors = dependencies.createConnectors ?? (() => new ReplitConnectors());
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;
  const maxRuntimeMs = dependencies.maxRuntimeMs ?? 45 * 60 * 1000;
  const mailTimeoutMs = dependencies.mailTimeoutMs ?? 60_000;
  const exit = dependencies.exit ?? ((code: number) => process.exit(code));

  // Block every external operation, including delivery tests and
  // configuration-failure emails, until activation is explicitly approved.
  if (env.CREDITS_RECONCILIATION_EXECUTION_ENABLED !== "1") {
    error(JSON.stringify({
      status: "blocked",
      reason: "owner_activation_required",
      writes: 0,
      notification: "not_attempted",
    }));
    return 1;
  }

  const testDelivery = argv.includes("--test-delivery");
  const report = testDelivery ? failedReport("configuration") :
    await check(env, spawnProcess, maxRuntimeMs).catch(() => failedReport("check_failed"));
  log(JSON.stringify(report));
  if (testDelivery || report.status === "mismatch" || report.status === "failed") {
    const mailTimeout = setTimeout(() => {
      error(JSON.stringify({ notification: "failed_or_unknown", reason: "notification_timeout" }));
      exit(3);
    }, mailTimeoutMs);
    const accepted = await notify(report, testDelivery, env, createConnectors).catch(() => false);
    clearTimeout(mailTimeout);
    log(JSON.stringify({
      notification: accepted ? "provider_accepted_sent_copy_verified" : "failed_or_unknown",
      recipientReceiptVerified: false,
    }));
    return !accepted ? 3 : testDelivery ? 0 : report.status === "mismatch" ? 2 : 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await runNightlyCredits();
}
