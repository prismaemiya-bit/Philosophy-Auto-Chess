import { deploymentSlots, MAP_PLATFORM_PATHS, MAP_ROAD_WIDTHS, revolutionNodes, routeDefinitions, type LaneId, type Point } from "./positions";

const svgPoint = (point: Point) => `${point.x * 16},${point.y * 9}`;
const polyline = (lane: LaneId) => routeDefinitions[lane].map((waypoint) => svgPoint(waypoint.point)).join(" ");
const laneLabel: Record<LaneId, string> = { upper: "A", lower: "B", side: "C" };

/**
 * Review-only code map. Every visual coordinate comes from positions.ts; no
 * background cover/cropping and no separately scaled gameplay layer exists.
 */
export function MapArt({ dangerLanes, debug = false }: { dangerLanes: Set<string>; debug?: boolean }) {
  const core = routeDefinitions.upper.at(-1)!.point;
  return <svg className={`map-art ${debug ? "debug" : ""}`} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" aria-label="往哲荣耀纯代码战术地图">
    <defs>
      <radialGradient id="map-vacuum"><stop stopColor="#172b3d" /><stop offset=".48" stopColor="#071522" /><stop offset="1" stopColor="#02070d" /></radialGradient>
      <linearGradient id="map-road" x2="0" y2="1"><stop stopColor="#807154" /><stop offset=".16" stopColor="#3a4252" /><stop offset=".76" stopColor="#252939" /><stop offset="1" stopColor="#75613f" /></linearGradient>
      <radialGradient id="map-core"><stop stopColor="#f8f1bd" /><stop offset=".2" stopColor="#7ddfe4" /><stop offset=".55" stopColor="#385e8c" /><stop offset="1" stopColor="#14213b" stopOpacity="0" /></radialGradient>
      <pattern id="map-grid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#79a8b0" strokeOpacity=".055" /></pattern>
      <filter id="map-glow"><feGaussianBlur stdDeviation="7" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    </defs>
    <rect width="1600" height="900" fill="url(#map-vacuum)" />
    <rect width="1600" height="900" fill="url(#map-grid)" />
    <g className="map-platforms">{MAP_PLATFORM_PATHS.map((path) => <path key={path} d={path} />)}</g>
    {(Object.keys(routeDefinitions) as LaneId[]).map((lane) => <g key={lane} className={`map-route ${lane} ${dangerLanes.has(lane) ? "danger" : ""}`}>
      <polyline className="road-shadow" strokeWidth={MAP_ROAD_WIDTHS[lane].shadow} points={polyline(lane)} />
      <polyline className="road-edge" strokeWidth={MAP_ROAD_WIDTHS[lane].edge} points={polyline(lane)} />
      <polyline className="road-surface" strokeWidth={MAP_ROAD_WIDTHS[lane].effective} points={polyline(lane)} />
      <polyline className="road-center" points={polyline(lane)} />
    </g>)}
    <g className="map-gates">{(Object.keys(routeDefinitions) as LaneId[]).map((lane) => { const point = routeDefinitions[lane][0].point; return <g key={lane} transform={`translate(${point.x * 16} ${point.y * 9})`}><circle r="35" /><path d="M-19 23V-7a19 19 0 0 1 38 0v30z" /><text y="58">入口 {laneLabel[lane]}</text></g>; })}</g>
    <g className="map-revolution-nodes">{Object.entries(revolutionNodes).map(([id, node]) => <g key={id} transform={`translate(${node.point.x * 16} ${node.point.y * 9})`}><circle r="25" /><circle r="13" /><text y="42">{node.label}</text></g>)}</g>
    <g className="map-core" transform={`translate(${core.x * 16} ${core.y * 9})`}><circle r="74" /><circle r="48" /><path d="M0-35 16-10 42 0 16 11 0 37-16 11-42 0-16-10z" /><text y="96">哲人之石</text></g>
    <g className="map-slot-foundations">{deploymentSlots.map((slot) => <g key={slot.id} className={slot.terrain} transform={`translate(${slot.point.x * 16} ${slot.point.y * 9})`}><path d={slot.terrain === "ground" ? "M-30-18 0-31 30-18 30 18 0 31-30 18z" : "M-32-23 0-38 32-23 32 23 0 38-32 23z"} /><circle r={slot.terrain === "ground" ? 20 : 23} />{debug && <text y="48">{slot.id}</text>}</g>)}</g>
    {debug && <g className="map-debug-waypoints">{(Object.keys(routeDefinitions) as LaneId[]).flatMap((lane) => routeDefinitions[lane].map((waypoint) => <g key={`${lane}-${waypoint.id}`} transform={`translate(${waypoint.point.x * 16} ${waypoint.point.y * 9})`}><circle r="5" /><text x="7" y="-7">{waypoint.id}</text></g>))}</g>}
  </svg>;
}
