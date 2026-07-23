import path from "node:path";
import sharp from "sharp";

const ids = process.argv.slice(2);
if (!ids.length) throw new Error("provide one or more character ids");

const columns = 4;
const cellWidth = 260;
const cellHeight = 286;
const rows = Math.ceil(ids.length / columns);
const layers = [];

for (const [index, id] of ids.entries()) {
  const left = (index % columns) * cellWidth + 10;
  const top = Math.floor(index / columns) * cellHeight + 10;
  const image = await sharp(path.join("public", "assets", "characters", `${id}.webp`))
    .resize(240, 240, { fit: "contain" })
    .png()
    .toBuffer();
  const label = Buffer.from(
    `<svg width="240" height="26"><rect width="240" height="26" fill="#10191d"/><text x="120" y="18" text-anchor="middle" font-family="Arial" font-size="15" fill="#ead28d">${id}</text></svg>`,
  );
  layers.push({ input: image, left, top }, { input: label, left, top: top + 242 });
}

await sharp({
  create: {
    width: columns * cellWidth,
    height: rows * cellHeight,
    channels: 4,
    background: { r: 8, g: 14, b: 17, alpha: 1 },
  },
})
  .composite(layers)
  .png()
  .toFile("artifacts/final-portrait-batch-contact-sheet.png");
