import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  db, coursesTable, courseMembersTable, classscribeEduLicenseGrantsTable, activeInstitutionCondition,
  classscribeEduCourseLicenseBindingsTable,
  eduGroupsTable, eduGroupMembersTable, eduLecturesTable, eduLectureGroupsTable,
  eduSourcesTable, eduSourceGroupsTable, classscribePrivacyDeletionOutboxTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

async function deleteLectureAudioObject(courseId: string, lectureId: string, key: string) {
  const ownerScopedPrefix = `edu-media/${courseId}/lectures/${lectureId}/`;
  if (!key.startsWith(ownerScopedPrefix) || key.includes("..")) {
    throw new Error("EDU audio object key is outside the lecture scope");
  }
  await storage.deleteObject(`/objects/${key}`);
}
async function queueLectureAudioDeletion(courseId: string, lectureId: string, key: string) {
  const ownerScopedPrefix = `edu-media/${courseId}/lectures/${lectureId}/`;
  const objectId = key.startsWith(ownerScopedPrefix) ? key.slice(ownerScopedPrefix.length) : "";
  if (!uuidPattern.test(lectureId) || !uuidPattern.test(objectId)) {
    throw new Error("EDU audio object key is outside the lecture scope");
  }
  const id = randomUUID();
  await db.insert(classscribePrivacyDeletionOutboxTable).values({
    id,
    libraryHash: createHash("sha256").update(`edu-course:${courseId}`).digest("hex"),
    pendingProviders: [`storage:${key}`],
    nextAttemptAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    lastErrorCode: "edu_audio_cleanup_scheduled",
  });
  return id;
}
async function retryLectureAudioDeletion(id: string) {
  await db.update(classscribePrivacyDeletionOutboxTable).set({
    attempts: "1",
    nextAttemptAt: new Date(Date.now() + 60_000),
    lastErrorCode: "edu_audio_cleanup_failed",
  }).where(eq(classscribePrivacyDeletionOutboxTable.id, id));
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const AUDIO_MIMES = new Set(["audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/webm", "audio/aac", "audio/ogg"]);
const activeTranscriptions = new Set<string>();
const userTranscriptions = new Map<string, number>();
const userRequestWindows = new Map<string, { start: number; count: number }>();

type Access = { id: string; ownerId: string; agreementRef: string; role: "instructor" | "student" };
function userId(req: Request) { return getAuth(req).userId; }
function jsonError(res: Response, status: number, error: string | { code: string; error: string }) {
  res.status(status).json(typeof error === "string" ? { error } : error);
}

async function courseAccess(req: Request, res: Response, courseId: string): Promise<Access | undefined> {
  const uid = userId(req);
  if (!uid || !uuidPattern.test(courseId)) { jsonError(res, 404, "EDU course not found"); return; }
  const [course] = await db.select({
    id: coursesTable.id, ownerId: coursesTable.ownerId, memberId: courseMembersTable.userId,
    agreementRef: classscribeEduCourseLicenseBindingsTable.signedAgreementRef,
  }).from(coursesTable).innerJoin(classscribeEduCourseLicenseBindingsTable, eq(
    classscribeEduCourseLicenseBindingsTable.courseId, coursesTable.id,
  )).leftJoin(courseMembersTable, and(
    eq(courseMembersTable.courseId, coursesTable.id), eq(courseMembersTable.userId, uid),
  )).where(and(eq(coursesTable.id, courseId), eq(coursesTable.eduEnabled, true))).limit(1);
  if (!course || !course.ownerId || (course.ownerId !== uid && !course.memberId)) {
    jsonError(res, 404, "EDU course not found"); return;
  }
  const activeAgreementRef = (req as Request & { eduAgreementRef?: string }).eduAgreementRef;
  if (!activeAgreementRef || activeAgreementRef !== course.agreementRef) {
    jsonError(res, 404, "EDU course not found"); return;
  }
  const now = new Date();
  const [grant] = await db.select({ userId: classscribeEduLicenseGrantsTable.userId })
    .from(classscribeEduLicenseGrantsTable).where(and(
      eq(classscribeEduLicenseGrantsTable.userId, course.ownerId),
      eq(classscribeEduLicenseGrantsTable.signedAgreementRef, course.agreementRef),
      lte(classscribeEduLicenseGrantsTable.approvedAt, now),
      gt(classscribeEduLicenseGrantsTable.expiresAt, now),
      isNull(classscribeEduLicenseGrantsTable.revokedAt),
      activeInstitutionCondition(now),
    )).limit(1);
  if (!grant) {
    if (course.ownerId === uid) jsonError(res, 403, { code: "edu_license_required", error: "An active EDU license is required." });
    else jsonError(res, 404, "EDU course not found");
    return;
  }
  return {
    id: course.id, ownerId: course.ownerId, agreementRef: course.agreementRef,
    role: course.ownerId === uid ? "instructor" : "student",
  };
}

async function owned(req: Request, res: Response, courseId: string) {
  const access = await courseAccess(req, res, courseId);
  if (!access) return;
  if (access.role !== "instructor") { jsonError(res, 404, "EDU course not found"); return; }
  return access;
}

async function validGroups(courseId: string, groupIds: unknown): Promise<string[] | undefined> {
  if (!Array.isArray(groupIds) || groupIds.some(id => typeof id !== "string" || !uuidPattern.test(id))) return;
  const unique = [...new Set(groupIds as string[])];
  if (!unique.length) return unique;
  const rows = await db.select({ id: eduGroupsTable.id }).from(eduGroupsTable)
    .where(and(eq(eduGroupsTable.courseId, courseId), inArray(eduGroupsTable.id, unique)));
  return rows.length === unique.length ? unique : undefined;
}

type SourceVisibility = "private" | "groups" | "class";
async function sourceScope(
  courseId: string,
  visibilityInput: unknown,
  groupIdsInput: unknown,
  hasGroupIds: boolean,
): Promise<{ visibility: SourceVisibility; groupIds: string[] } | undefined> {
  const visibility = visibilityInput === undefined ? "private" : visibilityInput;
  if (visibility !== "private" && visibility !== "groups" && visibility !== "class") return;
  if (visibility !== "groups") {
    if (hasGroupIds) return;
    return { visibility, groupIds: [] };
  }
  if (!hasGroupIds) return;
  const groupIds = await validGroups(courseId, groupIdsInput);
  if (!groupIds?.length) return;
  return { visibility, groupIds };
}

function audioSignature(data: Buffer, mime: string) {
  if (mime === "audio/wav" || mime === "audio/x-wav") return data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE";
  if (mime === "audio/webm") return data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
  if (mime === "audio/ogg") return data.toString("ascii", 0, 4) === "OggS";
  if (mime === "audio/mp4") return data.length > 12 && data.toString("ascii", 4, 8) === "ftyp";
  if (mime === "audio/mpeg") return data.toString("ascii", 0, 3) === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0);
  if (mime === "audio/aac") return data[0] === 0xff && (data[1] & 0xf6) === 0xf0;
  return false;
}

