# Expo Go preview diagnosis

Status: The original native launch request, `GET /classscribe-mobile/`, returned an HTML 404 while the unprefixed Expo root returned a valid manifest. The user confirmed this was the simulator launch path. The managed Expo Go proxy now normalizes the prefix: the Expo host returns valid Expo JSON for `/` and `/classscribe-mobile/`, and the shared development host returns valid Expo JSON for `/classscribe-mobile/`; the iOS bundle returns HTTP 200 JavaScript (7,064,766 bytes). Expo's manifest advertises protocol version `0`. After earlier simulator-load failures with no simulator-origin request reaching the app, the user later supplied a screenshot of the reopened in-editor `Simulate on iOS` preview rendering the ClassScribe library-entry screen. The in-editor simulator now opens, and the manifest error is resolved. Chrome is a supported browser. The root `Project` dispatcher remains removed while `runButton = "Project"` and study-guides validation remain. The Expo config uses ClassScribe identifiers, permissions, icon, and the reduced plugin list. The physical-phone Expo Go QR result remains unconfirmed; it is separate from the in-editor simulator check. The Safari-installable web app's source and configuration were not changed.
## What was checked

- Before the proxy change, the iPhone showed “Failed to parse manifest JSON” even though an Expo Go-style request to the development host root returned HTTP 200 `application/expo+json` and a parseable SDK 57 manifest. The simulator's actual reported request was `GET /classscribe-mobile/`, which returned `404 Not Found`; that prefixed error response was the invalid manifest response.
- The user confirmed Expo Go opens on a physical phone while the in-editor simulator failed. Earlier checks found a working root manifest and iOS bundle, but neither established what the simulator received.
- The final `app.json` preview plugin list is `expo-router`, `expo-audio`, and `expo-asset`. Speech recognition remains optional at runtime; the recording screen falls back to normal recording when the native speech package is unavailable.
- The package and lockfile now agree on the Expo 57.0.25 dependency set; `expo-dev-client` is absent. `expo install --check` reports dependencies up to date, and Expo Doctor passed 21/21 checks.
- The managed `dev:preview` script runs the prefix-normalizing proxy, which starts Expo with explicit `--go` and `--clear`; the workflow log confirms “Using Expo Go.” A nonfatal React Native DevTools install error reports missing `libglib-2.0.so.0`, but Metro and the proxy both become ready.
- The prefix and static-server routing tests pass. Shell probes after restart confirmed HTTP 200 manifests for root and prefixed paths and a 200 JavaScript response for the prefixed manifest's iOS bundle. These checks do not replace a full native simulator reopen.
- The ClassScribe web app and API health endpoint returned HTTP 200 during the investigation.

## Run workflow comparison

- Removed the custom root `Project` workflow that ran only the study-guides test. Kept `runButton = "Project"` and the independent `study-guides` validation workflow, matching the supplied reference structure. Restarted the managed API, web, and Expo services; all three are running, and the API and web health probes returned HTTP 200.
- With Expo iOS headers, `https://<Expo host>/` returned a JSON manifest (HTTP 200), while `/classscribe-mobile/` returned HTML 404 before the proxy. The user later confirmed that `/classscribe-mobile/` was the simulator's launch request. `/execora-lite/` also returned 404 on the ClassScribe host; that is not the Execora Lite host and is not evidence about its live route.

## Domain correction

