import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  deploymentSlots,
  MAP_ART_SAFE_ZONES,
  MAP_FOOTPRINTS,
  MAP_HEIGHT,
  MAP_LAYOUT_VERSION,
  MAP_PLATFORM_PATHS,
  MAP_ROAD_WIDTHS,
  MAP_WIDTH,
  revolutionNodes,
  routeDefinitions,
  type LaneId,
  type Point,
} from "../app/game/positions.ts";

const outputDirectory = path.resolve("artifacts/map-art-package");
const lanes = Object.keys(routeDefinitions) as LaneId[];
const point = (value: Point) => ({ x: value.x / 100 * MAP_WIDTH, y: value.y / 100 * MAP_HEIGHT });
const points = (lane: LaneId) => routeDefinitions[lane].map((waypoint) => { const value = point(waypoint.point); return `${value.x},${value.y}`; }).join(" ");
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const manifest = {
  version: MAP_LAYOUT_VERSION,
  canvas: { width: MAP_WIDTH, height: MAP_HEIGHT },
  roadWidths: MAP_ROAD_WIDTHS,
  footprints: MAP_FOOTPRINTS,
  routes: routeDefinitions,
  deploymentSlots,
  revolutionNodes,
  safeZones: MAP_ART_SAFE_ZONES,
  platformPaths: MAP_PLATFORM_PATHS,
};
const fingerprint = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

const defs = `<defs>
  <radialGradient id="vacuum"><stop stop-color="#183044"/><stop offset=".5" stop-color="#081624"/><stop offset="1" stop-color="#02070d"/></radialGradient>
  <linearGradient id="road" x2="0" y2="1"><stop stop-color="#827458"/><stop offset=".18" stop-color="#3c4658"/><stop offset=".75" stop-color="#252b3c"/><stop offset="1" stop-color="#735f40"/></linearGradient>
  <radialGradient id="core"><stop stop-color="#fff4b3"/><stop offset=".24" stop-color="#75dbe3"/><stop offset=".62" stop-color="#31547f"/><stop offset="1" stop-color="#132038" stop-opacity="0"/></radialGradient>
  <pattern id="minorGrid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#79a8b0" stroke-opacity=".07" stroke-width="1"/></pattern>
  <pattern id="majorGrid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#8ac8ce" stroke-opacity=".22" stroke-width="1"/></pattern>
  <pattern id="safeHatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="#f0bb65" stroke-opacity=".22" stroke-width="3"/></pattern>
  <filter id="glow"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;

function roads(mode: "clean" | "template" | "overlay") {
  return lanes.map((lane) => {
    const widths = MAP_ROAD_WIDTHS[lane];
    if (mode === "overlay") return `<polyline points="${points(lane)}" fill="none" stroke="#71ecf0" stroke-width="2" stroke-dasharray="10 9" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `<g><polyline points="${points(lane)}" fill="none" stroke="#010307" stroke-width="${widths.shadow}" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/><polyline points="${points(lane)}" fill="none" stroke="#a88e57" stroke-width="${widths.edge}" stroke-linecap="round" stroke-linejoin="round" opacity=".72"/><polyline points="${points(lane)}" fill="none" stroke="url(#road)" stroke-width="${widths.effective}" stroke-linecap="round" stroke-linejoin="round"/>${mode === "template" ? `<polyline points="${points(lane)}" fill="none" stroke="#ffe098" stroke-width="2" stroke-dasharray="9 10" stroke-linecap="round" stroke-linejoin="round"/>` : ""}</g>`;
  }).join("");
}

function slots(mode: "clean" | "template" | "overlay") {
  return deploymentSlots.map((slot) => {
    const center = point(slot.point); const footprint = MAP_FOOTPRINTS.maximumUnit;
    const x = center.x - footprint.width * footprint.anchorXRatio; const y = center.y - footprint.height * footprint.anchorYRatio;
    const color = slot.terrain === "ground" ? "#e4c36e" : "#72dbe2";
    const shape = slot.terrain === "ground" ? "M-30-18 0-31 30-18 30 18 0 31-30 18z" : "M-32-23 0-38 32-23 32 23 0 38-32 23z";
    if (mode === "clean") return `<g transform="translate(${center.x} ${center.y})"><path d="${shape}" fill="${slot.terrain === "ground" ? "#151f28" : "#17303c"}" stroke="${color}" stroke-width="2" opacity=".78"/><circle r="${slot.terrain === "ground" ? 20 : 23}" fill="#142832" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 4" opacity=".8"/></g>`;
    return `<g><rect x="${x}" y="${y}" width="${footprint.width}" height="${footprint.height}" rx="5" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="5 4" opacity=".55"/><g transform="translate(${center.x} ${center.y})"><path d="${shape}" fill="${mode === "template" ? "#10202a" : "none"}" stroke="${color}" stroke-width="2"/><circle r="4" fill="#ff426f" stroke="#fff" stroke-width="1.5"/>${mode === "template" ? `<text y="48" class="slot-label" fill="${color}">${slot.id} · ${slot.terrain === "ground" ? "地面" : "高台"}</text>` : `<text x="7" y="-7" class="overlay-label" fill="${color}">${slot.id}</text>`}</g></g>`;
  }).join("");
}

