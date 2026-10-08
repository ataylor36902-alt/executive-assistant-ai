import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mediaStorageFixture = path.join(root, "test/fixtures/edu-object-storage.mjs");
const transcriptionFixture = path.join(root, "test/fixtures/edu-managed-transcription.mjs");

await build({
  absWorkingDir: root,
  entryPoints: ["test/classscribe-edu-media.test.mjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: ".edu-media-test.cjs",
  alias: {
    "@workspace/db": "../../lib/db/src/index.ts",
    "@clerk/express": "./test/fixtures/clerk-test-auth.mjs",
  },
  plugins: [{
    name: "edu-media-test-services",
    setup(esbuild) {
      esbuild.onResolve({ filter: /^@workspace\/integrations-openai-ai-server\/audio$/ }, () => ({
        path: transcriptionFixture,
      }));
      esbuild.onResolve({ filter: /^(?:\.\.\/lib|\.{1,2})\/objectStorage$/ }, () => ({
        path: mediaStorageFixture,
      }));
    },
  }],
});