// Use the same managed provider as the live web/native Ask flow. Do not let an
// unrelated direct OpenAI credential override semantic retrieval routing.
export async function completeSemanticRanking(system: string, input: string): Promise<string | null> {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const key = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !key) throw new Error("Semantic provider is not configured");
  const response = await fetch(`${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.AI_MODEL_QUICK || process.env.AI_MODEL || "claude-sonnet-4-6",
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: input }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Semantic provider unavailable (${response.status})`);
  const result = await response.json() as { content?: { type: string; text?: string }[] };
  if (!Array.isArray(result.content)) return null;
  return result.content.filter(p => p.type === "text" && typeof p.text === "string")
    .map(p => p.text).join("").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
}
