import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = name => path.join(root, "test", "fixtures", name);
await build({
  absWorkingDir: root,
  entryPoints: ["test/privacy.test.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".privacy-test.mjs",
  plugins: [{
    name: "privacy-test-dependencies",
    setup(build) {
      build.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: fixture("privacy-db.mjs") }));
      build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: fixture("privacy-auth.mjs") }));
      build.onResolve({ filter: /^drizzle-zod$/ }, () => ({
        path: path.resolve(root, "../../lib/db/node_modules/drizzle-zod/index.mjs"),
      }));
      build.onResolve({ filter: /^zod$/ }, () => ({
        path: path.resolve(root, "../../lib/db/node_modules/zod/src/index.ts"),
      }));
      build.onResolve({ filter: /^zod\/v4$/ }, () => ({
        path: path.resolve(root, "../../lib/db/node_modules/zod/src/v4/index.ts"),
      }));
      build.onResolve({ filter: /privacy-billing$/ }, () => ({ path: fixture("privacy-billing.mjs") }));
      build.onResolve({ filter: /modern-library-link$/ }, () => ({ path: fixture("privacy-link.mjs") }));
      build.onResolve({ filter: /objectStorage$/ }, () => ({ path: fixture("privacy-storage.mjs") }));
      build.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({
        path: fixture("privacy-connectors.mjs"),
      }));
    },
  }],
});