- `REPL_DEV_DOMAIN` is unset in this workspace; `REPLIT_DEV_DOMAIN` and `REPLIT_EXPO_DEV_DOMAIN` are populated. Before the correction, the mobile launch script set both `EXPO_PUBLIC_DOMAIN` (used for the API address) and `REACT_NATIVE_PACKAGER_HOSTNAME` from the unset name. The build script also checked the unset name as a fallback. The serve script has no such reference.
- The managed launch now sets those two values from `REPLIT_DEV_DOMAIN` while keeping the existing Expo proxy domain and other launch flags. The build fallback uses the same correct variable. Metro's cache-clearing restart reported an empty cache and Expo Go mode. Afterward, an Expo Go-header request on both the Expo and regular development hosts returned a parseable SDK 57 JSON manifest with a bundle URL on the Expo host.
- Reconfirmed the variable values and launch-time shell expansion for both settings: the old name is unset, while the two active settings resolve to the populated standard development domain. Restored the speech plugin to isolate this address-only retest, restarted Metro with `--clear` (it logged an empty cache), then restarted with the unchanged final no-`--go`, no-`--clear` command. The iOS manifest and bundle again returned HTTP 200, the bundle contained the populated development domain, and API health returned HTTP 200. The in-editor/native iPhone app must still be reopened or refreshed on the device; a browser preview and server-side HTTP checks cannot perform or substitute for that step.
- This fixes a demonstrably empty launch setting, but the user still reported the native manifest error afterward. **None of the launch or domain changes has been confirmed to fix the native error.** The speech-recognition plugin comparison below remains untested.

## Speech-recognition plugin comparison

- The `expo-speech-recognition` config plugin entry was temporarily removed from `app.json` for comparison. The dependency, iOS speech usage description, and optional runtime guard remained intact, so Expo Go used normal recording.
- Metro logged an empty cache on restart without the plugin, then restarted with the original no-`--go` launch command. The resolved Expo config confirms the plugin is absent; the iOS manifest and bundle both returned HTTP 200, and mobile typecheck passed. These are server-side checks, not a native-preview result.
- Device result: **not obtained**. The plugin entry has been restored before the requested address-only retest, so this comparison is inconclusive. Do not attribute the manifest error to the plugin without a device-side result.

## Execora app.json comparison

- Updated ClassScribe's static app config to match the supplied working app structure: identifiers `com.classscribe.app`, iOS build number `1`, encryption flag `false`, Android audio/camera permissions, and the green adaptive-icon background. The existing 1024×1024 ClassScribe icon is used for app, adaptive foreground, and web favicon.
- The preview plugin list is now `expo-router`, `expo-audio` with the ClassScribe microphone permission text, and `expo-asset`. Splash screen, status bar, mail composer, image picker, and speech-recognition config plugins are temporarily omitted; their settings and permission texts are documented in `replit.md` for one-at-a-time restoration after the base preview opens. Runtime live transcription remains optional.
- Resolved iOS and Android app config values were validated. The `expo-audio` config contributes additional audio-service permissions to Expo's resolved Android config; the requested `RECORD_AUDIO` and `CAMERA` entries remain explicitly configured in `app.json`.
- Mobile workflow restart, iOS/Android manifest JSON validation, and manifest asset URL checks: **passed** after routing changes.
- iPhone preview result after fully closing and reopening: **pending user check**.

## Expo host root and prefix routing

- Tried changing the mobile artifact's `previewPath` and service path to `/` through the artifact validator. It rejected the change with `DUPLICATE_PREVIEW_PATH` because the ClassScribe website already owns `/`. Kept the website at `/` and the mobile artifact's unique `/classscribe-mobile/` preview path.
- Added a Node HTTP proxy as the managed Expo service entry point. It runs Expo on a loopback port and serves the managed mobile port, mapping `/classscribe-mobile/` to the Expo root while keeping Expo's `/artifacts/classscribe-mobile/` Metro bundle route intact. Stripping the latter broke Metro resolution; preserving it made the bundle return HTTP 200. The mobile service declares both the unique preview path and the bundle path. The production server uses the same boundary-safe prefix stripping for `BASE_PATH` and `/classscribe-mobile/`.
- Cleared Metro's transform cache and restarted the mobile, web, and API workflows. Expo logged that it is using Expo Go. Its optional React Native DevTools install printed a missing `libglib-2.0.so.0` warning, but Metro and the proxy started and passed the service reachability check.
- With Expo iOS and Android headers, `/`, `/classscribe-mobile/`, `/manifest`, and `/classscribe-mobile/manifest` each returned HTTP 200 `application/expo+json` and parsed as JSON. The iOS and Android launch bundles returned HTTP 200 JavaScript; the app icon and Android adaptive icon URLs returned HTTP 200 PNG.
- Mobile typecheck, prefix-routing tests, and a production-serve integration test for root/prefixed manifest and asset paths passed. Existing native transcript, export, store-sync, class-group, and study-guide tests also passed. Application feature code was not changed; live transcript remains optional with the existing Expo Go fallback.
- After fully closing and reopening, the user supplied a screenshot showing the in-editor **Simulate on iOS** preview rendering the app. The remaining check is the physical-device path: choose **Open in Expo Go** and scan the QR with Expo Go on an iPhone. Do not restore the remaining config plugins until that base path is confirmed.


