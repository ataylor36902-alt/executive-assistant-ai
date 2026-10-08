# Required website integrity check

The workflow in `workflows/classscribe-source-integrity.yml` publishes the
`classscribe-source-integrity` check for every pull request and merge-queue run.
There are no path filters, secret inputs, application dependencies to install,
or database/provider calls. A nonzero exit from
`pnpm check:classscribe-source-integrity` fails the job.

## Required repository policy

The hosting repository must have an active branch ruleset named
**ClassScribe source integrity**, targeting its default branch, with:

- `classscribe-source-integrity` required from the GitHub Actions app;
- the branch required to be up to date before merge;
- no bypass actors.

These settings live in GitHub, not in the workflow YAML. A failed or missing
required check must block merging. If the job name changes, update the branch
rules at the same time; otherwise the required check will never report.

`classscribe-source-integrity.ruleset.json` records the API configuration for
this policy. Its integration ID was verified against the live GitHub Actions
check. The JSON file does not apply itself; repository administrators must
create or update the matching ruleset in GitHub.

This check verifies the protected website baseline only. It does not assert
that the full application build or the scheduled billing checks are ready.