function validBase64(value: string) {
  if (!value.length || value.length % 4 !== 0) return false;
  const paddingIndex = value.indexOf("=");
  const dataEnd = paddingIndex < 0 ? value.length : paddingIndex;
  const paddingLength = value.length - dataEnd;
  if (paddingLength > 2 || (paddingLength > 0 && dataEnd % 4 !== 4 - paddingLength)) return false;
  for (let index = 0; index < dataEnd; index++) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  return true;
}

function publicLecture(row: typeof eduLecturesTable.$inferSelect) {
  const { audioObjectKey: _key, ...safe } = row;
  return safe;
}

function publicSource(row: typeof eduSourcesTable.$inferSelect, groupIds: string[] = []) {
  const { objectKey: _key, ...safe } = row;
  return { ...safe, visibility: safe.visibility ?? "private", groupIds };
}

async function lectureAccess(courseId: string, lectureId: string, access: Access, uid: string) {
  if (!uuidPattern.test(lectureId)) return undefined;
  const [lecture] = await db.select().from(eduLecturesTable).where(and(
    eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, courseId),
  )).limit(1);
  if (!lecture) return undefined;
  if (access.role === "instructor") return lecture;
  const groups = await db.select({ groupId: eduLectureGroupsTable.groupId }).from(eduLectureGroupsTable)
    .innerJoin(eduGroupMembersTable, and(
      eq(eduGroupMembersTable.groupId, eduLectureGroupsTable.groupId),
      eq(eduGroupMembersTable.courseId, eduLectureGroupsTable.courseId),
      eq(eduGroupMembersTable.userId, uid),
    )).where(and(
      eq(eduLectureGroupsTable.lectureId, lectureId),
      eq(eduLectureGroupsTable.courseId, courseId),
    )).limit(1);
  return groups.length ? lecture : undefined;
}

