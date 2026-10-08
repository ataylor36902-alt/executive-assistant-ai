import app from "./app";
import { logger } from "./lib/logger";
import { startPrivacyDevelopmentScheduler } from "./jobs/privacy-retention";
import { startSubmissionFileCleanupScheduler } from "./lib/edu-submission-files";
import {
  initializeStripeSync,
  stripeSetupErrorCode,
} from "./lib/classscribe-billing";
import { ensureEduCourseFileCleanup, pool } from "@workspace/db";
import { startEduCourseFileCleanupScheduler } from "./jobs/edu-course-file-cleanup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await ensureEduCourseFileCleanup(pool);
  startEduCourseFileCleanupScheduler();
  startPrivacyDevelopmentScheduler();
  // File cleanup is independent of the opt-in production account-retention job.
  startSubmissionFileCleanupScheduler(() => logger.warn("EDU submission file cleanup retry unavailable"));
  try {
    await initializeStripeSync();
  } catch (error) {
    logger.error(
      { errorCode: stripeSetupErrorCode(error) },
      "Stripe initialization failed; billing endpoints will report unavailable",
    );
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void startServer();