## Native preview manifest investigation (historical)

The early in-editor manifest failures were not visible at the app-server
boundary, so browser and shell checks alone did not establish what Expo Go
received. The later user-confirmed launch path and its 404 are documented
below; the prefix-normalizing proxy fixed that response, and a subsequent
in-editor screenshot confirms that the simulator now opens the app.

With the managed `artifacts/classscribe-mobile: expo` workflow running in Expo Go
mode, an iOS-style request (`Accept: application/expo+json`,
`expo-platform: ios`) to the Expo development host root `/` returned HTTP 200,
`application/expo+json`, with `runtimeVersion: exposdk:57.0.0`. Its iOS
`launchAsset.url` returned HTTP 200 JavaScript. The same host's
`/classscribe-mobile/` and `/classscribe-mobile/manifest` returned HTTP 404
`text/html`; `/manifest` returned Expo JSON. A previous attempt to serve JSON
at the prefixed paths did not resolve the user's simulator error, so the
prefixed 404 **must not be assumed to be the cause**.

A temporary development-only Node HTTP boundary trace logged all GET and HEAD
requests (path without query string, platform, Accept, user agent, status and
content type). The Metro `enhanceMiddleware` hook does not observe the root
Expo manifest route, but the boundary trace did observe shell/browser requests
to `/` and `/status`. The user twice pressed the simulator's refresh button and
the same “Failed to parse manifest JSON” error returned; **no corresponding
request reached the mobile server**, even with the trace expanded to all GET
paths. The temporary logger was removed afterward.

