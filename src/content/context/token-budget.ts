// Rough token accounting so requests stay within budget without a real
// tokenizer. ~3.6 chars/token is a reasonable average for HTML+CSS+English.
const CHARS_PER_TOKEN = 3.6;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function tokensToChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN);
}

/** Hard-truncates text to a token budget, appending an elision marker. */
export function capTokens(text: string, maxTokens: number): string {
  const maxChars = tokensToChars(maxTokens);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 12))}\n⟨truncated⟩`;
}

/** Keeps the most recent entries whose combined size fits the budget. */
export function capListFromEnd(items: string[], maxTokens: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const cost = estimateTokens(items[i]!);
    if (used + cost > maxTokens) break;
    used += cost;
    out.unshift(items[i]!);
  }
  return out;
}
