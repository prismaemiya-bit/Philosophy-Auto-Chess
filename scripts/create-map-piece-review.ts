import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { characterAssets } from "../app/game/assets";
import { characters } from "../app/game/characters";

const factionOrder = ["greece", "germany", "france", "britain"];
const factionMeta: Record<
  string,
  { label: string; metal: string; deep: string; glow: string }
> = {
  greece: { label: "古希腊", metal: "#c49ce7", deep: "#352542", glow: "#b883e0" },
  germany: { label: "德国", metal: "#82d5de", deep: "#183d45", glow: "#60cdd9" },
  france: { label: "法国", metal: "#e4ae75", deep: "#4b3022", glow: "#e09652" },
  britain: { label: "英国", metal: "#8fcf9b", deep: "#203d2b", glow: "#69c17e" },
};

const roster = [...characters].sort(
  (a, b) => factionOrder.indexOf(a.faction) - factionOrder.indexOf(b.faction),
);

const columns = 5;
const cellWidth = 550;
const cellHeight = 390;
const headerHeight = 124;
const cardWidth = 188;
const cardHeight = 252;
const avatarSize = 126;
const rows = Math.ceil(roster.length / columns);
const outputPath = "artifacts/all-25-map-piece-tier-review.png";
const layers: sharp.OverlayOptions[] = [];

const escapeXml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const cardSvg = ({
  x,
  y,
  stage,
  name,
  role,
  glyph,
  hasPortrait,
  metal,
  deep,
}: {
  x: number;
  y: number;
  stage: 1 | 2;
  name: string;
  role: string;
  glyph: string;
  hasPortrait: boolean;
  metal: string;
  deep: string;
}) => {
  const avatarX = x + (cardWidth - avatarSize) / 2;
  const avatarY = y + 39;
  const points = `${avatarX + avatarSize / 2},${avatarY + 2} ${avatarX + avatarSize - 2},${avatarY + 47} ${avatarX + avatarSize - 14},${avatarY + avatarSize - 2} ${avatarX + 14},${avatarY + avatarSize - 2} ${avatarX + 2},${avatarY + 47}`;
  const starGlow =
    stage === 2
      ? `<polygon points="${points}" fill="none" stroke="#71dee9" stroke-opacity=".72" stroke-width="7" filter="url(#tierGlow)"/>`
      : "";

  return `
    <defs>
      <linearGradient id="card-${x}-${y}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${deep}"/>
        <stop offset=".58" stop-color="#14242b"/>
        <stop offset="1" stop-color="#061015"/>
      </linearGradient>
      <linearGradient id="hp-${x}-${y}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#3fa06f"/><stop offset=".58" stop-color="#8ed88c"/><stop offset="1" stop-color="#d2dc78"/>
      </linearGradient>
      <linearGradient id="energy-${x}-${y}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#3b79a4"/><stop offset=".58" stop-color="#6ecbd1"/><stop offset="1" stop-color="#d5c77d"/>
      </linearGradient>
      <filter id="tierGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="factionGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="11" fill="url(#card-${x}-${y})" stroke="${metal}" stroke-opacity=".72" stroke-width="2"/>
    <rect x="${x + 2}" y="${y + 2}" width="${cardWidth - 4}" height="${cardHeight - 4}" rx="9" fill="none" stroke="#fff5d2" stroke-opacity=".08"/>
    <text x="${x + 12}" y="${y + 24}" font-family="Microsoft YaHei, sans-serif" font-size="16" font-weight="700" fill="#f2d580">${stage} 阶</text>
    <text x="${x + cardWidth - 12}" y="${y + 24}" text-anchor="end" font-family="Microsoft YaHei, sans-serif" font-size="14" font-weight="600" fill="${metal}">${escapeXml(role)}</text>
    ${starGlow}
    <polygon points="${points}" fill="${deep}" stroke="#071015" stroke-width="7" filter="url(#factionGlow)"/>
    <polygon points="${points}" fill="none" stroke="${metal}" stroke-width="3"/>
    ${
      hasPortrait
        ? ""
        : `<text x="${x + cardWidth / 2}" y="${avatarY + 78}" text-anchor="middle" font-family="Georgia, serif" font-size="58" fill="${metal}">${escapeXml(glyph)}</text>
           <text x="${x + cardWidth / 2}" y="${avatarY + 105}" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="11" fill="#d6c69d">待补立绘</text>`
    }
    <line x1="${x + 17}" y1="${y + 177}" x2="${x + cardWidth - 17}" y2="${y + 177}" stroke="${metal}" stroke-opacity=".24"/>
    <text x="${x + cardWidth / 2}" y="${y + 203}" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="19" font-weight="700" fill="#f3ead1">${escapeXml(name)}</text>
    <rect x="${x + 14}" y="${y + 218}" width="${cardWidth - 28}" height="7" rx="2" fill="#07120e" stroke="#79be84" stroke-opacity=".3"/>
    <rect x="${x + 15}" y="${y + 219}" width="${cardWidth - 30}" height="5" rx="1" fill="url(#hp-${x}-${y})"/>
    <rect x="${x + 14}" y="${y + 232}" width="${cardWidth - 28}" height="7" rx="2" fill="#0a2027" stroke="#69cdd6" stroke-opacity=".36"/>
    <rect x="${x + 15}" y="${y + 233}" width="${Math.round((cardWidth - 30) * 0.46)}" height="5" rx="1" fill="url(#energy-${x}-${y})"/>
  `;
};

