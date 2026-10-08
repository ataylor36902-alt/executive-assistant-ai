# Phone JavaScript release smoke check

Run from the workspace root:

```sh
pnpm --filter @workspace/classscribe-mobile run test:phone-bundle
```

The registered validation is `phone-bundle-smoke`, using this same command.

1. TypeScript checks TypeScript sources and parses app JavaScript/JSX, including
   `app/credits.js`. `allowJs` is explicit; `checkJs: false` avoids introducing
   full JavaScript type-checking into this existing JavaScript app.
2. A regression test injects an intentional malformed credit-history JSX closure
   into the compiler's in-memory source, requires syntax errors, and confirms
   the real screen was not changed.
3. Expo/Metro exports production iOS and Android JavaScript, including real
   platform-specific module resolution and minification. Either export error
   fails the command. Nonempty platform bundles are required.

Outputs are isolated in a unique system temporary directory and removed on
normal success or failure. No `static-build` or `dist` output is replaced.
Metro's normal transform cache is reused to keep repeated checks inexpensive.
Hermes bytecode compilation is intentionally skipped: this is a JavaScript
parser/resolution check, not a signed native build.

This command does not start or change the Expo Go preview, change billing keys,
publish, prove device startup, or verify native payments. Installed-device
testing remains separate.
