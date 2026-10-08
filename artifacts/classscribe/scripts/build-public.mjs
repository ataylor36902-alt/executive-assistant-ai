import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(artifactRoot, "web-public");
const outputDir = path.join(artifactRoot, "dist", "public");
const requiredFiles = [
  "index.html",
  "clerk.browser.js",
  "platform.js",
  "ai-consent.js",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
];

const missingFiles = requiredFiles.filter((file) => !existsSync(path.join(sourceDir, file)));
if (missingFiles.length) {
  console.error(`Uploaded ClassScribe web assets are missing: ${missingFiles.join(", ")}`);
  process.exit(1);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(path.dirname(outputDir), { recursive: true });
cpSync(sourceDir, outputDir, { recursive: true });
const legalSourceDir = path.join(artifactRoot, "web-src", "static");
for (const file of ["privacy.html", "terms.html", "ai-consent.js"]) {
  const source = path.join(legalSourceDir, file);
  if (!existsSync(source)) {
    console.error(`Required legal page is missing from the active web source: ${file}`);
    process.exit(1);
  }
  copyFileSync(source, path.join(outputDir, file));
}

// Refresh only the public Clerk client configuration for the build environment.
// Never read or serialize CLERK_SECRET_KEY into static output.
const outputIndex = path.join(outputDir, "index.html");
const html = readFileSync(outputIndex, "utf8");
const configMatch = html.match(/window\.CS_CLERK_CONFIG=(\{[^;]*\});/);
if (configMatch) {
  const config = {
    publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "",
    proxyUrl: process.env.VITE_CLERK_PROXY_URL || process.env.CLERK_PROXY_URL || "",
  };
  writeFileSync(outputIndex, html.replace(configMatch[0], `window.CS_CLERK_CONFIG=${JSON.stringify(config)};`));
}

const missingOutputFiles = requiredFiles.filter((file) => !existsSync(path.join(outputDir, file)));
if (missingOutputFiles.length) {
  console.error(`Production output is incomplete: ${missingOutputFiles.join(", ")}`);
  process.exit(1);
}

process.stdout.write(`Copied ClassScribe web assets to ${outputDir}\n`);