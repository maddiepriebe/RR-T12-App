import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const MODEL = "claude-sonnet-4-20250514";

export async function callClaude(
  systemPrompt: string,
  userContent: string,
  maxTokens = 8192
): Promise<string> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");
  return content.text;
}

export function parseClaudeJSON<T>(raw: string): T | null {
  // Strip markdown fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error("[parseClaudeJSON] JSON parse failed:", err);
    console.error("[parseClaudeJSON] Raw (first 500 chars):", cleaned.slice(0, 500));
    return null;
  }
}
