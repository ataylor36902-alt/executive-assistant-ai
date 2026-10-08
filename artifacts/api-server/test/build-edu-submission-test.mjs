import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  absWorkingDir: root, entryPoints: ["test/edu-submission-files.test.mjs"],
  bundle: true, platform: "node", format: "cjs", outfile: ".edu-submission-test.cjs",
  alias: {
    "@workspace/db": "../../lib/db/src/index.ts",
    "@clerk/express": "./test/fixtures/clerk-test-auth.mjs",
  },
  plugins: [{
    name: "submission-private-storage",
    setup(esbuild) {
      esbuild.onResolve({ filter: /^(?:\.\.\/lib|\.{1,2})\/objectStorage$/ }, () => ({
        path: path.join(root, "test/fixtures/edu-object-storage.mjs"),
      }));
    },
  }],
});
