let counter = 0;

/**
 * Generates an id unique within this page/session. Combines a monotonic
 * counter with a random suffix so ids stay unique even across script
 * re-injection into the same page.
 */
export function genId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
