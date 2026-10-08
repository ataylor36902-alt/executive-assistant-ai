import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export function safeLogUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  const path = rawUrl.split(/[?#]/, 1)[0];
  return path.replace(
    /(\/api\/privacy\/(?:exports?|downloads?)(?:\/download)?\/)[^/]+/gi,
    "$1[redacted]",
  );
}

const privacySensitiveLogKeys = [
  "transcript",
  "prompt",
  "audio",
  "audioBase64",
  "audio_base64",
  "body",
  "messages",
  "content",
  "question",
  "answer",
  "text",
  "excerpt",
  "input",
  "output",
  "data",
  "file",
  "filename",
  "token",
  "apiKey",
  "api_key",
  "secret",
  "authorization",
  "key",
  "err",
  "error",
];

// Pino's fast-redact supports a single-segment `*` wildcard, not a recursive
// `**` wildcard. Include root and nested paths explicitly so these fields are
// redacted in structured records at every normal request/log nesting depth.
const nestedPrivacyRedactions = privacySensitiveLogKeys.flatMap(key =>
  Array.from({ length: 9 }, (_, depth) =>
    `${depth ? `${Array(depth).fill("*").join(".")}.` : ""}${key}`,
  ),
);

export const privacyLogRedactions = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  ...nestedPrivacyRedactions,
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: privacyLogRedactions,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
