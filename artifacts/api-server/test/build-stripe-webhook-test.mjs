import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test/fixtures/stripe-webhook.mjs");

await build({
  absWorkingDir: root,
  entryPoints: ["test/stripe-webhook.test.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".stripe-webhook-test.mjs",
  plugins: [{
    name: "isolated-stripe-webhook-dependencies",
    setup(build) {
      // Keep app.ts, classscribe-billing.ts, Express and Stripe's signature
      // verifier real. Never import live database/connector/provider clients.
      build.onResolve({ filter: /^@workspace\/db$|\/stripeClient$/ }, () => ({ path: fixture }));
      build.onResolve({ filter: /^\./ }, args => {
        if (args.importer === path.join(root, "src/app.ts") &&
            args.path !== "./lib/classscribe-billing") {
          return { path: args.path, namespace: "unrelated-app-dependency" };
        }
        if (args.importer === path.join(root, "src/lib/classscribe-billing.ts") &&
            ["./classscribe-legacy-access", "./revenuecat-request", "./classscribe-credits"].includes(args.path)) {
          return { path: args.path, namespace: "unused-billing-dependency" };
        }
      });
      build.onLoad({ filter: /.*/, namespace: "unrelated-app-dependency" }, () => ({
        resolveDir: root,
        contents: `
          import pino from "pino";
          const pass = (_req, _res, next) => next();
          export default pass;
          export const aiConsentGate = pass;
          export const privacyWriteLockMiddleware = pass;
          export const CLERK_PROXY_PATH = "/__unused-clerk-proxy";
          export const clerkProxyMiddleware = () => pass;
          export const logger = pino({ level: "silent" });
          export const safeLogUrl = url => url;
        `,
      }));
      build.onResolve({ filter: /^@clerk\/express$/ }, () => ({
        path: "clerk", namespace: "unused-billing-dependency",
      }));
      build.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({
        path: "connectors", namespace: "unused-billing-dependency",
      }));
      build.onLoad({ filter: /.*/, namespace: "unused-billing-dependency" }, () => ({
        contents: `
          const unexpected = () => { throw new Error("Unexpected non-Stripe webhook dependency"); };
          export const validUid = unexpected;
          export const hasRevenueCatCreditsApiKey = unexpected;
          export const revenueCatRequest = unexpected;
          export const fulfillCreditCheckout = unexpected;
          export const clerkMiddleware = () => (_req, _res, next) => next();
          export class ReplitConnectors { constructor() { unexpected(); } }
        `,
      }));
    },
  }],
});
