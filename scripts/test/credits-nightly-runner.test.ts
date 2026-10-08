import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import {
  runNightlyCredits,
  type NightlyRunnerDependencies,
} from "../src/run-nightly-classscribe-credits";

const libraryHash = "a".repeat(64);

function reconciliationOutput(status: "verified" | "mismatch" | "maintenance" = "verified") {
  if (status === "maintenance") {
    return JSON.stringify({ status: "maintenance", reconciled: false, writes: 0 });
  }
  const mismatch = status === "mismatch";
  return JSON.stringify({
    status,
    activeCurrency: "CREDITS",
    serverSubscriptionGrantReady: true,
    writesOrAutomaticFixes: 0,
    libraryIdentifiersHashed: true,
    mismatchCount: mismatch ? 1 : 0,
    untrackedNonzeroCustomerCount: 0,
    ambiguousCustomerMappingCount: 0,
    uncertainAdjustmentCount: 0,
    mismatches: mismatch ? [{
      libraryHash, providerCredits: 9, expectedCredits: 10, providerCrd: 0,
      privateToken: "PRIVATE_TOKEN",
    }] : [],
    uncertainAdjustments: [],
    privateCustomerData: "PRIVATE_CUSTOMER",
  });
}

function offlineEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  // Passed only to runNightlyCredits; the real process environment is untouched.
  return {
    NODE_ENV: "production",
    CREDITS_RECONCILIATION_DATABASE_VERIFIED: "classscribe-production",
    CREDITS_RECONCILIATION_DATABASE_URL: "offline-fixture://database",
    REVENUECAT_PROJECT_ID: "projeea12cdc",
    REVENUECAT_CREDITS_API_KEY: "offline-fixture-only",
    CREDITS_RECONCILIATION_OWNER_EMAIL: "owner@example.com",
    CREDITS_RECONCILIATION_EXECUTION_ENABLED: "1",
    ...overrides,
  };
}

function mockedSpawn(options: {
  output?: string;
  exitCode?: number | null;
  waitForTimeout?: boolean;
  calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }>;
}): NightlyRunnerDependencies["spawnProcess"] {
  return ((command: string, args: readonly string[] = [], childOptions: { env?: NodeJS.ProcessEnv } = {}) => {
    options.calls.push({ command, args, env: childOptions.env ?? {} });
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      kill: (signal?: string) => boolean;
    };
    child.stdout = new PassThrough();
    child.kill = (signal) => {
      if (signal === "SIGTERM") queueMicrotask(() => child.emit("close", null));
      return true;
    };
    if (!options.waitForTimeout) {
      setImmediate(() => {
        if (options.output !== undefined) child.stdout.end(options.output);
        else child.stdout.end();
        child.emit("close", options.exitCode ?? 0);
      });
    }
    return child;
  }) as unknown as typeof spawn;
}

type GmailResult = { ok: boolean; data?: unknown } | Error;

function gmailFixture(results?: GmailResult[]) {
  const calls: Array<{ path: string; method: string; body?: string }> = [];
  const responses = results ?? [
    { ok: true, data: { emailAddress: "sender@example.com" } },
    { ok: true, data: { id: "offline-message_1" } },
    { ok: true, data: { id: "offline-message_1", labelIds: ["SENT"] } },
  ];
  const connector = {
    proxy: async (_service: string, path: string, request?: { method?: string; body?: string }) => {
      calls.push({ path, method: request?.method ?? "GET", body: request?.body });
      const result = responses[calls.length - 1] ?? { ok: false };
      if (result instanceof Error) throw result;
      return { ok: result.ok, json: async () => result.data };
    },
  };
  return { calls, connector };
}

function decodeSentEmail(body: string | undefined): { headers: string; text: string } {
  assert.ok(body, "expected a mocked Gmail send request body");
  const raw = JSON.parse(body).raw as string;
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  const separator = mime.indexOf("\r\n\r\n");
  assert.notEqual(separator, -1);
  const encodedText = mime.slice(separator + 4).replace(/\r\n/g, "");
  return {
    headers: mime.slice(0, separator),
    text: Buffer.from(encodedText, "base64").toString("utf8"),
  };
}

async function runFixture(options: {
  output?: string;
  exitCode?: number | null;
  waitForTimeout?: boolean;
  argv?: string[];
  gmailResults?: GmailResult[];
  maxRuntimeMs?: number;
  env?: NodeJS.ProcessEnv;
} = {}) {
  const subprocessCalls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
  const gmail = gmailFixture(options.gmailResults);
  const logs: string[] = [];
  const errors: string[] = [];
  let connectorCreations = 0;
  const result = await runNightlyCredits({
    env: options.env ?? offlineEnvironment(),
    argv: options.argv ?? [],
    spawnProcess: mockedSpawn({
      output: options.output,
      exitCode: options.exitCode,
      waitForTimeout: options.waitForTimeout,
      calls: subprocessCalls,
    }),
    createConnectors: () => {
      connectorCreations += 1;
      return gmail.connector as unknown as ReturnType<NonNullable<NightlyRunnerDependencies["createConnectors"]>>;
    },
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    maxRuntimeMs: options.maxRuntimeMs,
    mailTimeoutMs: 1_000,
    exit: (code) => errors.push(`exit:${code}`),
  });
  return { result, subprocessCalls, gmail, logs, errors, connectorCreations };
}

