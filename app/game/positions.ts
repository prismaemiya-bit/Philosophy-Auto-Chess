export type Point = { x: number; y: number };
export type GridTile = { col: number; row: number };
export type SlotTerrain = "ground" | "highland";
export type LaneId = "upper" | "lower" | "side";

export const MAP_COLUMNS = 16;
export const MAP_ROWS = 9;
export const MAP_ASPECT_RATIO = 16 / 9;
export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 900;
export const MAP_LAYOUT_VERSION = "frozen-1600x900-v1";
export const MAP_LAYOUT_FINGERPRINT = "1b493ce5713f709ce439cf730149d89ae492f1cb9f09f0035af949764eb3802e";

/** Frozen art and collision dimensions in the 1600x900 local coordinate surface. */
export const MAP_ROAD_WIDTHS = {
  upper: { effective: 49, edge: 58, shadow: 68 },
  lower: { effective: 49, edge: 58, shadow: 68 },
  side: { effective: 43, edge: 52, shadow: 62 },
} as const;
export const MAP_FOOTPRINTS = {
  unit: { width: 82, height: 102, anchorXRatio: .5, anchorYRatio: .54 },
  maximumUnit: { width: 93, height: 116, anchorXRatio: .5, anchorYRatio: .54 },
  boss: { width: 141, height: 141, anchorXRatio: .5, anchorYRatio: .5 },
} as const;
export const MAP_PLATFORM_PATHS = [
  "M24 52H310l80 56 152 6 92 76-64 135-190 39-96 121H24z",
  "M28 515h250l105 40 140 84 104 150-79 82H28z",
  "M386 248l177-91 273 4 126 91 159 6 131 108-41 224-166 93-313 53-214-100-159-153z",
  "M1030 47h319l220 126v560l-181 120h-270l-119-152 185-159 55-200-161-137z",
] as const;
export const MAP_ART_SAFE_ZONES = {
  topClearance: { x: 0, y: 0, width: 1600, height: 72 },
  coreCombat: { x: 1240, y: 250, width: 344, height: 400 },
} as const;

export type RouteWaypoint = { id: string; point: Point };
export type DeploymentSlotDefinition = { id: string; terrain: SlotTerrain; point: Point; zone: string };

/**
 * Stable, authored waypoints. A and B meet at `ab-merge`; C remains a
 * separate path until all three lanes reach the philosopher stone itself.
 * Percent coordinates are the single source used by art, combat and UI.
 */
export const routeDefinitions: Record<LaneId, readonly RouteWaypoint[]> = {
  upper: [
    { id: "entry-a", point: { x: 3, y: 30 } }, { id: "a-outer", point: { x: 18, y: 30 } },
    { id: "a-turn", point: { x: 34, y: 30 } }, { id: "a-inner", point: { x: 34, y: 42 } },
    { id: "a-plaza", point: { x: 52, y: 42 } }, { id: "a-merge", point: { x: 52, y: 50 } },
    { id: "a-shared-arc", point: { x: 66, y: 50 } }, { id: "a-shared-lower", point: { x: 78, y: 50 } },
    { id: "a-core-approach", point: { x: 82, y: 50 } }, { id: "a-core", point: { x: 94, y: 50 } },
  ],
  lower: [
    { id: "entry-b", point: { x: 3, y: 70 } }, { id: "b-outer", point: { x: 18, y: 70 } },
    { id: "b-turn", point: { x: 34, y: 70 } }, { id: "b-inner", point: { x: 34, y: 58 } },
    { id: "b-plaza", point: { x: 52, y: 58 } }, { id: "b-merge", point: { x: 52, y: 50 } },
    { id: "b-shared-arc", point: { x: 66, y: 50 } }, { id: "b-shared-lower", point: { x: 78, y: 50 } },
    { id: "b-core-approach", point: { x: 82, y: 50 } }, { id: "b-core", point: { x: 94, y: 50 } },
  ],
  side: [
    { id: "entry-c", point: { x: 3, y: 16 } }, { id: "c-gallery", point: { x: 22, y: 16 } },
    { id: "c-turn", point: { x: 42, y: 16 } }, { id: "c-archive", point: { x: 62, y: 16 } },
    { id: "c-high", point: { x: 70, y: 16 } }, { id: "c-descent", point: { x: 70, y: 30 } },
    { id: "c-bottleneck", point: { x: 84, y: 30 } }, { id: "c-final", point: { x: 84, y: 38 } },
    { id: "c-core-front", point: { x: 94, y: 38 } }, { id: "c-core", point: { x: 94, y: 50 } },
  ],
};