router.get("/edu/courses/:id/groups", async (req, res): Promise<void> => {
  const access = await courseAccess(req, res, req.params.id);
  if (!access) return;
  const uid = userId(req)!;
  if (access.role === "instructor") {
    const groups = await db.select().from(eduGroupsTable).where(eq(eduGroupsTable.courseId, access.id))
      .orderBy(asc(eduGroupsTable.createdAt));
    const memberships = groups.length ? await db.select({
      groupId: eduGroupMembersTable.groupId, userId: eduGroupMembersTable.userId,
    }).from(eduGroupMembersTable).where(and(
      eq(eduGroupMembersTable.courseId, access.id),
      inArray(eduGroupMembersTable.groupId, groups.map(group => group.id)),
    )) : [];
    const membersByGroup = new Map<string, string[]>();
    for (const membership of memberships) {
      membersByGroup.set(membership.groupId, [...(membersByGroup.get(membership.groupId) ?? []), membership.userId]);
    }
    res.json({ groups: groups.map(group => ({ ...group, memberIds: membersByGroup.get(group.id) ?? [] })) });
    return;
  }
  const groups = await db.select({
    id: eduGroupsTable.id, courseId: eduGroupsTable.courseId, name: eduGroupsTable.name,
    description: eduGroupsTable.description, createdAt: eduGroupsTable.createdAt,
  }).from(eduGroupsTable).innerJoin(eduGroupMembersTable, and(
    eq(eduGroupMembersTable.groupId, eduGroupsTable.id), eq(eduGroupMembersTable.courseId, access.id),
  )).where(and(eq(eduGroupsTable.courseId, access.id), eq(eduGroupMembersTable.userId, uid)));
  res.json({ groups: groups.map(group => ({ ...group, memberIds: [uid] })) });
});

router.post("/edu/courses/:id/groups", async (req, res): Promise<void> => {
  const access = await owned(req, res, req.params.id);
  if (!access) return;
  const name = req.body?.name;
  const description = req.body?.description;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120 ||
    (description !== undefined && description !== null && (typeof description !== "string" || description.length > 2000))) {
    jsonError(res, 400, "Provide a group name under 120 characters and an optional description under 2,000 characters."); return;
  }
  const [group] = await db.insert(eduGroupsTable).values({
    courseId: access.id, name: name.trim(), description: description?.trim() || null,
  }).returning();
  res.status(201).json({ group });
});

router.put("/edu/courses/:id/groups/:groupId/members", async (req, res): Promise<void> => {
  const access = await owned(req, res, req.params.id);
  if (!access) return;
  const groupId = req.params.groupId;
  if (!uuidPattern.test(groupId)) { jsonError(res, 404, "Group not found"); return; }
  const [group] = await db.select({ id: eduGroupsTable.id }).from(eduGroupsTable)
    .where(and(eq(eduGroupsTable.id, groupId), eq(eduGroupsTable.courseId, access.id)));
  if (!group) { jsonError(res, 404, "Group not found"); return; }
  const memberIds = req.body?.memberIds;
  if (!Array.isArray(memberIds) || memberIds.length > 1000 ||
    memberIds.some((id: unknown) => typeof id !== "string" || !id.length || id.length > 200)) {
    jsonError(res, 400, "memberIds must be an array of at most 1,000 course member IDs."); return;
  }
  const ids = [...new Set(memberIds as string[])].filter(id => id !== access.ownerId);
  if (ids.length) {
    const actual = await db.select({ userId: courseMembersTable.userId }).from(courseMembersTable)
      .where(and(eq(courseMembersTable.courseId, access.id), inArray(courseMembersTable.userId, ids)));
    if (actual.length !== ids.length) { jsonError(res, 400, "Every group member must be an enrolled member of this course."); return; }
  }
  await db.transaction(async tx => {
    await tx.delete(eduGroupMembersTable).where(and(
      eq(eduGroupMembersTable.groupId, groupId), eq(eduGroupMembersTable.courseId, access.id),
    ));
    if (ids.length) await tx.insert(eduGroupMembersTable).values(ids.map(id => ({
      groupId, courseId: access.id, userId: id,
    })));
  });
  res.json({ groupId, memberIds: ids });
});

