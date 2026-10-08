import assert from "node:assert/strict";
import Stripe from "stripe";
import { pgTable, text, jsonb, PgDialect } from "drizzle-orm/pg-core";

// Public, synthetic test credentials. No connector or database is contacted.
export const signingSecret = "whsec_local_classscribe_signature_regression";
export const libraryHash = "a".repeat(64);
export const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
export const documents = new Map();
export const calls = [];
export const state = { syncError: false };
export const classscribeLegacyDocumentsTable = pgTable("webhook_fixture_documents", {
  path: text("path"),
  data: jsonb("data"),
});
export const classscribeCreditActionsTable = {};
export const classscribeCreditProviderIntentsTable = {};
export const classscribeCreditSubscriptionPaymentRevocationsTable = {};
export const classscribeCreditSubscriptionPeriodsTable = {};
export const classscribeCreditTransactionsTable = {};
const dialect = new PgDialect();

export function resetFixture() {
  calls.length = 0;
  state.syncError = false;
  documents.clear();
  documents.set(accountPath, {
    path: accountPath,
    data: { libraryHash, stripeCustomerId: "cus_fixture", plan: "free", status: "inactive" },
  });
}

export const pool = {
  async query(sql, params) {
    assert.match(sql, /select secret from "stripe"\."_managed_webhooks"/);
    assert.match(params[0], /^https:\/\/[^/]+\/api\/stripe\/webhook$/);
    calls.push({ kind: "secret" });
    return { rows: [{ secret: signingSecret }] };
  },
};

export const db = {
  select() {
    return {
      from(table) {
        assert.equal(table, classscribeLegacyDocumentsTable);
        return {
          where(condition) {
            const { params } = dialect.sqlToQuery(condition);
            assert.equal(params.length, 1);
            assert.equal(typeof params[0], "string");
            calls.push({ kind: "read", path: params[0] });
            return {
              async limit(count) {
                assert.equal(count, 1);
                const row = documents.get(params[0]);
                return row ? [structuredClone(row)] : [];
              },
            };
          },
        };
      },
    };
  },
  async transaction(callback) {
    calls.push({ kind: "transaction" });
    return callback(db);
  },
  async execute(statement) {
    assert.match(dialect.sqlToQuery(statement).sql, /pg_advisory_xact_lock/);
  },
  insert(table) {
    assert.equal(table, classscribeLegacyDocumentsTable);
    return {
      values(row) {
        const write = () => {
          calls.push({ kind: "write", path: row.path });
          documents.set(row.path, structuredClone(row));
        };
        return {
          async onConflictDoUpdate() { write(); },
          then(resolve, reject) { return Promise.resolve().then(write).then(resolve, reject); },
        };
      },
    };
  },
};

export const subscription = {
  id: "sub_fixture",
  customer: "cus_fixture",
  status: "active",
  metadata: { classscribe_library_hash: libraryHash },
  cancel_at_period_end: false,
  items: { data: [{
    current_period_start: 1_790_000_000,
    current_period_end: 1_990_000_000,
    price: {
      product: "prod_fixture", currency: "usd", unit_amount: 799,
      recurring: { interval: "month" },
    },
  }] },
};

const verifier = new Stripe("sk_test_local_webhook_fixture");
// Only expose local methods; an unexpected provider operation must fail rather
// than falling through to a real Stripe network request.
const stripe = {
  webhooks: {
    constructEvent(payload, signature, secret) {
      calls.push({ kind: "verify", payload, signature });
      return verifier.webhooks.constructEvent(payload, signature, secret);
    },
  },
  subscriptions: {
    async retrieve(id) {
      assert.equal(id, subscription.id);
      calls.push({ kind: "subscription" });
      return structuredClone(subscription);
    },
  },
  products: {
    async retrieve(id) {
      assert.equal(id, "prod_fixture");
      calls.push({ kind: "product" });
      return { id, metadata: { classscribe_plan: "student" } };
    },
  },
};
export async function getUncachableStripeClient() { return stripe; }
export async function getStripeConnectionWebhookSecret() { return signingSecret; }
export async function getStripeConnectionLivemode() { return false; }
export async function getStripeSync() {
  calls.push({ kind: "sync-client" });
  return {
    async processWebhook(payload, signature) {
      calls.push({ kind: "sync", payload, signature });
      if (state.syncError) throw new Error("Synthetic sync unavailable");
    },
  };
}
export class StripeConnectionError extends Error {}