function nodes(mode: "clean" | "template" | "overlay") {
  return Object.entries(revolutionNodes).map(([id, node]) => { const center = point(node.point); const label = mode === "template" ? `<text y="43" class="node-label">法国节点 · ${xml(node.label)} (${id})</text>` : mode === "overlay" ? `<text x="18" y="-16" class="overlay-label" fill="#ffb181">${id}</text>` : ""; return `<g transform="translate(${center.x} ${center.y})"><circle r="27" fill="${mode === "clean" ? "#382329" : mode === "template" ? "#562b27" : "none"}" stroke="#ff9f6b" stroke-width="3" stroke-dasharray="6 4"/><circle r="11" fill="#8b4933" stroke="#ffd09a" stroke-width="2"/>${label}</g>`; }).join("");
}

function entrancesAndLandmarks() {
  const labels: Record<LaneId, string> = { upper: "A", lower: "B", side: "C" };
  const entries = lanes.map((lane) => { const center = point(routeDefinitions[lane][0].point); return `<g transform="translate(${center.x} ${center.y})"><circle r="32" fill="#17283a" stroke="#d9bd72" stroke-width="3"/><path d="M-18 20V-7a18 18 0 0 1 36 0v27z" fill="#30283e" stroke="#83d7da" stroke-width="2"/><text x="43" y="5" class="landmark" text-anchor="start">入口 ${labels[lane]} · ${routeDefinitions[lane][0].id}</text></g>`; }).join("");
  const merge = point(routeDefinitions.upper.find((waypoint) => waypoint.id === "a-merge")!.point);
  const core = point(routeDefinitions.upper.at(-1)!.point);
  return `${entries}<g transform="translate(${merge.x} ${merge.y})"><circle r="17" fill="#16252d" stroke="#fff0a5" stroke-width="3"/><path d="M-9 0H9M0-9V9" stroke="#fff0a5" stroke-width="2"/><text y="-27" class="landmark">A/B 汇合点 · 832,450</text></g><g transform="translate(${core.x} ${core.y})"><circle r="74" fill="#17283a" stroke="#e2c46e" stroke-width="6"/><circle r="48" fill="url(#core)" stroke="#9be5df" stroke-width="3" filter="url(#glow)"/><path d="M0-35 16-10 42 0 16 11 0 37-16 11-42 0-16-10z" fill="#ecf3c0" stroke="#fff2ad" stroke-width="3"/><text y="96" class="core-label">终点 1504,450 · 哲人之石</text></g>`;
}

function bossFootprint(showLabel: boolean) {
  const center = point(revolutionNodes["core-front"].point); const boss = MAP_FOOTPRINTS.boss;
  return `<g transform="translate(${center.x} ${center.y})"><ellipse rx="${boss.width / 2}" ry="${boss.height / 2}" fill="none" stroke="#ff674d" stroke-width="3" stroke-dasharray="10 6"/><path d="M-9 0H9M0-9V9" stroke="#ff674d" stroke-width="2"/>${showLabel ? `<text y="${boss.height / 2 + 20}" class="boss-label">Boss 占地 ${boss.width}×${boss.height} · 中心锚定道路</text>` : ""}</g>`;
}

const commonStyle = `<style>text{font-family:"Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif;paint-order:stroke;stroke:#041019;stroke-width:3px;stroke-linejoin:round}.slot-label{font-size:10px;text-anchor:middle}.node-label{font-size:11px;fill:#ffd0ad;text-anchor:middle}.landmark{font-size:13px;font-weight:700;fill:#d9eeee;text-anchor:middle}.core-label{font-size:14px;font-weight:700;fill:#ffe497;text-anchor:middle}.boss-label{font-size:11px;font-weight:700;fill:#ffad91;text-anchor:middle}.overlay-label{font-size:9px;stroke-width:2px}.title{font-size:24px;font-weight:700;fill:#f3dfaa}.meta{font-size:12px;fill:#b6d0d2}.legend{font-size:12px;fill:#dce8df}</style>`;
const svg = (body: string, transparent = false) => `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}">${defs}${commonStyle}${transparent ? "" : `<rect width="1600" height="900" fill="url(#vacuum)"/>`}${body}</svg>`;