router.post("/edu/courses/:id/lectures", async (req, res): Promise<void> => {
  const access = await owned(req, res, req.params.id);
  if (!access) return;
  const { title, professor = "", lectureDate } = req.body ?? {};
  const parsedDate = lectureDate === undefined ? new Date() : typeof lectureDate === "string" ? new Date(lectureDate) : new Date(NaN);
  if (typeof title !== "string" || !title.trim() || title.trim().length > 200 ||
    typeof professor !== "string" || professor.length > 200 ||
    !Number.isFinite(parsedDate.getTime())) {
    jsonError(res, 400, "Provide a title, optional professor, and valid lectureDate."); return;
  }
  const [lecture] = await db.insert(eduLecturesTable).values({
    courseId: access.id, createdBy: userId(req)!, title: title.trim(), professor: professor.trim(), lectureDate: parsedDate,
  }).returning();
  res.status(201).json({ lecture: publicLecture(lecture) });
});

router.get("/edu/courses/:id/lectures", async (req, res): Promise<void> => {
  const access = await courseAccess(req, res, req.params.id);
  if (!access) return;
  const uid = userId(req)!;
  if (access.role === "instructor") {
    const lectures = await db.select().from(eduLecturesTable).where(eq(eduLecturesTable.courseId, access.id))
      .orderBy(asc(eduLecturesTable.lectureDate));
    const shares = lectures.length ? await db.select({
      lectureId: eduLectureGroupsTable.lectureId, groupId: eduLectureGroupsTable.groupId,
    }).from(eduLectureGroupsTable).where(and(
      eq(eduLectureGroupsTable.courseId, access.id),
      inArray(eduLectureGroupsTable.lectureId, lectures.map(lecture => lecture.id)),
    )) : [];
    const groupsByLecture = new Map<string, string[]>();
    for (const share of shares) {
      groupsByLecture.set(share.lectureId, [...(groupsByLecture.get(share.lectureId) ?? []), share.groupId]);
    }
    res.json({ lectures: lectures.map(lecture => ({
      ...publicLecture(lecture), groupIds: groupsByLecture.get(lecture.id) ?? [],
    })) });
    return;
  }
  const lectures = await db.selectDistinct({ lecture: eduLecturesTable, groupId: eduLectureGroupsTable.groupId })
    .from(eduLecturesTable).innerJoin(eduLectureGroupsTable, and(
      eq(eduLectureGroupsTable.lectureId, eduLecturesTable.id), eq(eduLectureGroupsTable.courseId, access.id),
    )).innerJoin(eduGroupMembersTable, and(
      eq(eduGroupMembersTable.groupId, eduLectureGroupsTable.groupId),
      eq(eduGroupMembersTable.courseId, access.id), eq(eduGroupMembersTable.userId, uid),
    )).where(eq(eduLecturesTable.courseId, access.id)).orderBy(asc(eduLecturesTable.lectureDate));
  const groupsByLecture = new Map<string, string[]>();
  for (const row of lectures) {
    groupsByLecture.set(row.lecture.id, [...(groupsByLecture.get(row.lecture.id) ?? []), row.groupId]);
  }
  const lectureById = new Map(lectures.map(row => [row.lecture.id, row.lecture]));
  res.json({ lectures: [...lectureById.values()].map(lecture => ({
    ...publicLecture(lecture), groupIds: groupsByLecture.get(lecture.id) ?? [],
  })) });
});

router.post("/edu/courses/:id/lectures/:lectureId/share", async (req, res): Promise<void> => {
  const access = await owned(req, res, req.params.id);
  if (!access) return;
  const lectureId = req.params.lectureId;
  const groupIds = await validGroups(access.id, req.body?.groupIds);
  if (!groupIds) { jsonError(res, 400, "groupIds must contain only groups from this course."); return; }
  if (!uuidPattern.test(lectureId)) { jsonError(res, 404, "Lecture not found"); return; }
  const [lecture] = await db.select({ id: eduLecturesTable.id }).from(eduLecturesTable)
    .where(and(eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id)));
  if (!lecture) { jsonError(res, 404, "Lecture not found"); return; }
  await db.transaction(async tx => {
    await tx.delete(eduLectureGroupsTable).where(and(
      eq(eduLectureGroupsTable.lectureId, lectureId), eq(eduLectureGroupsTable.courseId, access.id),
    ));
    if (groupIds.length) await tx.insert(eduLectureGroupsTable).values(groupIds.map(groupId => ({
      lectureId, courseId: access.id, groupId,
    })));
  });
  res.json({ lectureId, groupIds });
});

