import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../src/run-nightly-classscribe-credits.ts", import.meta.url));

for (const args of [[], ["--test-delivery"]]) {
  test(`inactive scheduler blocks ${args.length ? "delivery test" : "normal run"} before external access`, () => {
    const env = { ...process.env };
    delete env.CREDITS_RECONCILIATION_EXECUTION_ENABLED;
    const result = spawnSync(process.execPath, ["--import", "tsx", runner, ...args], {
      env,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 64 * 1024,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr.trim()), {
      status: "blocked",
      reason: "owner_activation_required",
      writes: 0,
      notification: "not_attempted",
    });
  });
}