const platformLayer = `<g fill="#101d2a" stroke="#4f6e7b" stroke-width="2" stroke-opacity=".55">${MAP_PLATFORM_PATHS.map((value) => `<path d="${value}"/>`).join("")}</g>`;
const safeZones = `<g><rect x="${MAP_ART_SAFE_ZONES.topClearance.x}" y="${MAP_ART_SAFE_ZONES.topClearance.y}" width="${MAP_ART_SAFE_ZONES.topClearance.width}" height="${MAP_ART_SAFE_ZONES.topClearance.height}" fill="url(#safeHatch)" stroke="#e8b85f" stroke-width="2"/><text x="18" y="27" class="legend">顶部安全区 72 px · 禁放关键构图</text><rect x="${MAP_ART_SAFE_ZONES.coreCombat.x}" y="${MAP_ART_SAFE_ZONES.coreCombat.y}" width="${MAP_ART_SAFE_ZONES.coreCombat.width}" height="${MAP_ART_SAFE_ZONES.coreCombat.height}" fill="url(#safeHatch)" stroke="#e8b85f" stroke-width="2" stroke-dasharray="8 5"/><text x="1252" y="638" class="legend">核心战斗/漏怪/Boss特效安全区</text></g>`;
const coordinateGrid = `<rect width="1600" height="900" fill="url(#minorGrid)"/><rect width="1600" height="900" fill="url(#majorGrid)"/>`;
const roadDimensions = `<g stroke="#fff0a5" fill="#fff0a5"><path d="M400 605.5v49m-7-49h14m-14 49h14"/><text x="400" y="594" class="legend" text-anchor="middle" stroke="#041019">A/B 有效宽度 49 px</text><path d="M340 122.5v43m-7-43h14m-14 43h14"/><text x="356" y="140" class="legend" stroke="#041019">C 有效宽度 43 px</text></g>`;
const template = svg(`${platformLayer}${coordinateGrid}${safeZones}${roads("template")}${roadDimensions}${slots("template")}${nodes("template")}${entrancesAndLandmarks()}${bossFootprint(true)}<g transform="translate(22 790)"><rect width="535" height="88" rx="7" fill="#06111b" fill-opacity=".9" stroke="#668b91"/><text x="16" y="27" class="title" text-anchor="start">往哲荣耀 · 冻结地图施工模板</text><text x="16" y="50" class="meta" text-anchor="start">${MAP_LAYOUT_VERSION} · 1600×900 · SHA-256 ${fingerprint.slice(0, 16)}…</text><text x="16" y="71" class="legend" text-anchor="start">道路有效宽度 A/B 49 px，C 43 px；虚线矩形为最大棋子安全包络。</text></g>`);
const overlay = svg(`${coordinateGrid}${roads("overlay")}${slots("overlay")}${nodes("overlay")}${bossFootprint(false)}`, true);
const clean = svg(`${platformLayer}${roads("clean")}${slots("clean")}${nodes("clean")}${entrancesAndLandmarks().replace(/<text[\s\S]*?<\/text>/g, "")}`);

async function render(name: string, source: string) {
  await sharp(Buffer.from(source)).png().toFile(path.join(outputDirectory, name));
  const metadata = await sharp(path.join(outputDirectory, name)).metadata();
  if (metadata.width !== MAP_WIDTH || metadata.height !== MAP_HEIGHT) throw new Error(`${name} is ${metadata.width}x${metadata.height}, expected ${MAP_WIDTH}x${MAP_HEIGHT}`);
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  render("idea-garrison-map-construction-template-1600x900.png", template),
  render("idea-garrison-map-validation-overlay-1600x900.png", overlay),
  render("idea-garrison-map-clean-reference-1600x900.png", clean),
]);
await writeFile(path.join(outputDirectory, "map-layout-manifest.json"), `${JSON.stringify({ ...manifest, fingerprint }, null, 2)}\n`, "utf8");
await copyFile(path.resolve("MAP_ART_SPEC.md"), path.join(outputDirectory, "MAP_ART_SPEC.md"));
console.log(`Map art package exported to ${outputDirectory}`);
console.log(`Frozen layout fingerprint: ${fingerprint}`);