An iOS-style request to the shared development host's `/classscribe-mobile/`
returned HTTP 404 `text/html` (as did the Expo-domain host's prefixed path).
At the time this was only a candidate invalid response, not yet the simulator's
confirmed response. The user later confirmed that this was the launch path;
the prefix-normalizing proxy now returns Expo JSON there. The original
redirect-only attempt did not resolve the error, so the evidence from that
attempt should not be confused with the later proxy fix.

`expo install --check` and `expo-doctor` report only eight SDK 57 patch-version
mismatches. `expo install --fix` cannot currently install the suggested patches
because the workspace's pnpm minimum-release-age policy excludes a recent
release; do not bypass that policy just to clear patch warnings. The unrelated
React Native DevTools shared-library warning does not stop Metro.

The separate Safari-installable ClassScribe web artifact was not changed.


## After the requested project replacement

The user explicitly requested replacing the ClassScribe web and mobile sources
with the supplied ZIP. The imported source is now served by the existing
artifact workflows; the managed database-backed `/api` routes were retained to
avoid replacing existing data with the ZIP's empty file store. The imported
web HTML serves byte-for-byte from the ZIP, and the iOS Expo manifest and
JavaScript bundle return HTTP 200. The user refreshed the in-editor iPhone
simulator after this replacement and confirmed that it **still** reports the
same manifest JSON parsing error. Replacing the entire mobile UI with the
uploaded ZIP did not solve the native launcher failure. The upstream native
launch request and response must be observed before declaring the original
manifest issue fixed.

The user subsequently confirmed that the same imported app **opens in Expo Go
on a physical phone**, but not in the in-editor iPhone simulator. This
separates the working phone launch from the simulator failure; it does not
identify the simulator's launch URL or its failing HTTP response. Replit's
mobile troubleshooting documentation suggests “Restart compute” from the
editor command palette for simulator issues. That reset has not been confirmed
to resolve this case.


## Axis Pro simulator comparison

The supplied Axis Pro mobile project uses the same default Metro config and
Expo SDK 57 / React Native 0.86 generation as ClassScribe. Its artifact uses
the domain root (`/`) for both the preview and Expo service; this workspace
already assigns `/` to the Safari-installable ClassScribe web artifact.
Replit rejected assigning the mobile preview itself to `/` as a duplicate
preview path. A temporary test of routing only the Expo service from `/`
caused the mobile host root to return the web app's HTML rather than Expo
manifest JSON, so that change was reverted. ClassScribe's Expo host root again
returns HTTP 200 Expo JSON and its iOS bundle returns HTTP 200 JavaScript.
Copying Axis Pro's root path is therefore incompatible with this multi-artifact
workspace; the native simulator's actual launch URL is still unknown.


## Managed launch environment

The Axis Pro launch script uses `REPLIT_DEV_DOMAIN`, while ClassScribe used
`REPL_DEV_DOMAIN` for its React Native packager hostname and API origin.
Inspection of the running ClassScribe Expo process showed `REPL_DEV_DOMAIN`
was **unset**, leaving the packager hostname empty and the API origin
incomplete. The launch script now uses the managed `REPLIT_DEV_DOMAIN`.
After a workflow restart, the running process has a populated packager
hostname and API origin, and an iOS-style request to the Expo host root
returns HTTP 200 Expo JSON whose bundle URL returns HTTP 200 JavaScript.
This fixes the bad launch environment but does not by itself prove that
the in-editor simulator is loading the new launch response.

The user closed and reopened the in-editor iPhone simulator after this
correction and confirmed the **same manifest error remains**. No corresponding
iOS bundle request appeared in Expo's logs; only the web bundle ran. The
simulator launch request and response are still not visible at the Expo
server. The mobile web preview uses its own origin for `/api` calls, while
native Expo Go uses the now-populated absolute development host.

The user also ran the editor's **Restart compute** command and reopened the
simulator; the same error remained. Afterward the managed Expo workflow was
running, `/status` returned `packager-status:running`, and an iOS-style root
manifest request and its launch bundle both returned HTTP 200. There was no
corresponding new iOS bundle request from the simulator in Expo's logs. The
exact failing launch URL, status, content type, and body must be captured in
the simulator or upstream preview service; none of the available app-server
logs reveal it. Do not mark the in-editor simulator as fixed based on the
working physical-phone Expo Go preview.


## Private-preview and clean-cache retry

The user shared a screenshot showing **Private preview is on** and Replit's
warning that private previews are unsupported for Expo Go, simulators, and the
Replit mobile app. The user turned private preview off and retried; the
manifest error remained. A temporary Node HTTP boundary trace was then enabled
while the managed Expo workflow restarted with a newly provisioned Expo
session and an empty Metro cache. The user retried once more, but no
simulator-origin request appeared in the trace or new workflow logs.

The traced, explicitly identified Node diagnostic requests to `/` and the iOS
launch bundle both returned HTTP 200 (`application/expo+json` manifest and
JavaScript bundle respectively). These were shell checks, not simulator
requests. Direct checks also showed `/manifest` returns Expo JSON,
`/_expo/loading` returns HTML, and artifact-prefixed manifest paths return
HTML 404. The running Expo process is on its configured port, and `/status`
returns HTTP 200. `expo install --check` reports only SDK 57 patch-version
updates, not a major Expo Go compatibility mismatch.

Conclusion: private preview is a relevant unsupported setting, but disabling
it and clearing Metro's cache did not fix this simulator error. The actual
simulator launch URL and response remain unobserved at the app-server
boundary, so the failing response appears to be upstream of Metro or outside
its configured host. Do not add more path redirects based only on the
candidate HTML responses above. The in-editor simulator acceptance criterion
is still unverified. Replit's Preview documentation says its Developer Tools
include a Network tab; capture the simulator's failing request there (path,
status, content type, and response body prefix) before making another routing
change. Do not collect or share authentication headers.


