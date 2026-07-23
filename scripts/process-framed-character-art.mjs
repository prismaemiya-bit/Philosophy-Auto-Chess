import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const args = Object.fromEntries(
  process.argv.slice(2).map((entry) => {
    const separator = entry.indexOf("=");
    if (separator < 0) return [entry.replace(/^--/, ""), true];
    return [entry.slice(2, separator), entry.slice(separator + 1)];
  }),
);

if (!args.source || !args.out) {
  throw new Error("usage: node scripts/process-framed-character-art.mjs --source=<png> --out=<webp>");
}

const size = Number(args.size ?? 512);
const padding = Number(args.padding ?? 8);
const threshold = Number(args.threshold ?? 42);
if (!Number.isInteger(size) || !Number.isInteger(padding) || padding < 0 || padding * 2 >= size) {
  throw new Error("size and padding must leave a positive output area");
}

const { data, info } = await sharp(args.source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

if (info.channels !== 4) throw new Error(`expected RGBA input, received ${info.channels} channels`);

const removed = new Uint8Array(info.width * info.height);
const corners = [
  0,
  info.width - 1,
  (info.height - 1) * info.width,
  info.width * info.height - 1,
];

for (const start of corners) {
  const referenceOffset = start * 4;
  const reference = [data[referenceOffset], data[referenceOffset + 1], data[referenceOffset + 2]];
  const seen = new Uint8Array(info.width * info.height);
  const queue = new Int32Array(info.width * info.height);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;

  while (head < tail) {
    const pixel = queue[head++];
    const offset = pixel * 4;
    const closeToCorner =
      Math.abs(data[offset] - reference[0]) <= threshold &&
      Math.abs(data[offset + 1] - reference[1]) <= threshold &&
      Math.abs(data[offset + 2] - reference[2]) <= threshold;
    if (!closeToCorner) continue;

    removed[pixel] = 1;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    const neighbors = [
      x > 0 ? pixel - 1 : -1,
      x + 1 < info.width ? pixel + 1 : -1,
      y > 0 ? pixel - info.width : -1,
      y + 1 < info.height ? pixel + info.width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && !seen[neighbor]) {
        seen[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
  }
}

let removedPixels = 0;
for (let pixel = 0; pixel < removed.length; pixel += 1) {
  if (!removed[pixel]) continue;
  data[pixel * 4 + 3] = 0;
  removedPixels += 1;
}
if (removedPixels === 0) throw new Error("edge-connected background removal did not remove any pixels");

await mkdir(path.dirname(args.out), { recursive: true });
await sharp(data, { raw: info })
  .resize(size - padding * 2, size - padding * 2, { fit: "fill", kernel: "lanczos3" })
  .extend({
    top: padding,
    bottom: padding,
    left: padding,
    right: padding,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .webp({ quality: 92, alphaQuality: 100, effort: 6, smartSubsample: true })
  .toFile(args.out);

console.log(`${args.out}: ${info.width}x${info.height}, removed ${removedPixels} edge pixels`);
