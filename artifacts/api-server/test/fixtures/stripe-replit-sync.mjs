export class StripeSync {
  async processWebhook() {
    throw new Error("Stripe webhook sync is not available in billing unit tests.");
  }

  async findOrCreateManagedWebhook() {
    throw new Error("Stripe managed webhooks are not available in billing unit tests.");
  }

  async syncBackfill() {
    throw new Error("Stripe backfill is not available in billing unit tests.");
  }
}

export async function runMigrations() {
  throw new Error("Stripe migrations are not available in billing unit tests.");
}