test("verified and maintenance reconciliation reports do not contact Gmail", async () => {
  for (const status of ["verified", "maintenance"] as const) {
    const result = await runFixture({
      output: reconciliationOutput(status),
      exitCode: 0,
    });
    assert.equal(result.result, 0);
    assert.equal(result.gmail.calls.length, 0);
    assert.equal(result.connectorCreations, 0);
    assert.equal(result.logs.length, 1);
    assert.equal(JSON.parse(result.logs[0]).status, status);
  }
});

test("mismatch alerts are sent once and contain only sanitized report fields", async () => {
  const result = await runFixture({
    output: reconciliationOutput("mismatch"),
    exitCode: 2,
  });
  assert.equal(result.result, 2);
  assert.equal(result.subprocessCalls.length, 1);
  assert.match(result.subprocessCalls[0].args.join(" "), /reconcile-classscribe-credits\.ts/);
  assert.match(result.subprocessCalls[0].env.PGOPTIONS ?? "", /default_transaction_read_only=on/);
  assert.equal(result.gmail.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(result.gmail.calls.length, 3);
  const email = decodeSentEmail(result.gmail.calls[1].body);
  assert.match(email.headers, /Subject: ClassScribe credit check: OWNER REVIEW REQUIRED/);
  assert.match(email.text, /Status: mismatch/);
  assert.match(email.text, new RegExp(libraryHash));
  assert.doesNotMatch(JSON.stringify(result.logs) + email.text, /PRIVATE_TOKEN|PRIVATE_CUSTOMER/);
});

test("nonzero reconciliation failures send one failure alert without exposing raw output", async () => {
  const result = await runFixture({
    output: "database failure PRIVATE_DATABASE_SECRET",
    exitCode: 1,
  });
  assert.equal(result.result, 1);
  assert.equal(result.gmail.calls.filter((call) => call.method === "POST").length, 1);
  const email = decodeSentEmail(result.gmail.calls[1].body);
  assert.match(email.headers, /Subject: ClassScribe credit check: FAILED RUN/);
  assert.match(email.text, /Failure category: check_failed/);
  assert.doesNotMatch(JSON.stringify(result.logs) + email.text, /PRIVATE_DATABASE_SECRET/);
});

test("a reconciliation timeout is reported as a sanitized failure and alerts once", async () => {
  const result = await runFixture({
    waitForTimeout: true,
    maxRuntimeMs: 1,
  });
  assert.equal(result.result, 1);
  assert.equal(result.gmail.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(JSON.parse(result.logs[0]).failure, "timeout");
  assert.match(decodeSentEmail(result.gmail.calls[1].body).text, /Failure category: timeout/);
});

test("malformed reconciliation output fails closed, alerts once, and does not leak the payload", async () => {
  const result = await runFixture({
    output: '{"status":"verified","private":"PRIVATE_MALFORMED_SECRET"',
    exitCode: 0,
  });
  assert.equal(result.result, 1);
  assert.equal(result.gmail.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(JSON.parse(result.logs[0]).failure, "invalid_report");
  assert.doesNotMatch(JSON.stringify(result.logs) + decodeSentEmail(result.gmail.calls[1].body).text,
    /PRIVATE_MALFORMED_SECRET/);
});

test("Gmail send failure is reported as unknown and is never blindly retried", async () => {
  const result = await runFixture({
    output: "database unavailable",
    exitCode: 1,
    gmailResults: [
      { ok: true, data: { emailAddress: "sender@example.com" } },
      new Error("provider response lost after submission"),
    ],
  });
  assert.equal(result.result, 3);
  assert.equal(result.gmail.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(result.gmail.calls.length, 2);
  assert.equal(JSON.parse(result.logs[1]).notification, "failed_or_unknown");
});

test("delivery tests are visibly labeled and do not launch reconciliation", async () => {
  const result = await runFixture({ argv: ["--test-delivery"] });
  assert.equal(result.result, 0);
  assert.equal(result.subprocessCalls.length, 0);
  assert.equal(result.gmail.calls.filter((call) => call.method === "POST").length, 1);
  const email = decodeSentEmail(result.gmail.calls[1].body);
  assert.match(email.headers, /Subject: ClassScribe credit check delivery test/);
  assert.match(email.text, /^DELIVERY TEST — not a completed production reconciliation\./);
  assert.match(email.text, /Status: failed/);
});

