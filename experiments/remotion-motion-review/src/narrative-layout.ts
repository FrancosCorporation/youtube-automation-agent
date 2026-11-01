export type NarrativePose = { x: number; y: number; scale: number };
export type NarrativeAspect = "landscape" | "portrait";

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

export function wrapNarrativeLabel(value: string, maxChars: number, lines = 2): string[] {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (let word of words) {
    while (word.length > maxChars) {
      if (current) { result.push(current); current = ""; }
      result.push(`${word.slice(0, maxChars - 1)}-`);
      word = word.slice(maxChars - 1);
    }
    const next = `${current} ${word}`.trim();
    if (next.length > maxChars && current) { result.push(current); current = word; }
    else current = next;
  }
  if (current) result.push(current);
  if (result.length <= lines) return result;
  return [...result.slice(0, lines - 1), `${result.slice(lines - 1).join(" ").slice(0, maxChars - 1)}…`];
}

/**
 * Keep each object's motion inside a separate cell. The author still chooses
 * the direction of travel; limiting its displacement prevents cards, labels
 * and the presenter from covering each other in either aspect ratio.
 */
export function safeNarrativePose(
  authored: NarrativePose, base: NarrativePose, aspect: NarrativeAspect, index: number, count: number
): NarrativePose {
  const column = index % 2;
  const row = Math.floor(index / 2);
  if (aspect === "landscape") {
    const y = count <= 2 ? 0.39 : row === 0 ? 0.32 : 0.60;
    return { x: (column === 0 ? 0.19 : 0.45) + clamp((authored.x - base.x) * 0.3, -0.035, 0.035),
      y: y + clamp((authored.y - base.y) * 0.3, -0.02, 0.02), scale: Math.min(authored.scale, 0.75) };
  }
  const y = count <= 2 ? 0.26 : row === 0 ? 0.21 : 0.34;
  return { x: (column === 0 ? 0.27 : 0.73) + clamp((authored.x - base.x) * 0.3, -0.035, 0.035),
    y: y + clamp((authored.y - base.y) * 0.3, -0.01, 0.01), scale: Math.min(authored.scale, 0.48) };
}
