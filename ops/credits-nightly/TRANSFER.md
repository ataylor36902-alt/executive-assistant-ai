# Transfer into an existing ClassScribe scheduler copy

This package supplies nightly-report files missing from an older copy. It is
an overlay for a complete ClassScribe workspace, not a standalone application.
It contains no credentials, database records, or private study content.

1. Switch the destination project's Agent chat to Build mode before requesting
   file changes. Do not change or publish the original website.
2. Extract the package into a temporary folder. Merge its source, tests,
   documentation and template into the destination using the same paths.
   Review changes only in the separate scheduler copy.
3. The included scripts/package.json is a reference: merge its
   nightly-classscribe-credits and test:credits-nightly script entries into the
   destination file rather than replacing unrelated entries. Ensure its
   @replit/connectors-sdk dependency is retained. Use the package-management
   skill for any required dependency/lockfile changes.
4. Keep the existing workspace libraries and API helper dependencies. The
   reconciler uses @workspace/db and dynamically imports API helpers by their
   relative paths; do not move only the runner into a blank project.
5. Follow docs/classscribe-nightly-credit-checks.md for production database
   verification, credentials, Gmail configuration, delivery verification, and
   the separate Scheduled deployment settings. A support-mail default is not
   configuration of CREDITS_RECONCILIATION_OWNER_EMAIL.
6. Never copy the template over the original website's .replit. Remove artifact
   registration only in the scheduler copy as described by the runbook.
7. Run pnpm --filter @workspace/scripts test:credits-nightly. Obtain owner
   approval before sending another delivery test. Publish only after owner
   approval and verification of the correct target.

Maintenance skips are expected until verified CREDITS cutover. Never perform
the currency migration, repair a balance, or write to the ledger as part of
this setup. The scheduler is not active merely because these files exist.
