import { build } from "esbuild";
import { resolve } from "node:path";

const fixture = resolve("test/fixtures/study-guide-ui.tsx");
const replaced = new Set([
  "../lib/store", "../lib/api", "../lib/logic", "../lib/theme",
  "../lib/util", "../lib/credits-actions", "../components/ui",
  "../components/CreditsConfirmSheet", "../components/ExamFeatureAccess",
  "react-native", "expo-router", "@expo/vector-icons",
]);

await build({
  entryPoints: ["test/study-guide.test.jsx"],
  outfile: ".study-guide-test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".js": "jsx" },
  external: ["react", "react-dom/server"],
  plugins: [{
    name: "study-guide-test-dependencies",
    setup(build) {
      build.onResolve({ filter: /^(?:\.\.\/|react-native$|expo-router$|@expo\/vector-icons$)/ }, args => {
        if (args.importer.endsWith("/app/guide.js") && replaced.has(args.path)) {
          return { path: fixture };
        }
        if (replaced.has(args.path) && !args.path.startsWith("../")) {
          return { path: fixture };
        }
      });
    },
  }],
});