import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  absWorkingDir: root,
  entryPoints: ["test/privacy-logging.test.mjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: ".privacy-logging-test.cjs",
});