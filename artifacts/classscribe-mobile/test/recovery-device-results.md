# Native recovery check evidence

Checklist: [recovery-device.md](recovery-device.md).

## iOS — partial, user-reported

- Report received: 2026-10-08.
- Device: iPhone 16 Pro.
- Distribution: TestFlight, version 1.0.0 (17), user-reported.
- iOS version: not provided.
- User confirmation: “yes recordings stay separated”.
- The user also explicitly confirmed the three checks below. These are physical-device reports, not agent-observed tests.
- Disposable-library setup details: not provided.
- Audible playback after switching A → B → A: passed, user-confirmed.
- B-scoped orphan visibility only in B's recovery scan: passed, user-confirmed.
- Audible playback after replacing A's sync code: passed, user-confirmed.
- Sample recovery, restart persistence, legacy-link exclusion, and damaged-file checks: not yet confirmed.
- Earlier report: opening Recovery from Account froze the screen. A navigation change was prepared, but its presence in the installed build and the on-device result remain unconfirmed.

## Android — not run

The user deferred Android testing. No Android device, OS, build, or native results have been provided.

## Overall status

The user reiterated “the recordings have been confirmed” and accepted the recording verification on their iPhone. The three iOS library-separation checks are recorded as passed based on their physical-device reports.

This closes the accepted iPhone verification only, not the original full two-platform checklist. Android remains deferred at the user's request, and the other iOS checklist items above have no separately reported results. Do not treat acceptance, mocked Node tests, or browser previews as evidence that those unrun checks passed.
