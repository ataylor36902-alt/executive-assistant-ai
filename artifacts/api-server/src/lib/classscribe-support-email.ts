import { ReplitConnectors } from "@replit/connectors-sdk";

export const SUPPORT_EMAIL = "edmitainvestmentllc@edmitainvest.com";

export function safeSupportEmailText(text: string): string {
  return text
    .replace(/\b[ug]_[A-Za-z0-9]{10,40}\b/g, "[redacted access code]")
    .replace(/\b(?:sk|pk|rk|ghp|github_pat|AKIA)[-_A-Za-z0-9]{16,}\b/gi, "[redacted secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted token]")
    .replace(/\b(api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

export async function sendClassscribeSupportEmail({
  subject,
  body,
  replyTo,
  to,
}: {
  subject: string;
  body: string;
  replyTo?: string;
  to?: string;
}): Promise<boolean> {
  try {
    if (/[\r\n]/.test(subject)) return false;
    const recipient = to ?? SUPPORT_EMAIL;
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) return false;
    const connectors = new ReplitConnectors();
    const profileResponse = await connectors.proxy("google-mail", "/gmail/v1/users/me/profile", { method: "GET" });
    if (!profileResponse.ok) return false;
    const profile: unknown = await profileResponse.json();
    if (!profile || typeof profile !== "object" || !("emailAddress" in profile) ||
      typeof profile.emailAddress !== "string" ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(profile.emailAddress)) return false;

    const encodedBody = Buffer.from(safeSupportEmailText(body), "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
    const mime = [
      `From: ClassScribe Help <${profile.emailAddress}>`,
      `To: <${recipient}>`,
      ...(replyTo && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(replyTo) ? [`Reply-To: ${replyTo}`] : []),
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodedBody,
    ].join("\r\n");
    const response = await connectors.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }),
    });
    if (!response.ok) return false;
    const sent: unknown = await response.json();
    return !!sent && typeof sent === "object" && "id" in sent &&
      typeof sent.id === "string" && sent.id.length > 0;
  } catch {
    return false;
  }
}

export async function sendClassscribeRetentionWarningEmail({
  to,
  deletionDate,
}: {
  to: string;
  deletionDate: string;
}): Promise<boolean> {
  return sendClassscribeSupportEmail({
    to,
    subject: "ClassScribe account inactivity notice",
    body: [
      "Your ClassScribe account has been inactive for almost 24 months.",
      `Unless you sign in, account data is scheduled for deletion on ${deletionDate}.`,
      "Sign in to keep your account, or contact support if you have questions.",
      "This warning was sent 30 days before scheduled deletion.",
    ].join("\n"),
  });
}