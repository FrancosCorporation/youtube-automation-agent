const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

const WIDTH = 480;
const HEIGHT = 620;
const COLS = 4;
const ROWS = 7;

async function assemblePresenterAtlas(framesDir, outputPath) {
  const layers = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const input = path.join(framesDir, `r${row}c${col}.png`);
      await fs.access(input);
      layers.push({ input, left: col * WIDTH, top: row * HEIGHT });
    }
  }
  const temporaryOutput = `${outputPath}.tmp-${process.pid}.png`;
  try {
    await sharp({
      create: {
        width: WIDTH * COLS,
        height: HEIGHT * ROWS,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).composite(layers).png().toFile(temporaryOutput);
    await fs.rename(temporaryOutput, outputPath);
    return outputPath;
  } catch (error) {
    await fs.unlink(temporaryOutput).catch(() => {});
    throw error;
  }
}

if (require.main === module) {
  const framesDir = process.argv[2];
  const outputPath = process.argv[3];
  if (!framesDir || !outputPath) {
    process.stderr.write('Uso: node scripts/assemble-presenter-atlas.js <pasta-frames> <saida.png>\n');
    process.exitCode = 2;
  } else {
    assemblePresenterAtlas(framesDir, outputPath)
      .then(async result => {
        const stat = await fs.stat(result);
        process.stdout.write(`Atlas 3D pronto: ${result} (${(stat.size / 1048576).toFixed(1)} MB)\n`);
      })
      .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  }
}

module.exports = { assemblePresenterAtlas, WIDTH, HEIGHT, COLS, ROWS };
