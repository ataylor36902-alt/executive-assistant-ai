import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const outfile = ".syllabus-tab-test.cjs";
try {
  await build({
    entryPoints: ["test/syllabus-tab.test.tsx"],
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", outfile,
    external: ["react", "react-test-renderer", "@tanstack/react-query"],
    alias: {
      "@workspace/api-client-react": "./test/fixtures/syllabus-client.tsx",
      "lucide-react": "./test/fixtures/syllabus-ui.tsx",
      "@/components/ui/button": "./test/fixtures/syllabus-ui.tsx",
      "@/components/ui/input": "./test/fixtures/syllabus-ui.tsx",
      "@/components/ui/textarea": "./test/fixtures/syllabus-ui.tsx",
      "@/hooks/use-toast": "./test/fixtures/syllabus-ui.tsx",
    },
  });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outfile, { force: true });
}
