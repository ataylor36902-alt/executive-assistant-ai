#!/bin/bash
set -euo pipefail
# Scheduler-only setup: never push a schema, migrate, seed, run the app,
# reconcile against live services, or send mail from this hook.
pnpm install --frozen-lockfile
