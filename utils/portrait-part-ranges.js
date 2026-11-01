'use strict';

function buildPortraitPartRender({ portraitVideoPath, outputPath, ranges }) {
  if (!portraitVideoPath || !outputPath || !Array.isArray(ranges) || !ranges.length) throw new TypeError('parte vertical sem intervalos');
  const merged = [];
  for (const { start, end } of ranges) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new RangeError('intervalo vertical inválido');
    const previous = merged.at(-1);
    if (previous && start >= previous.start && start <= previous.end + 1) previous.end = Math.max(previous.end, end);
    else merged.push({ start, end });
  }
  const durationMs = merged.reduce((total, range) => total + range.end - range.start, 0);
  const seconds = ms => (ms / 1000).toFixed(3);
  const args = ['-y', '-i', portraitVideoPath];
  if (merged.length === 1) {
    args.push('-ss', seconds(merged[0].start), '-t', seconds(durationMs), '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'fps=30,format=yuv420p');
  } else {
    // Later narrative parts repeat the opening before their own source range.
    // Concatenate those ranges in narrative order; min(start)..max(end) would
    // silently include the entire skipped middle of the master.
    const filters = [
      `[0:v:0]split=${merged.length}${merged.map((_, i) => `[v${i}]`).join('')}`,
      `[0:a:0]asplit=${merged.length}${merged.map((_, i) => `[a${i}]`).join('')}`
    ];
    merged.forEach((range, i) => {
      filters.push(`[v${i}]trim=start=${seconds(range.start)}:end=${seconds(range.end)},setpts=PTS-STARTPTS,fps=30,format=yuv420p[vc${i}]`);
      filters.push(`[a${i}]atrim=start=${seconds(range.start)}:end=${seconds(range.end)},asetpts=PTS-STARTPTS[ac${i}]`);
    });
    filters.push(`${merged.map((_, i) => `[vc${i}][ac${i}]`).join('')}concat=n=${merged.length}:v=1:a=1[vout][aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]');
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outputPath);
  return { args, durationMs, ranges: merged };
}

module.exports = { buildPortraitPartRender };