for (const [index, character] of roster.entries()) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = column * cellWidth;
  const top = headerHeight + row * cellHeight;
  const faction = factionMeta[character.faction];
  const asset = characterAssets[character.id];
  const localPortraitPath = asset?.portrait
    ? path.join("public", asset.portrait.replace(/^\//, ""))
    : "";
  const hasPortrait = Boolean(localPortraitPath && existsSync(localPortraitPath));
  const firstX = 62;
  const secondX = 300;
  const cardY = 82;

  const base = Buffer.from(`
    <svg width="${cellWidth}" height="${cellHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="7" width="${cellWidth - 14}" height="${cellHeight - 14}" rx="9" fill="#0a1216" stroke="${faction.metal}" stroke-opacity=".42" stroke-width="2"/>
      <text x="23" y="34" font-family="Microsoft YaHei, sans-serif" font-size="14" fill="${faction.metal}">${String(index + 1).padStart(2, "0")} · ${faction.label}</text>
      <text x="${cellWidth / 2}" y="37" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="22" font-weight="700" fill="#eadfc9">${escapeXml(character.name)}</text>
      <text x="${cellWidth - 23}" y="34" text-anchor="end" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#81979a">${character.terrain === "ground" ? "地面" : "高台"} · ${character.cost}费</text>
      <text x="${firstX + cardWidth / 2}" y="69" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#8fa5a7">地图部署 · 一阶</text>
      <text x="${secondX + cardWidth / 2}" y="69" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#8fa5a7">地图部署 · 二阶</text>
      ${cardSvg({
        x: firstX,
        y: cardY,
        stage: 1,
        name: character.name,
        role: asset?.label ?? character.role.label,
        glyph: asset?.glyph ?? character.portrait,
        hasPortrait,
        ...faction,
      })}
      ${cardSvg({
        x: secondX,
        y: cardY,
        stage: 2,
        name: character.name,
        role: asset?.label ?? character.role.label,
        glyph: asset?.glyph ?? character.portrait,
        hasPortrait,
        ...faction,
      })}
    </svg>`);
  layers.push({ input: base, left, top });

  if (hasPortrait) {
    const portrait = await sharp(localPortraitPath)
      .resize(avatarSize, avatarSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    layers.push({
      input: portrait,
      left: left + firstX + (cardWidth - avatarSize) / 2,
      top: top + cardY + 39,
    });
    layers.push({
      input: portrait,
      left: left + secondX + (cardWidth - avatarSize) / 2,
      top: top + cardY + 39,
    });
  }
}

const header = Buffer.from(`
  <svg width="${columns * cellWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#071015"/>
    <text x="${(columns * cellWidth) / 2}" y="45" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="31" font-weight="700" fill="#ead28d">《往哲荣耀》全部地图棋子正式形态审阅</text>
    <text x="${(columns * cellWidth) / 2}" y="78" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="16" fill="#9ab0b1">25名哲学家 · 一阶 / 二阶 · 五边形立绘 · 职业定位 · 姓名 · 生命 / 能量双条</text>
    <text x="${(columns * cellWidth) / 2}" y="104" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#687e82">按地图实际结构等比例放大；二阶青色外环沿用当前游戏升阶视觉；能量统一展示46%以便检查</text>
  </svg>`);
layers.unshift({ input: header, left: 0, top: 0 });

await sharp({
  create: {
    width: columns * cellWidth,
    height: headerHeight + rows * cellHeight,
    channels: 4,
    background: { r: 5, g: 10, b: 13, alpha: 1 },
  },
})
  .composite(layers)
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(
  `Created ${outputPath}: ${roster.length} characters, ${roster.length * 2} formal map pieces, ${roster.filter((character) => !characterAssets[character.id]?.portrait).length} placeholder portrait.`,
);
