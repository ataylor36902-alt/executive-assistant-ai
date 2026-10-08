import { z } from "zod";

const text = (max: number) => z.string().max(max).trim().min(1);
const citation = {
  lectureId: z.string().max(128).regex(/^(?:[A-Za-z0-9_-]+)?$/).optional(),
  t: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
};
const topic = { concept: text(250), ...citation };
const card = z.object({ front: text(1000), back: text(3000), ...topic }).strict();
const question = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mc"), q: text(1000), ...topic,
    choices: z.array(text(1000)).length(4),
    answer: z.number().int().min(0).max(3), explain: text(3000),
  }).strict(),
  z.object({ type: z.literal("short"), q: text(1000), ...topic, answer: text(3000) }).strict(),
  z.object({ type: z.literal("essay"), q: text(1000), ...topic, outline: z.array(text(1000)).min(1).max(20) }).strict(),
]);
const cards = z.object({ cards: z.array(card).min(1).max(50) }).strict();
const quiz = z.object({ questions: z.array(question).min(1).max(50) }).strict();

// Validate the entire batch before it reaches either client. Never repair a bad
// answer key or silently drop an item, which could mislead students about scoring.
export function validateGeneratedStudy(operation: "cards" | "quiz", result: unknown, material: string) {
  const parsed = operation === "cards" ? cards.safeParse(result) : quiz.safeParse(result);
  if (!parsed.success) return null;
  const lectureIds = new Set(Array.from(material.matchAll(/^### Lecture id=([A-Za-z0-9_-]+)(?=\s|$)/gm), match => match[1]));
  const items = "cards" in parsed.data ? parsed.data.cards : parsed.data.questions;
  for (const item of items) {
    if (item.lectureId) {
      if (!lectureIds.has(item.lectureId) || item.t === undefined) return null;
    } else if (item.t !== undefined && item.t !== 0) {
      // Empty citations are valid for document-only study, but cannot claim an
      // audio timestamp without identifying a supplied lecture.
      return null;
    }
    if ("choices" in item && new Set(item.choices.map(choice => choice.toLowerCase())).size !== item.choices.length) {
      return null;
    }
  }
  return parsed.data;
}