router.patch("/edu/courses/:id/lectures/:lectureId", async (req, res): Promise<void> => {
  const access = await owned(req, res, req.params.id);
  if (!access) return;
  const lectureId = req.params.lectureId;
  if (!uuidPattern.test(lectureId)) { jsonError(res, 404, "Lecture not found"); return; }
  const patch = req.body ?? {};
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !["title", "professor", "lectureDate"].includes(key)) ||
    patch.title !== undefined && (typeof patch.title !== "string" || !patch.title.trim() || patch.title.length > 200) ||
    patch.professor !== undefined && (typeof patch.professor !== "string" || patch.professor.length > 200) ||
    patch.lectureDate !== undefined && (typeof patch.lectureDate !== "string" || !Number.isFinite(new Date(patch.lectureDate).getTime()))) {
    jsonError(res, 400, "Invalid lecture update."); return;
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.professor !== undefined) update.professor = patch.professor.trim();
  if (patch.lectureDate !== undefined) update.lectureDate = new Date(patch.lectureDate);
  const [lecture] = await db.update(eduLecturesTable).set(update).where(and(
    eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id),
  )).returning();
  if (!lecture) { jsonError(res, 404, "Lecture not found"); return; }
  res.json({ lecture: publicLecture(lecture) });
});

router.post("/edu/courses/:id/lectures/:lectureId/transcribe", async (req, res): Promise<void> => {
  const access = await owned(req, res, req.params.id);
  if (!access) return;
  const uid = userId(req)!;
  const lectureId = req.params.lectureId;
  if (!uuidPattern.test(lectureId)) { jsonError(res, 404, "Lecture not found"); return; }
  const [lecture] = await db.select().from(eduLecturesTable).where(and(
    eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id),
  )).limit(1);
  if (!lecture) { jsonError(res, 404, "Lecture not found"); return; }
  if (activeTranscriptions.size >= 2 || (userTranscriptions.get(uid) ?? 0) >= 1 ||
    lecture.transcriptionStatus === "transcribing") {
    jsonError(res, 409, "A transcription is already in progress. Retry shortly."); return;
  }
  const { audio, mime, filename = "lecture-audio" } = req.body ?? {};
  if (typeof audio === "string" && audio.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 8) {
    jsonError(res, 413, "Audio must be at most 20 MB."); return;
  }
  if (typeof audio !== "string" || !validBase64(audio) ||
    typeof mime !== "string" || !AUDIO_MIMES.has(mime) ||
    typeof filename !== "string" || filename.length > 120 || /[\\/\r\n]/.test(filename)) {
    jsonError(res, 400, "Provide base64 audio, a supported audio MIME type, and a safe filename."); return;
  }
  const audioBuffer = Buffer.from(audio, "base64");
  if (!audioBuffer.length || audioBuffer.length > MAX_AUDIO_BYTES) { jsonError(res, 413, "Audio must be at most 20 MB."); return; }
  if (!audioSignature(audioBuffer, mime)) { jsonError(res, 400, "Audio content does not match the declared MIME type."); return; }
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    jsonError(res, 503, "The managed transcription provider is unavailable."); return;
  }
  const now = Date.now();
  const window = userRequestWindows.get(uid);
  const currentWindow = !window || now - window.start >= 60_000 ? { start: now, count: 0 } : window;
  if (currentWindow.count >= 4) { jsonError(res, 429, "Transcription request limit reached; retry in a minute."); return; }
  currentWindow.count++;
  userRequestWindows.set(uid, currentWindow);
  activeTranscriptions.add(lectureId);
  userTranscriptions.set(uid, (userTranscriptions.get(uid) ?? 0) + 1);
  const audioObjectKey = `edu-media/${access.id}/lectures/${lectureId}/${randomUUID()}`;
  const queuedAudioDeletions: Array<{ key: string; outboxId: string }> = [];
  const queuedAudioKeys = new Set<string>();
  let completedLecture: typeof eduLecturesTable.$inferSelect | undefined;
  let failure: { status: number; message: string } | undefined;
  let cleanupPending = false;
  try {
    try {
      const outboxId = await queueLectureAudioDeletion(access.id, lectureId, audioObjectKey);
      queuedAudioDeletions.push({ key: audioObjectKey, outboxId });
      queuedAudioKeys.add(audioObjectKey);
      if (lecture.audioObjectKey) {
        const previousOutboxId = await queueLectureAudioDeletion(access.id, lectureId, lecture.audioObjectKey);
        queuedAudioDeletions.push({ key: lecture.audioObjectKey, outboxId: previousOutboxId });
        queuedAudioKeys.add(lecture.audioObjectKey);
      }
    } catch (error) {
      cleanupPending = Boolean(lecture.audioObjectKey);
      throw error;
    }
    await db.update(eduLecturesTable).set({
      transcript: null, durationSeconds: null, audioObjectKey: null, audioMimeType: null, audioFilename: null,
      transcriptionStatus: "transcribing", updatedAt: new Date(),
    }).where(and(eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id)));
    try {
      await storage.uploadObject(audioObjectKey, audioBuffer, mime);
      await db.update(eduLecturesTable).set({
        audioObjectKey, audioMimeType: mime, audioFilename: filename, updatedAt: new Date(),
      }).where(and(eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id)));
    } catch (error) {
      req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "EDU private lecture audio storage failed");
      await db.update(eduLecturesTable).set({
        transcript: null, transcriptionStatus: "failed", updatedAt: new Date(),
      }).where(and(eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id)));
      throw error;
    }
    const { openai } = await import("@workspace/integrations-openai-ai-server/audio");
    const file = new File([new Uint8Array(audioBuffer)], filename, { type: mime });
    const result = await openai.audio.transcriptions.create({ file, model: "gpt-4o-mini-transcribe", response_format: "json" });
    const transcript = result.text?.trim();
    if (!transcript) throw new Error("Transcription provider returned no text");
    const currentAccess = await courseAccess(req, res, access.id);
    if (!currentAccess || currentAccess.role !== "instructor" || currentAccess.ownerId !== access.ownerId ||
      currentAccess.agreementRef !== access.agreementRef) {
      await db.update(eduLecturesTable).set({
        transcript: null, transcriptionStatus: "failed", updatedAt: new Date(),
      }).where(and(eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id)));
      failure = { status: 403, message: "Your EDU authorization changed during transcription." };
    } else {
      const [saved] = await db.update(eduLecturesTable).set({
        transcript, transcriptionStatus: "complete", updatedAt: new Date(),
      }).where(and(eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id))).returning();
      if (!saved) failure = { status: 404, message: "Lecture not found" };
      else completedLecture = saved;
    }
  } catch (error) {
    await db.update(eduLecturesTable).set({ transcript: null, transcriptionStatus: "failed", updatedAt: new Date() })
      .where(and(eq(eduLecturesTable.id, lectureId), eq(eduLecturesTable.courseId, access.id)));
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    failure = {
      status: status === 429 ? 429 : 503,
      message: status === 429
        ? "The transcription provider is rate limiting requests. Retry shortly."
        : "Transcription failed. Keep the recording on your device and re-upload it to retry.",
    };
  } finally {
    for (const deletion of queuedAudioDeletions) {
      try {
        await deleteLectureAudioObject(access.id, lectureId, deletion.key);
        await db.delete(classscribePrivacyDeletionOutboxTable)
          .where(eq(classscribePrivacyDeletionOutboxTable.id, deletion.outboxId));
      } catch (error) {
        cleanupPending = true;
        req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "EDU lecture audio cleanup remains queued");
        try {
          await retryLectureAudioDeletion(deletion.outboxId);
        } catch (retryError) {
          req.log.error({ errorType: retryError instanceof Error ? retryError.name : "unknown" }, "EDU lecture audio cleanup retry scheduling failed");
        }
      }
    }
    if (queuedAudioKeys.size) {
      try {
        await db.update(eduLecturesTable).set({
          audioObjectKey: null, audioMimeType: null, audioFilename: null, updatedAt: new Date(),
        }).where(and(
          eq(eduLecturesTable.id, lectureId),
          eq(eduLecturesTable.courseId, access.id),
          inArray(eduLecturesTable.audioObjectKey, [...queuedAudioKeys]),
        ));
      } catch (error) {
        cleanupPending = true;
        req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "EDU lecture audio reference cleanup failed");
      }
    }
    activeTranscriptions.delete(lectureId);
    const count = (userTranscriptions.get(uid) ?? 1) - 1;
    if (count) userTranscriptions.set(uid, count); else userTranscriptions.delete(uid);
  }
  if (res.headersSent) return;
  const cleanupNotice = " Server-side audio cleanup is pending; keep the original recording on your device and re-upload it to retry.";
  if (failure) {
    res.status(failure.status).json({
      error: cleanupPending ? `${failure.message}${cleanupNotice}` : failure.message,
      cleanupPending,
    });
  } else if (completedLecture) {
    res.json({
      lecture: publicLecture(completedLecture),
      cleanupPending,
      ...(cleanupPending ? { notice: cleanupNotice.trim() } : {}),
    });
  } else {
    res.status(503).json({
      error: cleanupPending
        ? `Transcription failed.${cleanupNotice}`
        : "Transcription failed. Keep the recording on your device and re-upload it to retry.",
      cleanupPending,
    });
  }
});

