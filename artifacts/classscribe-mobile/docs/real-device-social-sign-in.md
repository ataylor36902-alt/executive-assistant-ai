# Real-device social sign-in release check

This is a manual release gate. The simulated onboarding tests do not verify Apple/Google provider configuration or the OS-to-app redirect. Use the build and Clerk environment intended for release (Development and Production are separate); do not treat an Expo web preview as an iOS or Android result. Record the app build, Clerk environment, device/OS, tester, date, and results without storing credentials or personal student details.

The intended release includes both iPhone and Android. The results below were reported by the tester in conversation, not independently observed by the agent. No build identifier, OS version, or Clerk environment was supplied; confirm these details against the release build if needed for release sign-off.

| Platform / provider | New account | Returning account | Cancel | Incomplete provider setup |
| --- | --- | --- | --- | --- |
| Supported physical iPhone / Apple | Reported pass | Reported pass | Reported pass | Reported pass |
| Supported physical iPhone / Google | Reported pass | Reported pass | Reported pass | Reported pass |
| Supported physical Android / Google | Reported pass | Reported pass | Reported pass | Reported pass |

## Reported results

- iPhone / Apple and Google: The tester initially reported each provider returned to **Set up your library** on a physical iPhone, then explicitly confirmed new, returning, cancellation, and incomplete-setup checks passed for both providers.
- Android / Google: The tester explicitly confirmed new, returning, cancellation, and incomplete-setup checks passed on a physical Android phone. The tester did not provide device/build or environment details.

For each row:

1. Start from a device with no active ClassScribe session or library, open **Welcome → Already have an account? Sign in**, and tap the named provider. Complete provider consent with a test account that has never signed in to this Clerk environment. Verify the native browser closes, ClassScribe regains focus, and **Set up your library** appears. Do not create a library just to verify sign-in.
2. Sign out on the welcome screen, repeat with the same provider account, and verify the returning session also reaches **Set up your library**. Confirm the app has not silently created or switched libraries.
3. Sign out again, start the provider flow, then cancel at the provider or system sheet. Confirm the app returns to Welcome, **Create library** remains unavailable, and the student can retry the provider or choose email. No library should change.
4. Where the provider can return an unfinished account (for example, a test account requiring an additional factor), verify that setup stays blocked and the screen offers **Reset account sign-in** plus guidance to finish setup in a browser or try another method. Never use a real student's account to manufacture this state. If a safe provider test state cannot be arranged, record **not exercised** rather than pass; the automated incomplete-response test is not a substitute.

On iPhone, test Apple and Google separately; on Android, test Google. If a provider button fails before opening consent, the OS does not return to ClassScribe, the session is active without reaching profile setup, or cancellation/incompletion opens the library, record **fail** with the step, OS/build, and a redacted error. Fix and repeat that cell on a physical device before release. For subsequent builds, rerun the applicable rows rather than assuming these reports still apply.