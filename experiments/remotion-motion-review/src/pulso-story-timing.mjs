/** Select the latest caption page; a previous page's linger must never hide a new word. */
export function captionAt(pages, timeMs, lingerMs = 160) {
  if (!Number.isFinite(timeMs)) return { group: null, active: -1 };
  const group = pages.findLast((candidate) => candidate.length && candidate[0].startMs <= timeMs);
  if (!group || timeMs > group[group.length - 1].endMs + lingerMs) return { group: null, active: -1 };
  const active = group.findLastIndex((word) => timeMs >= word.startMs && timeMs < word.endMs);
  return { group, active };
}