router.get("/edu/courses/:id/lectures/:lectureId/audio", async (req, res): Promise<void> => {
  const access = await courseAccess(req, res, req.params.id);
  if (!access) return;
  const lecture = await lectureAccess(access.id, req.params.lectureId, access, userId(req)!);
  if (!lecture?.audioObjectKey) { jsonError(res, 404, "Lecture audio not found"); return; }
  try {
    const path = `/objects/${lecture.audioObjectKey}`;
    const file = await storage.getObjectEntityFile(path);
    res.setHeader("Content-Type", lecture.audioMimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${(lecture.audioFilename ?? "lecture-audio").replace(/["\r\n]/g, "")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    file.createReadStream().on("error", error => {
      req.log.error({ err: error }, "EDU private lecture audio stream failed");
      if (!res.headersSent) res.status(503).end(); else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "EDU private lecture audio download failed");
    jsonError(res, 503, "Lecture audio is temporarily unavailable.");
  }
});

router.post("/edu/courses/:id/sources/links", async (req, res): Promise<void> => {
  const access = await owned(req, res, req.params.id);
  if (!access) return;
  const { title, url, description = null, visibility: rawVisibility, groupIds: rawGroupIds } = req.body ?? {};
  const scope = await sourceScope(
    access.id, rawVisibility, rawGroupIds, Object.hasOwn(req.body ?? {}, "groupIds"),
  );
  let parsedUrl: URL | undefined;
  try { parsedUrl = new URL(url); } catch { /* validated below */ }
  if (typeof title !== "string" || !title.trim() || title.length > 200 ||
    typeof url !== "string" || !parsedUrl || !["https:", "http:"].includes(parsedUrl.protocol) ||
    description !== null && (typeof description !== "string" || description.length > 2000) || !scope) {
    jsonError(res, 400, "Provide a title, HTTP(S) URL, optional description, and a valid private, groups, or class visibility."); return;
  }
  const [source] = await db.insert(eduSourcesTable).values({
    courseId: access.id, createdBy: userId(req)!, kind: "link",
    title: title.trim(), url, description, visibility: scope.visibility,
  }).returning();
  if (scope.groupIds.length) await db.insert(eduSourceGroupsTable).values(scope.groupIds.map(groupId => ({
    sourceId: source.id, courseId: access.id, groupId,
  })));
  res.status(201).json({ source: publicSource(source, scope.groupIds) });
});

router.post("/edu/courses/:id/sources/uploads", async (req, res): Promise<void> => {
  const access = await owned(req, res, req.params.id);
  if (!access) return;
  const { title, filename, mime, data, description = null, visibility: rawVisibility, groupIds: rawGroupIds } = req.body ?? {};
  const scope = await sourceScope(
    access.id, rawVisibility, rawGroupIds, Object.hasOwn(req.body ?? {}, "groupIds"),
  );
  if (typeof title !== "string" || !title.trim() || title.length > 200 ||
    typeof filename !== "string" || filename.length > 180 || /[\\/\r\n]/.test(filename) ||
    !["application/pdf", "text/plain"].includes(mime) || typeof data !== "string" ||
    data.length > Math.ceil(MAX_SOURCE_BYTES * 4 / 3) + 8 || !validBase64(data) ||
    description !== null && (typeof description !== "string" || description.length > 2000) || !scope) {
    jsonError(res, 400, "Provide a PDF or TXT upload under 10 MB with valid metadata and explicit visibility."); return;
  }
  const buffer = Buffer.from(data, "base64");
  const validSignature = mime === "application/pdf"
    ? buffer.subarray(0, 5).toString("ascii") === "%PDF-"
    : buffer.length > 0 && !buffer.includes(0) && buffer.toString("utf8").includes("\ufffd") === false;
  if (!buffer.length || buffer.length > MAX_SOURCE_BYTES) { jsonError(res, 413, "Source files must be at most 10 MB."); return; }
  if (!validSignature) { jsonError(res, 400, "File content does not match the declared PDF or TXT type."); return; }
  const objectKey = `edu-media/${access.id}/sources/${randomUUID()}`;
  try {
    await storage.uploadObject(objectKey, buffer, mime);
    const [source] = await db.insert(eduSourcesTable).values({
      courseId: access.id, createdBy: userId(req)!, kind: "upload", title: title.trim(),
      description, objectKey, filename, mimeType: mime, sizeBytes: buffer.length, visibility: scope.visibility,
    }).returning();
    if (scope.groupIds.length) await db.insert(eduSourceGroupsTable).values(scope.groupIds.map(groupId => ({
      sourceId: source.id, courseId: access.id, groupId,
    })));
    res.status(201).json({ source: publicSource(source, scope.groupIds) });
  } catch (error) {
    req.log.error({ err: error }, "EDU source upload failed");
    jsonError(res, 503, "Could not store the source file. Please retry.");
  }
});

router.get("/edu/courses/:id/sources", async (req, res): Promise<void> => {
  const access = await courseAccess(req, res, req.params.id);
  if (!access) return;
  const allSources = await db.select().from(eduSourcesTable).where(eq(eduSourcesTable.courseId, access.id))
    .orderBy(asc(eduSourcesTable.createdAt));
  const groupAssignments = allSources.length ? await db.select({
    sourceId: eduSourceGroupsTable.sourceId, groupId: eduSourceGroupsTable.groupId,
  }).from(eduSourceGroupsTable).where(eq(eduSourceGroupsTable.courseId, access.id)) : [];
  const groupsBySource = new Map<string, string[]>();
  for (const assignment of groupAssignments) {
    groupsBySource.set(assignment.sourceId, [...(groupsBySource.get(assignment.sourceId) ?? []), assignment.groupId]);
  }
  if (access.role === "instructor") {
    res.json({ sources: allSources.map(source => publicSource(source, groupsBySource.get(source.id) ?? [])) });
    return;
  }
  const uid = userId(req)!;
  const groups = await db.select({ id: eduGroupMembersTable.groupId }).from(eduGroupMembersTable)
    .where(and(eq(eduGroupMembersTable.courseId, access.id), eq(eduGroupMembersTable.userId, uid)));
  const memberGroupIds = new Set(groups.map(item => item.id));
  const visible = allSources.flatMap(source => {
    const visibility = source.visibility ?? "private";
    const sourceGroupIds = groupsBySource.get(source.id) ?? [];
    if (visibility === "class") return [{ source, groupIds: [] }];
    if (visibility !== "groups") return [];
    const visibleGroupIds = sourceGroupIds.filter(groupId => memberGroupIds.has(groupId));
    return visibleGroupIds.length ? [{ source, groupIds: visibleGroupIds }] : [];
  });
  res.json({ sources: visible.map(({ source, groupIds }) => publicSource(source, groupIds)) });
});

router.get("/edu/courses/:id/sources/:sourceId/download", async (req, res): Promise<void> => {
  const access = await courseAccess(req, res, req.params.id);
  if (!access) return;
  const sourceId = req.params.sourceId;
  if (!uuidPattern.test(sourceId)) { jsonError(res, 404, "Source file not found"); return; }
  const [source] = await db.select().from(eduSourcesTable).where(and(
    eq(eduSourcesTable.id, sourceId), eq(eduSourcesTable.courseId, access.id),
  )).limit(1);
  if (!source?.objectKey) { jsonError(res, 404, "Source file not found"); return; }
  if (access.role === "student") {
    let canAccess = source.visibility === "class";
    if (source.visibility === "groups") {
      const userGroups = await db.select({ groupId: eduGroupMembersTable.groupId }).from(eduGroupMembersTable)
        .where(and(eq(eduGroupMembersTable.courseId, access.id), eq(eduGroupMembersTable.userId, userId(req)!)));
      const userGroupIds = userGroups.map(row => row.groupId);
      if (userGroupIds.length) {
        const [assignment] = await db.select({ id: eduSourceGroupsTable.id }).from(eduSourceGroupsTable)
          .where(and(
            eq(eduSourceGroupsTable.sourceId, sourceId), eq(eduSourceGroupsTable.courseId, access.id),
            inArray(eduSourceGroupsTable.groupId, userGroupIds),
          )).limit(1);
        canAccess = Boolean(assignment);
      }
    }
    if (!canAccess) {
      jsonError(res, 404, "Source file not found"); return;
    }
  }
  try {
    const file = await storage.getObjectEntityFile(`/objects/${source.objectKey}`);
    res.setHeader("Content-Type", source.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${(source.filename ?? source.title).replace(/["\r\n]/g, "")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    file.createReadStream().on("error", error => {
      req.log.error({ err: error }, "EDU private source stream failed");
      if (!res.headersSent) res.status(503).end(); else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "EDU private source download failed");
    jsonError(res, 503, "Source file is temporarily unavailable.");
  }
});

export default router;