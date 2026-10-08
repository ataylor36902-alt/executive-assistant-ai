# Android store identity release check

Run `pnpm run preflight:android-store` before preparing an Android release.
It reads `artifacts/classscribe-mobile/app.json` and performs one GET through
`scripts/src/revenuecatClient.ts` for the app selected by
`REVENUECAT_PROJECT_ID` and `REVENUECAT_GOOGLE_PLAY_STORE_APP_ID`.
Use the existing connected RevenueCat integration; do not paste credentials into
commands or source.

Exit status 0 means the selected app ID and `play_store` type are verified and
its `play_store.package_name` exactly matches `expo.android.package`.
Missing configuration, stale app selection, malformed/unavailable responses,
timeouts and mismatches return exit status 1. Errors omit provider response
bodies, identifiers and credentials. No arguments (including `--apply`) are
accepted. No provider resources or local config are modified.

This is a standalone preflight, not a native publish command or an automatic
publishing hook. It does not verify Google Play upload status, signing or
service-account readiness. A failure requires investigation, not automatically
renaming another app or falling back to another RevenueCat app.

The older `align-classscribe-android-identifier.ts` is a migration/status tool,
not a strict release gate: its default mode accepts former packages.
Do not use it as proof that an Android release is aligned.
Static iOS config is intentionally independent and must not be normalized.

Run `pnpm run test:android-store` for isolated fixture tests. They never use
the connected provider, publish a build, or perform purchases/deletions.
