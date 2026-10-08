import { runPrivacyRetentionJob } from "./privacy-retention";

try {
  const result = await runPrivacyRetentionJob();
  // Counts only: never write identifiers, email addresses, content, or tokens.
  console.log(JSON.stringify(result));
} catch {
  console.error("Privacy retention job failed; no account deletion was confirmed.");
  process.exitCode = 1;
}