## Expo CLI path failure and routing constraint

The simulator's launch URL appends `/classscribe-mobile/` to the mobile
address. Under the original Expo CLI dev workflow, that prefixed address
returned Not Found while the host root served the Expo startup manifest. The
prefix 404 was therefore the invalid response behind the manifest parsing
error.

Changing the mobile artifact's `previewPath` to `/` was rejected by the
artifact validator because the ClassScribe web artifact already owns `/`.
Keeping the unique mobile `previewPath` but routing the Expo service through
`paths = ["/"]` passed validation, but after restart the Expo host root and
`/status` returned web HTML instead of an Expo manifest/status response. That
configuration was reverted. With the original route restored, the Expo host
root again returns HTTP 200 Expo JSON and its bundle returns HTTP 200
JavaScript, while `/classscribe-mobile/` remains HTTP 404 HTML. The Safari
web artifact was not changed.

The artifact validator rejects assigning `/` to the mobile artifact because
the separate ClassScribe web artifact already owns it. Routing only the Expo
service to `/` instead served web HTML, so that approach was reverted. Do not
bypass validation or move the web artifact to force a root preview. The
project's own static Expo server provides a supported alternative: it strips
`BASE_PATH` before serving platform manifests and static bundles.

## Execora Lite comparison and requested Expo setup

The Execora Lite mobile ZIP is present in `attached_assets` (two identical
copies). Its artifact config uses `router = "expo-domain"` with a
slug-prefixed `previewPath`, service path, and `BASE_PATH`, just like
ClassScribe. Its app config has only `expo-router`, `expo-audio`, and
`expo-asset` plugins; ClassScribe already has the requested splash-screen,
status-bar, email-composer, image-picker/camera, and speech-recognition plugin
entries and the corresponding packages.

The other Expo artifact uses a similar slug-prefixed path, but that alone does
not establish equivalent routing or client compatibility. ClassScribe does
not declare `expo-dev-client`; its managed proxy explicitly starts Expo Go
with `--go`. The reduced plugin list remains in place until the base preview
opens, after which optional plugins can be restored one at a time.

The managed preview now starts Metro behind `server/dev-proxy.js`. The proxy
strips `/classscribe-mobile/` before forwarding Expo's manifest request and
preserves `/artifacts/classscribe-mobile/...` for the Metro bundle. It also
sets the API origin from `REPLIT_DEV_DOMAIN`. After restart, the Expo-domain
host returned HTTP 200 `application/expo+json` for both `/` and
`/classscribe-mobile/`; the shared development host returned the same successful
response for `/classscribe-mobile/`. The prefixed manifest advertised protocol
version `0` and referenced an iOS bundle at
`/artifacts/classscribe-mobile/node_modules/expo-router/entry.bundle`. That
bundle returned HTTP 200 `application/javascript` with 7,064,766 bytes.
The development-only trace records request host/path, platform, Accept,
user-agent, status, and content type without auth headers or secret query
values.

These are shell probes, not native acceptance. At that stage, the “failed to
load iOS simulator” attempt produced no simulator-origin request in the Expo
trace; only explicit curl probes appeared. A later fully reopened in-editor
simulator screenshot confirms the app now loads. Do not collect authentication
headers when diagnosing any separate physical-device issue.

Source inspection found these current feature states:

- Recording and slide-photo capture have app screens and Expo Audio / image
  picker code, but require a working iPhone preview or device to verify
  permissions, capture, and saved results.
- Email uses Expo Mail Composer with a share-sheet fallback; its native
  handoff has not been tested.
