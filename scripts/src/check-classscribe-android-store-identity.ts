import { readFile } from "node:fs/promises";
import { runAndroidStorePreflight } from "./android-store-preflight";

// Resolve from this script, not the shell's working directory.
const configUrl = new URL("../../artifacts/classscribe-mobile/app.json", import.meta.url);

if (process.argv.length > 2) {
  console.error("ClassScribe Android store identity preflight accepts no arguments and is always read-only.");
  process.exitCode = 1;
} else {
  process.exitCode = await runAndroidStorePreflight(process.env, {
    readConfig: async () => JSON.parse(await readFile(configUrl, "utf8")) as unknown,
    request: async (path, method) => {
      const { revenueCatRequest } = await import("./revenuecatClient");
      return revenueCatRequest<unknown>(path, method);
    },
  }, console);
}
