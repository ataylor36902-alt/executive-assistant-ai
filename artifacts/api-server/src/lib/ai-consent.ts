import { eq } from "drizzle-orm";
import { classscribeLegacyDocumentsTable, db } from "@workspace/db";

export const aiConsentNotice = {
  version: "2026-10-06",
  title: "Permission to use AI and transcription services",
  notice: [
    "To answer questions and create study tools, ClassScribe sends your submitted questions, notes, transcripts, selected course materials and relevant study context to OpenAI or Anthropic (Claude). Images you submit for AI analysis may also be sent.",
    "For cloud transcription, the audio you submit is sent to OpenAI or ElevenLabs. Device speech recognition may use Apple or Google speech services, depending on your device and settings.",
    "Requests pass through ClassScribe’s server and Replit integration infrastructure. These providers process the submitted information to perform the feature you request. Do not submit information you lack permission to share.",
    "Allowing applies to future AI and transcription requests for this library until you withdraw permission in Privacy controls. Declining leaves your existing library, manual notes and courses available, but prevents these processing requests. Withdrawal stops new requests; it cannot recall information already processed.",
  ].join("\n\n"),
};

// Keep the gate ahead of provider calls, credit debits and transcription uploads.
export const aiProcessingPath = /^(?:\/ai(?:\/.*)?|\/support|\/transcribe|\/classscribe\/ask|\/schedule\/import-preview|\/study-plans\/import|\/courses\/[^/]+\/(?:study-guide|syllabus\/(?:upload|preview))|\/lectures\/[^/]+\/(?:transcribe|analyze)|\/edu\/courses\/[^/]+\/lectures\/[^/]+\/transcribe)\/?$/i;
export const aiConsentPath = (libraryHash: string) => `private/ai-consents/${libraryHash}`;

export async function readAiConsent(libraryHash: string): Promise<boolean> {
  const [record] = await db.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, aiConsentPath(libraryHash))).limit(1);
  const data = record?.data as { version?: unknown; accepted?: unknown } | undefined;
  return data?.version === aiConsentNotice.version && data.accepted === true;
}
