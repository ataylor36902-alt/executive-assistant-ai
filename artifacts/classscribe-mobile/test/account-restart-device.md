# Native account restart check

Use a disposable account on an installed iOS or Android build (not the web preview). The automated `test:required-auth` check exercises Clerk's installed native token-cache module with a SecureStore stand-in and simulates session validation; it cannot prove OS keychain persistence or a live Clerk restore on a phone.

1. On a fresh install, create or sign in to an account. When **Set up your library** appears, do **not** create a library. Fully terminate the app from the app switcher.
2. Reopen it after unlocking the phone. Wait for account loading to finish. The account screen must show **Signed in to your account** and **Continue to profile setup**; it must not offer **Create library** until Continue is tapped. Tap Continue and confirm the profile/library form opens.
3. Leave without creating a library. Sign out, fully terminate and reopen. The required account sign-in screen must appear, with no Continue or Create library action.
4. For an expired/revoked session, sign in again, terminate before creating a library, invalidate that session in the Clerk test environment, then reopen. While Clerk checks it, profile creation must remain hidden. Once resolved, the app must require sign-in instead of presenting library setup. Do not use a production student's account for this check.

If step 2 or 4 fails, capture the installed build version, platform, whether the phone was unlocked after restart, and the visible account-loading/error message before changing auth configuration.