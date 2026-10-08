# Required website integrity check

The workflow in `workflows/classscribe-source-integrity.yml` publishes the
`classscribe-source-integrity` check for every pull request and merge-queue run.
There are no path filters, secret inputs, application dependencies to install,
or database/provider calls. A nonzero exit from
`pnpm check:classscribe-source-integrity` fails the job.

The checker receives the owner-approved public archive fingerprint from the
repository Actions variable `CLASSSCRIBE_SOURCE_ZIP_SHA256`. This is configuration,
not a credential or a GitHub secret. Provision it from the independently approved
owner setting, never by computing and approving a replacement from an archive in
the pull request. Missing, malformed, or mismatched configuration fails the check.
The read-only workflow token cannot change this repository setting.

## Required repository policy

The hosting repository must have an active branch ruleset named
**ClassScribe source integrity**, targeting its default branch, with:

- `classscribe-source-integrity` required from the GitHub Actions app;
- the branch required to be up to date before merge;
- no bypass actors.
- the owner-approved archive fingerprint stored outside the repository files in
  the repository Actions variable named above.

These settings live in GitHub, not in the workflow YAML. A failed or missing
required check must block merging. If the job name changes, update the branch
rules at the same time; otherwise the required check will never report.

`classscribe-source-integrity.ruleset.json` records the API configuration for
this policy. Its integration ID was verified against the live GitHub Actions
check. The JSON file does not apply itself; repository administrators must
create or update the matching ruleset in GitHub.

This check verifies the protected website baseline only. It does not assert
that the full application build or the scheduled billing checks are ready.
