export function captionAt<T extends { startMs: number; endMs: number }>(pages: T[][], timeMs: number, lingerMs?: number): { group: T[] | null; active: number };
