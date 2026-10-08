# Trusted ClassScribe source baseline

## Trust boundary

The complete uploaded source ZIP is the initial baseline. Its whole-file SHA-256
must be recorded as `CLASSSCRIBE_SOURCE_ZIP_SHA256` in Replit's **Secrets store**,
outside the editable workspace. Ordinary non-secret Replit environment settings
are not suitable: they are serialized into the editable `.replit` file. The
initial fingerprint to provision through the secure Secrets form is:

- Archive: `0_ClassScribe-complete-source_1791487925572.zip`
- SHA-256: `591c6f721793d1e7104bbd8910e5158edd85e227d28135feee2d430fa58cad2c`
- Computed: 2026-10-08, from the supplied complete source export. Provisioning
  was confirmed by the owner through the Secrets form on 2026-10-08.
- Scope: pins the exact ZIP bytes; the manifest comparison then protects the
  ClassScribe website source, with the existing generated-file exclusions.

This document is a human-readable reference, **not** the trust source. Neither
this document nor `EXPORT-MANIFEST.json` can supply a missing fingerprint.
Replacing the ZIP, manifest, and website files together still fails against the
external value.

`pnpm check:classscribe-source-integrity` works offline with the external value
already supplied to the process. It hashes the entire ZIP before parsing it and
uses the same in-memory bytes for the manifest checks. Missing, malformed, or
different fingerprints fail with a nonzero exit code. There is no automatic
baseline learning, `.env` loading, or workspace fallback.

For CI, an administrator must copy the approved value into a protected CI
environment setting that untrusted pull requests cannot edit. Do not derive it
from the checkout, hardcode it in a workflow, or allow pull-request input to
override it. Merge-gate configuration is a separate owner-controlled step.
For other shells or deployment environments, provision the external value
separately; a clone of this repository intentionally lacks trusted configuration.

This protects against replacement of workspace data, not a compromised runner,
edited verifier, or administrator with configuration-write access. Restrict
configuration changes to authorized maintainers and review verifier changes.
The digest is public metadata, not a password; the Secrets store is used for
its separation from editable source files. It is not claimed to be immutable or
independently access-locked from every collaborator.

## Authorized baseline update

1. Obtain the proposed archive from the source owner through a separate,
   authenticated transfer. Never approve a new digest just because the local
   check fails.
2. An authorized reviewer compares the previous and proposed exports, verifies
   provenance and intended website changes, and computes the candidate SHA-256
   from that independently received archive.
3. Before changing external configuration, record the old and new fingerprints,
   archive identity, change reason, reviewer approval, and approval date in the
   owner's access-controlled release/change record outside this repository.
   Preserve prior records for audit and rollback. A PR comment or this document
   alone is not an approval record.
4. Only after approval, a configuration administrator updates the external
   `CLASSSCRIBE_SOURCE_ZIP_SHA256` in each execution environment. Never add a
   script that re-pins it automatically from workspace bytes.
5. Replace the ZIP and manifest with the approved export, update the protected
   website files together, and run `pnpm check:classscribe-source-integrity` and
   `pnpm test:classscribe-source-integrity`. Record the successful verification
   with the external approval. Document the new reference here without treating
   this file as authoritative.
6. Any rollback requires approval of the earlier baseline and restoration of
   both its external fingerprint and matching source files. Do not disable the
   check to proceed.
