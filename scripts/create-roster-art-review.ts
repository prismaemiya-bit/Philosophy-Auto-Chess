import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { characters } from "../app/game/characters";

const factionOrder = ["greece", "germany", "france", "britain"];
const factionMeta: Record<string, { label: string; color: string }> = {
  greece: { label: "古希腊", color: "#d6b45c" },
  germany: { label: "德国", color: "#83c8d4" },
  france: { label: "法国", color: "#d49369" },
  britain: { label: "英国", color: "#8bc795" },
};
const roster = [...characters].sort(
  (a, b) => factionOrder.indexOf(a.faction) - factionOrder.indexOf(b.faction),
);

const columns = 5;
const cellWidth = 300;
const cellHeight = 330;
const headerHeight = 92;
const rows = Math.ceil(roster.length / columns);
const layers: sharp.OverlayOptions[] = [];

const escapeXml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

for (const [index, character] of roster.entries()) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = column * cellWidth;
  const top = headerHeight + row * cellHeight;
  const faction = factionMeta[character.faction];
  const portraitPath = path.join("public", "assets", "characters", `${character.id}.webp`);
  const hasPortrait = existsSync(portraitPath);

  const card = Buffer.from(`
    <svg width="${cellWidth}" height="${cellHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="7" width="${cellWidth - 14}" height="${cellHeight - 14}" rx="6" fill="#10191d" stroke="${faction.color}" stroke-width="2"/>
      <text x="20" y="29" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="${faction.color}">${String(index + 1).padStart(2, "0")} · ${faction.label}</text>
      <rect x="20" y="39" width="260" height="250" fill="#0a1115" stroke="#334248"/>
      <text x="150" y="309" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="18" font-weight="700" fill="#f0e6cf">${escapeXml(character.name)}</text>
      <text x="274" y="309" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="#76878b">${character.id}</text>
    </svg>`);
  layers.push({ input: card, left, top });

  if (hasPortrait) {
    const image = await sharp(portraitPath)
      .resize(244, 244, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    layers.push({ input: image, left: left + 28, top: top + 42 });
  } else {
    const fallback = Buffer.from(`
      <svg width="244" height="244" xmlns="http://www.w3.org/2000/svg">
        <polygon points="122,8 233,86 191,232 53,232 11,86" fill="#17252b" stroke="${faction.color}" stroke-width="3" stroke-dasharray="8 6"/>
        <text x="122" y="128" text-anchor="middle" font-family="Georgia, serif" font-size="78" fill="${faction.color}">${escapeXml(character.portrait)}</text>
        <text x="122" y="176" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="15" fill="#d6c69d">待补正式立绘</text>
      </svg>`);
    layers.push({ input: fallback, left: left + 28, top: top + 42 });
  }
}

const header = Buffer.from(`
  <svg width="${columns * cellWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#081014"/>
    <text x="750" y="39" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="28" font-weight="700" fill="#ead28d">《往哲荣耀》25名棋子立绘统一审阅</text>
    <text x="750" y="68" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="14" fill="#8ea5a7">游戏当前成品资源 · 统一512×512透明画布 · 完整五边形 · 按阵营排序</text>
  </svg>`);
layers.unshift({ input: header, left: 0, top: 0 });

await sharp({
  create: {
    width: columns * cellWidth,
    height: headerHeight + rows * cellHeight,
    channels: 4,
    background: { r: 6, g: 12, b: 15, alpha: 1 },
  },
})
  .composite(layers)
  .png({ compressionLevel: 9 })
  .toFile("artifacts/all-25-character-art-review.png");
