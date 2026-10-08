import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { consumeLegacyRateBudget } from "../lib/classscribe-rate-limit";
import { sendClassscribeSupportEmail } from "../lib/classscribe-support-email";

const router: IRouter = Router();
const MAX_REQUEST_BYTES = 5_000;
const MAX_IN_FLIGHT = 4;
let inFlight = 0;

type EduInquiry = {
  name: string;
  email: string;
  school: string;
  role: string;
  message: string;
};

export function parseEduInquiry(value: unknown): EduInquiry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["name", "email", "school", "role", "message"].includes(key))) return null;
  if ([body.name, body.email, body.school, body.role].some((field) => typeof field !== "string")) return null;
  if (body.message !== undefined && typeof body.message !== "string") return null;

  const inquiry = {
    name: (body.name as string).trim(),
    email: (body.email as string).trim(),
    school: (body.school as string).trim(),
    role: (body.role as string).trim(),
    message: typeof body.message === "string" ? body.message.trim() : "",
  };
  if (!inquiry.name || inquiry.name.length > 120 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(inquiry.email) || inquiry.email.length > 254 ||
    !inquiry.school || inquiry.school.length > 160 ||
    !inquiry.role || inquiry.role.length > 120 ||
    inquiry.message.length > 1200) return null;
  return inquiry;
}

router.post("/edu-inquiries", async (req, res): Promise<void> => {
  let bodySize: number;
  try {
    bodySize = Buffer.byteLength(JSON.stringify(req.body));
  } catch {
    bodySize = Number.POSITIVE_INFINITY;
  }
  if (bodySize > MAX_REQUEST_BYTES) {
    res.status(400).json({ code: "invalid_argument", error: "The inquiry is too large." });
    return;
  }
  const inquiry = parseEduInquiry(req.body);
  if (!inquiry) {
    res.status(400).json({ code: "invalid_argument", error: "Check the required fields and try again." });
    return;
  }
  if (inFlight >= MAX_IN_FLIGHT) {
    res.status(429).json({ code: "rate_limited", error: "School inquiries are busy. Please try again in a minute." });
    return;
  }

  inFlight += 1;
  try {
    const sourceIp = req.socket.remoteAddress || req.ip || "unknown";
    const ipHash = createHash("sha256").update(sourceIp).digest("hex");
    const now = Date.now();
    if (!(await consumeLegacyRateBudget("global:edu-inquiry", 100, now)) ||
      !(await consumeLegacyRateBudget(`ip:edu-inquiry:${ipHash}`, 10, now))) {
      res.status(429).json({ code: "rate_limited", error: "Too many school inquiries. Please try again in a minute." });
      return;
    }

    const body = [
      "A school requested information about ClassScribe EDU.",
      "",
      `Contact: ${inquiry.name}`,
      `Email: ${inquiry.email}`,
      `School: ${inquiry.school}`,
      `Role: ${inquiry.role}`,
      "",
      "Message:",
      inquiry.message || "(No additional message provided.)",
    ].join("\n");
    const accepted = await sendClassscribeSupportEmail({
      subject: "New ClassScribe EDU school inquiry",
      body,
      replyTo: inquiry.email,
    });
    if (!accepted) {
      req.log.warn("ClassScribe EDU inquiry was not accepted by the mail provider");
      res.status(503).json({ code: "unavailable", error: "Your inquiry could not be sent right now. Please try again later." });
      return;
    }
    res.status(200).json({ accepted: true });
  } catch {
    req.log.warn("ClassScribe EDU inquiry request limits are unavailable");
    res.status(503).json({ code: "unavailable", error: "Your inquiry could not be sent right now. Please try again later." });
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
});

export default router;