/** Explicit IDs preserve saves and preparation references across map revisions. */
export const deploymentSlots = [
  { id: "deploy-1", terrain: "ground", point: { x: 18, y: 30 }, zone: "A outer" },
  { id: "deploy-2", terrain: "ground", point: { x: 34, y: 30 }, zone: "A turn" },
  { id: "deploy-3", terrain: "ground", point: { x: 18, y: 70 }, zone: "B outer" },
  { id: "deploy-4", terrain: "ground", point: { x: 34, y: 70 }, zone: "B turn" },
  { id: "deploy-5", terrain: "ground", point: { x: 43, y: 42 }, zone: "A plaza" },
  { id: "deploy-6", terrain: "ground", point: { x: 43, y: 58 }, zone: "B plaza" },
  { id: "deploy-7", terrain: "ground", point: { x: 52, y: 50 }, zone: "AB merge" },
  { id: "deploy-8", terrain: "ground", point: { x: 52, y: 16 }, zone: "C archive" },
  { id: "deploy-9", terrain: "ground", point: { x: 70, y: 23 }, zone: "C descent" },
  { id: "deploy-10", terrain: "ground", point: { x: 66, y: 50 }, zone: "shared arc" },
  { id: "deploy-11", terrain: "ground", point: { x: 74, y: 50 }, zone: "shared front" },
  { id: "deploy-12", terrain: "ground", point: { x: 82, y: 50 }, zone: "core front" },
  { id: "deploy-13", terrain: "highland", point: { x: 9, y: 50 }, zone: "western overlook" },
  { id: "deploy-14", terrain: "highland", point: { x: 25, y: 50 }, zone: "twin approach" },
  { id: "deploy-15", terrain: "highland", point: { x: 43, y: 25 }, zone: "A overlook" },
  { id: "deploy-16", terrain: "highland", point: { x: 43, y: 75 }, zone: "B overlook" },
  { id: "deploy-17", terrain: "highland", point: { x: 57, y: 31 }, zone: "merge tower" },
  { id: "deploy-18", terrain: "highland", point: { x: 67, y: 35 }, zone: "central observatory" },
  { id: "deploy-19", terrain: "highland", point: { x: 73, y: 68 }, zone: "southern observatory" },
  { id: "deploy-20", terrain: "highland", point: { x: 89, y: 69 }, zone: "core observatory" },
] as const satisfies readonly DeploymentSlotDefinition[];

export const DEPLOYMENT_SLOT_IDS = deploymentSlots.map((slot) => slot.id);
export const deploymentById: Record<string, DeploymentSlotDefinition> = Object.fromEntries(deploymentSlots.map((slot) => [slot.id, slot]));
export const slotTerrain: Record<string, SlotTerrain> = Object.fromEntries(deploymentSlots.map((slot) => [slot.id, slot.terrain]));
/** Special preparation slot. It is not part of the frozen 20 normal slots. */
// Special slot centered on the philosopher-stone star. This does not alter
// any of the 20 frozen deployment anchors or route points.
export const THRONE_POINT: Point = { x: 94, y: 50 };
export const ROYAL_BARRIER_POINT: Point = { x: 86, y: 50 };
export const deploymentPoint = (slotId: string): Point => slotId === "throne-1" ? THRONE_POINT : deploymentById[slotId]?.point ?? { x: 52, y: 50 };

// Compatibility view for systems that still need coarse neighbourhood cells.
export const deploymentTiles: Record<string, GridTile> = Object.fromEntries(deploymentSlots.map((slot) => [slot.id, {
  col: Math.floor(slot.point.x / 100 * MAP_COLUMNS), row: Math.floor(slot.point.y / 100 * MAP_ROWS),
}]));
export const upperRoute = routeDefinitions.upper;
export const lowerRoute = routeDefinitions.lower;
export const sideRoute = routeDefinitions.side;
export const tileKey = ({ col, row }: GridTile) => `${col}-${row}`;
export const tilePoint = ({ col, row }: GridTile): Point => ({ x: ((col + .5) / MAP_COLUMNS) * 100, y: ((row + .5) / MAP_ROWS) * 100 });

const metricPoint = (point: Point) => ({ x: point.x / 100 * MAP_COLUMNS, y: point.y / 100 * MAP_ROWS });
/** Distance in horizontal-percent units, corrected for the 16:9 canvas. */
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, (a.y - b.y) / MAP_ASPECT_RATIO);

function routeLengths(route: readonly RouteWaypoint[]) {
  const segments = route.slice(1).map((waypoint, index) => distance(route[index].point, waypoint.point));
  return { segments, total: segments.reduce((sum, value) => sum + value, 0) };
}

/** Progress follows travelled distance, so enemies do not accelerate on long segments. */
export function routePoint(progress: number, lane: LaneId = "upper"): Point {
  const route = routeDefinitions[lane]; const { segments, total } = routeLengths(route);
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < segments.length; index += 1) {
    const length = segments[index];
    if (remaining <= length || index === segments.length - 1) {
      const amount = length ? Math.min(1, remaining / length) : 0; const from = route[index].point; const to = route[index + 1].point;
      return { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
    }
    remaining -= length;
  }
  return route.at(-1)!.point;
}

export const revolutionNodes = {
  "debate-plaza": { label: "A/B 汇合点", point: { x: 52, y: 50 } },
  "side-gate": { label: "C 路瓶颈", point: { x: 70, y: 30 } },
  "core-front": { label: "哲人之石前防线", point: { x: 82, y: 50 } },
} as const;
export const revolutionNodePoint = (id: keyof typeof revolutionNodes): Point => revolutionNodes[id].point;

/** Shortest map-space distance from a point to any segment of a lane. */
export function distanceToRoute(point: Point, lane: LaneId) {
  const p = metricPoint(point); const route = routeDefinitions[lane].map((waypoint) => metricPoint(waypoint.point));
  return Math.min(...route.slice(1).map((end, index) => {
    const start = route[index]; const dx = end.x - start.x; const dy = end.y - start.y;
    const amount = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / Math.max(.0001, dx * dx + dy * dy)));
    return Math.hypot(p.x - (start.x + dx * amount), p.y - (start.y + dy * amount));
  }));
}
