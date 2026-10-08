# Sample-page release regression

Run `pnpm run test:sample-pages` with the managed **ClassScribe web** and
**ClassScribe Mobile expo** workflows running. The API workflow is not needed.
The command discovers their development URLs in Replit. Elsewhere set
`EXAMPLES_WEB_URL`, `EXAMPLES_MOBILE_URL`, and optionally `CHROMIUM_PATH`.

The command checks:

- Production web-source, served-web and mobile-store mutation functions: sample
  updates/deletes, stripped `ex` flags, new children of sample courses/lectures,
  and direct note autosave attempts cannot reach persistence.
- Real records in each collection still accept edits and deletions.
- Actual browser and Expo web screens: course, assignments, lecture tabs, notes,
  course times, Grades, action menus, flashcard navigation and return navigation.
- A visible class-times edit for a real course is persisted by both clients.

Each run creates fresh browser contexts with a disposable library/profile and
an in-memory API fixture. API traffic is intercepted before it leaves the
browser; unexpected endpoints fail rather than receiving a fake success.
The fixture provides a valid paid-plan response so a plan gate cannot conceal
the sample Grades screen. Onboarding is completed only inside test storage;
there is no production onboarding bypass. Contexts are closed on pass or failure.

Mobile UI checks use the actual Expo web rendering, not a physical iPhone or
Android device. Store checks execute the native app's production mutation
callbacks. Device-specific gestures and screen-reader behavior are not proven
by this suite.

Function-boundary changes intentionally fail the mutation harness rather than
silently testing an outdated copy. Keep the source and served-web checks: a
source rebuild is not required and must not overwrite served-only fixes.
