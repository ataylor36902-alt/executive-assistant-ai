# Native welcome release smoke check

Run from the workspace root:

```sh
pnpm --filter @workspace/classscribe-mobile run test:required-auth
```

This includes the existing account-flow checks and the native-oriented smoke
suite. To run only the new smoke and build-handoff checks:

```sh
pnpm --filter @workspace/classscribe-mobile run test:native-auth-smoke
```

The smoke suite mounts the real welcome component with React effects and the
installed `@clerk/expo` provider on an iOS platform fixture. Clerk's real
headless initialization lifecycle, auth hooks, and loading/error controls run.
Only native host UI, device session synchronization, and the client returned by
the native singleton are replaced. The client's rejected `load()` promise
drives the actual provider error state; no mocked `isLoaded` flag grants access.

Checks cover:

- Email/account controls when initialization succeeds, with profile setup
  still unavailable to signed-out users.
- Provider initialization failure with neither SDK loading nor loaded controls
  visible, followed by the independent welcome error.
- Pending initialization at 9,999 ms and the actionable error at 10,000 ms.
- Late successful initialization replacing the error without granting guest access.
- Unmounting while initialization remains pending.
- Managed publishable-key bridging, absolute release proxy URL construction,
  domain precedence, development settings, and missing-origin rejection.
- The real build script's environment handed to its Metro child process and the
  root layout's proxy/token-cache wiring.

Timers are simulated; tests use invented keys/domains and no network or
workspace secrets. Build files execute in an isolated VM with a captured
`spawn`, without starting Metro or modifying build output.

This does not run an iOS binary, exercise Keychain or Clerk's hardware bridge,
or verify live production authentication. A successful smoke check catches
JavaScript welcome/provider regressions but is not evidence of a completed
TestFlight device sign-in. `react-test-renderer` is pinned to the app's React
version; its upstream deprecation warning is expected.
