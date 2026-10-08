# ClassScribe complete workspace source export

This archive contains the current full source in this workspace: web app, mobile app, API server, shared packages, tests, scripts, documentation, bundled assets, workspace manifests, and lockfile. It is not merely an overlay.

This was packaged from the workspace, not retrieved through a separate original project file menu. It is not a historical snapshot of a different project.

Excluded: .env files (including examples), secrets/credential files, Replit environment/provider configuration, dependency folders, generated builds/caches, Git history, agent/session files, screenshots, user uploads/recordings, and database contents. Uploaded inputs to optional marketing-media scripts are not included. Any recognized embedded credential tokens are replaced with REDACTED_CREDENTIAL.

Recreate secrets and provider configuration separately using the destination workspace secrets tooling. Install dependencies using the included pnpm lockfile. Source and served web files are both included; avoid blindly rebuilding one over the other.

EXPORT-MANIFEST.json lists the included files with byte counts and SHA-256 digests.

For this scheduler copy, run `pnpm check:classscribe-source-integrity` from the
workspace root to verify the manifest-listed files under `artifacts/classscribe/`.
The check is local and offline; it excludes Replit-generated artifact metadata
and does not cover scheduler files outside the ClassScribe artifact.

It also requires `CLASSSCRIBE_SOURCE_ZIP_SHA256` from externally managed,
owner-approved configuration. Missing or mismatched archive fingerprints fail;
the manifest is not a trust anchor. See
`docs/classscribe-source-baseline.md` for the trust boundary and reviewed
baseline-update procedure.
