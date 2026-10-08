import { randomUUID } from "node:crypto";
import { mkdir, open, rename } from "node:fs/promises";
import { join } from "node:path";

// Only disposable customers created by this run may be changed or deleted.
// The journal contains no credentials and prevents silent replay of a write.
const [projectId, referenceCustomerId] = process.argv.slice(2);
if (!projectId || !referenceCustomerId ||
    !/^[A-Za-z0-9_-]+$/.test(projectId) ||
    !/^[A-Za-z0-9_-]+$/.test(referenceCustomerId)) {
  throw new Error("Provide the project ID and existing read-only reference customer ID.");
}
const key = process.env.REVENUECAT_CREDITS_API_KEY?.trim();
if (!key) throw new Error("The RevenueCat server key is missing.");
const runId = randomUUID();
const disposableId = `classscribe-credits-verification-${runId}`;
const reference = `credits-verification-${runId}`;
const directory = join(process.cwd(), ".local", "revenuecat-verification");
const journalPath = join(directory, `${runId}.json`);
const journal: Record<string, unknown> = {
  runId, projectId, disposableId, reference, currency: "CREDITS", amount: 5,
  phase: "prepared", statuses: {},
};
const statuses = journal.statuses as Record<string, number>;
let owned = false;
let uncertain = false;
let failed = false;

async function save(phase: string) {
  journal.phase = phase;
  journal.updatedAt = new Date().toISOString();
  await mkdir(directory, { recursive: true });
  const temporary = `${journalPath}.tmp`;
  const file = await open(temporary, "w", 0o600);
  try {
    await file.writeFile(JSON.stringify(journal, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, journalPath);
  const dir = await open(directory, "r");
  try { await dir.sync(); } finally { await dir.close(); }
}

async function request(suffix: string, method = "GET", body?: unknown) {
  return fetch(`https://api.revenuecat.com/v2/projects/${projectId}${suffix}`, {
    method, signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${key}`, Accept: "application/json",
      ...(body === undefined ? {} : {
        "Content-Type": "application/json",
        ...(suffix.endsWith("/virtual_currencies/transactions")
          ? { "Idempotency-Key": reference } : {}),
      }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function requireOk(response: Response, step: string) {
  statuses[step] = response.status;
  if (!response.ok) {
    let data: { message?: unknown } = {};
    try {
      const raw: unknown = await response.json();
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        data = raw as { message?: unknown };
      }
    } catch {}
    const message = typeof data.message === "string"
      ? data.message.split(key!).join("[REDACTED]")
        .split(referenceCustomerId!).join("[reference customer]").slice(0,800)
      : "Provider rejected the request.";
    throw new Error(`${step}: HTTP ${response.status}: ${message}`);
  }
}

async function balances(): Promise<{ CRD: number; CREDITS: number }> {
  const response = await request(
    `/customers/${disposableId}/virtual_currencies?include_empty_balances=true&limit=100`,
  );
  await requireOk(response, "balanceRead");
  const data = await response.json() as {
    items?: Array<{ currency_code?: string; balance?: number }>; next_page?: unknown;
  };
  if (!Array.isArray(data.items) || data.next_page) {
    throw new Error("Balance response is invalid or unexpectedly paginated.");
  }
  const value = (code: string) => {
    const entries = data.items!.filter(item => item.currency_code === code);
    if (entries.length > 1) throw new Error("Duplicate currency balance.");
    const amount = entries.length ? entries[0]?.balance : 0;
    if (!Number.isSafeInteger(amount) || Number(amount) < 0) {
      throw new Error("Invalid currency balance.");
    }
    return Number(amount);
  };
  return { CRD: value("CRD"), CREDITS: value("CREDITS") };
}

try {
  const existing = await request(`/customers/${referenceCustomerId}`);
  await requireOk(existing, "existingCustomerGet");
  const absent = await request(`/customers/${disposableId}`);
  statuses.disposablePreflight = absent.status;
  if (absent.status !== 404 || disposableId === referenceCustomerId) {
    throw new Error("Disposable identity safety check failed.");
  }
  await save("create-pending");
  uncertain = true;
  const created = await request("/customers", "POST", { id: disposableId });
  uncertain = created.status >= 500 || [408,429].includes(created.status);
  await requireOk(created, "customerCreate");
  const customer = await created.json() as { id?: string; project_id?: string };
  if (customer.id !== disposableId || customer.project_id !== projectId) {
    uncertain = true;
    throw new Error("Provider did not confirm the disposable customer's identity.");
  }
  owned = true;
  uncertain = false;
  await save("created");
  journal.before = await balances();
  const before = journal.before as { CRD: number; CREDITS: number };
  if (before.CRD !== 0 || before.CREDITS !== 0) {
    throw new Error("A new disposable customer unexpectedly has a balance.");
  }
  await save("adjustment-pending");
  uncertain = true;
  const adjusted = await request(
    `/customers/${disposableId}/virtual_currencies/transactions`, "POST",
    { adjustments: { CREDITS: 5 }, reference },
  );
  uncertain = adjusted.status >= 500 || [408,429].includes(adjusted.status);
  await requireOk(adjusted, "creditAdjustment");
  uncertain = false;
  journal.after = await balances();
  const after = journal.after as { CRD: number; CREDITS: number };
  if (after.CREDITS !== 5 || after.CRD !== 0) {
    throw new Error("The +5 CREDITS adjustment did not verify.");
  }
  await save("grant-verified");
} catch (error) {
  failed = true;
  journal.error = error instanceof Error ? error.message : "Verification failed.";
  await save(uncertain ? "outcome-uncertain-no-replay" : "verification-failed");
} finally {
  if (owned && !uncertain && disposableId !== referenceCustomerId) {
    try {
      await save("deletion-pending");
      const deleted = await request(`/customers/${disposableId}`, "DELETE");
      await requireOk(deleted, "customerDelete");
      await save("deletion-awaiting-confirmation");
      let confirmed = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        const check = await request(`/customers/${disposableId}`);
        statuses.deletionConfirmation = check.status;
        if (check.status === 404) { confirmed = true; break; }
        if (check.status !== 200) throw new Error(`Deletion confirmation: HTTP ${check.status}`);
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
      if (!confirmed) throw new Error("Deletion is queued but not yet confirmed; use GET-only follow-up.");
      journal.deletionConfirmed = true;
      await save(failed ? "failed-test-cleaned-up" : "verified-and-deleted");
    } catch (error) {
      failed = true;
      journal.cleanupError = error instanceof Error ? error.message : "Cleanup confirmation failed.";
      await save("cleanup-needs-get-only-review");
    }
  }
}
console.log(JSON.stringify({
  phase: journal.phase, statuses, before: journal.before, after: journal.after,
  deletionConfirmed: journal.deletionConfirmed === true,
  error: journal.error, cleanupError: journal.cleanupError, journalPath,
}));
if (failed || uncertain) process.exitCode = 1;