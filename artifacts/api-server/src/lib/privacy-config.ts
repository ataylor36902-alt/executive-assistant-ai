/**
 * Retention promises represented by this API. Provider copies and platform
 * backups are governed by their operators; this service cannot verify or
 * accelerate their deletion. The owner must verify that deployment log and
 * database backup retention settings are no more than 30 days. Do not assume
 * checkpoint or object-storage backup lifetimes. Production must configure an external scheduled
 * owner job for the CLI in privacy-retention.ts because the API may sleep.
 * Logs are configured to omit query strings; log retention is controlled by
 * the hosting operator. No claim is made here that backups are erased.
 */
export const privacyRetentionConfig = {
  accountData: "Deleted from active application storage when a deletion request completes.",
  backups: "Application data is removed from active storage immediately. Platform backup copies are not immediately erased; the owner must verify the applicable backup retention period is no more than 30 days.",
  deploymentLogs: "Deployment log retention is documented as 30 days; the owner must verify the active configuration. This does not establish database, checkpoint, or object-storage backup lifetimes.",
  databaseBackups: "The owner must verify the production database backup plan and configured retention is no more than 30 days.",
  exports: "Private exports expire and are revoked 24 hours after creation.",
  consents: "Recording consent records are retained for the life of the associated recording.",
  billingAndCreditTransactions: "Stripped billing and credit transactions are retained for 7 years.",
  inactivity: "Inactive accounts are scheduled for deletion after 24 months, after a warning email 30 days before deletion.",
  providerDeletion: "Provider deletion is retried from a durable outbox. RevenueCat deletion remains pending until valid customer deletion credentials and permissions are available.",
} as const;

export const privacyConsentConfig = {
  version: "2025-01",
  statements: [
    "I give permission for ClassScribe to record and transcribe this class session for my study use.",
    "I have read and agree to the ClassScribe Privacy Policy, including its data retention and deletion terms.",
  ] as [string, string],
} as const;