- Home layout/logo, schedule, dated note timestamps, and analysis screens or
  logic are present, but they do not have end-to-end mobile acceptance tests.
- Live speech recognition is **not wired into the recording screen**. The
  screen supports manually entered or dictated timestamped lines and says the
  full transcript is created on save. A speech-recognition helper and
  transcript accumulator exist, but only the accumulator has a unit test.

Verification performed: TypeScript, exports, store-sync, transcript-accumulator,
and study-guide checks pass. The class-groups test script fails two existing
assertions whose expected query variable and UUID expression differ from the
current source. These checks do not substitute for the requested iPhone
feature checks, which remain blocked until the native preview opens.

## Retest after workspace dependency restore

- After the full workspace install and a fresh mobile-workflow restart, the user
  retried from Chrome and still saw the simulator-load error. The reported
  panel text was “there was a problem running the requested project.”
- The trace after that retry contains only the four explicit curl probes to the
  Expo and shared development hosts; it contains no simulator-origin request.
  The prefixed iOS manifest still returns HTTP 200 Expo JSON on both hosts, and
  its iOS bundle returns HTTP 200 JavaScript (7,064,766 bytes).
- The original reported `GET /classscribe-mobile/` response was an HTML 404;
  the proxy now returns valid Expo JSON for that request. The latest failure
  occurs before a new native request reaches the mobile service, so there is
  no newer simulator HTTP response to identify and no evidence supporting
  another routing change.
- Chrome is supported, Metro cache clearing and a compute restart have already
  been tried, and the physical-phone Expo Go launch works. The persistent
  in-editor failure points to the simulator/preview launch layer rather than
  the current app manifest endpoint. The Safari-installable web app remains
  unchanged.
## Simulate on Web follow-up

- The managed mobile workflow remained `RUNNING`; Metro logged successful iOS and Web bundles and no startup crash. Expo's optional React Native DevTools install warning about missing `libglib-2.0.so.0` did not stop the preview.
- Normal browser requests with `Accept: text/html` to the Expo mobile host's `/` and `/classscribe-mobile/` both returned HTTP 200 HTML without redirects, `X-Frame-Options`, or CSP `frame-ancestors`. The workspace domain's `/` remains the ClassScribe website, as required by its unique root ownership.
- The Expo HTML references `/artifacts/classscribe-mobile/node_modules/expo-router/entry.bundle?...platform=web`. That web bundle returned HTTP 200 `application/javascript` (about 9.2 MB); its `entry.map` source map returned HTTP 200 JSON. All 33 referenced asset URLs, including 19 font URLs, returned HTTP 200 with image/font content types. `/_expo/error-overlay-meta` returned HTTP 200 JSON.
- The proxy's WebSocket upgrade succeeded for both `/hot?platform=web` and `/classscribe-mobile/hot?platform=web`. It forwards request and response headers/bodies and does not add frame restrictions. A bare `/node_modules/expo-router/entry.bundle` request returns 404, but Expo's actual HTML uses the working artifact-prefixed `/artifacts/classscribe-mobile/node_modules/...` route; do not strip that prefix.
- A current app-preview screenshot shows the ClassScribe wordmark and the create/open-library screen, with no broken-page icon. It does not show the Home/Class-first layout because no library is open in that preview session. No sync code was requested or entered.
- The user previously reported that scanning the QR in Expo Go on a real iPhone still fails. Server-side manifest/bundle checks do not establish device reachability; await the result after reopening with **Open in Expo Go** selected. Keep the proxy because the web simulation now loads and its assets/HMR routes pass. Do not restore the omitted config plugins until the native baseline is confirmed.
- After fully closing and reopening the editor preview, the user supplied a screenshot with **Simulate on iOS** selected. It shows the ClassScribe wordmark and create/open-library screen without the manifest/broken-page error. This confirms the in-editor simulator only; it is not evidence that **Open in Expo Go** or a physical-iPhone QR scan has succeeded.
