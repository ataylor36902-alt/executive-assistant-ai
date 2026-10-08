# ClassScribe workspace import

This pull request adds the ClassScribe scheduler workspace's code and sanitized
source export alongside this repository's existing backend. It does not delete
or replace the existing backend, README, license, or environment configuration.
It is a source import, not a deployment or a confirmation of billing readiness.

The root pnpm workspace includes the web, mobile, API, and shared source
packages. The protected website files under `artifacts/classscribe/` are checked
against the source-export manifest by:

```sh
pnpm check:classscribe-source-integrity
```

No project dependency installation, application secrets, live database, email,
or billing service is needed for that command.

The import excludes agent/session metadata, private provenance attachments,
runtime data, and local Replit environment configuration. The source archive
was supplied as a sanitized export; it is included without modifying its bytes.

See `.github/classscribe-source-integrity.md` for the required GitHub branch
policy and the stable status-check name.
