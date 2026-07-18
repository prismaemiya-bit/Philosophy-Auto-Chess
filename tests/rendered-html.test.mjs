import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import releaseInfo from "../release-info.json" with { type: "json" };

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Philosophy Auto Chess landing screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, new RegExp(`<title>${releaseInfo.productName} · ${releaseInfo.englishName} · ${releaseInfo.displayVersion} · ${releaseInfo.developer}<\\/title>`, "i"));
  assert.match(html, /PHILOSOPHY AUTO CHESS \/ V0\.1\.1/);
  assert.match(html, /折射棱镜开发/);
  assert.match(html, /欢迎来到往哲荣耀/);
  assert.match(html, /开始往哲荣耀/);
});

test("keeps game presentation and replaceable assets scoped", async () => {
  const [page, layout, client, combatStatus, assets, combatCss, dragSafety, mapArt, positions, browserInteractions] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/GameClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/CombatStatus.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/assets.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/combat-ui.css", import.meta.url), "utf8"),
    readFile(new URL("../app/game/drag-safety.css", import.meta.url), "utf8"),
    readFile(new URL("../app/game/MapArt.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/positions.ts", import.meta.url), "utf8"),
    readFile(new URL("./browser-interactions.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import GameClient/);
  assert.match(page, /<GameClient \/>/);
  assert.match(layout, /title:/);
  assert.match(layout, /combat-ui\.css/);
  assert.match(client, /WaveForecast/);
  assert.match(client, /dragTerrain/);
  assert.match(client, /activeTerrain/);
  assert.match(client, /activePiece = draggedUnit/);
  assert.match(client, /dropAllowed/);
  assert.doesNotMatch(client, /RouteOverlay/);
  assert.match(client, /<MapArt dangerLanes=/);
  assert.match(client, /CombatEffects/);
  assert.match(assets, /characterAssets/);
  assert.match(assets, /enemyAssets/);
  assert.match(assets, /replacements/);
  assert.match(client, /WaveToast/);
  assert.match(combatStatus, /实际入账 \+\{summary\.totalGold\} 金币/);
  assert.match(combatStatus, /30 上限溢出/);
  assert.match(client, /预计利息（5\/10\/15档）/);
  assert.match(client, /WaveRouteCue key=\{waveCue\.sequence\}/, "wave start renders a deterministic route warning before combat begins");
  assert.match(client, /startWave\(stateRef\.current\)/, "the delayed route cue starts from the latest preparation state instead of a stale closure");
  assert.match(client, /return \(\) => window\.clearTimeout\(timer\)/, "transient feedback timers clean up on lifecycle changes");
  assert.match(client, /经验 \+4/);
  assert.doesNotMatch(client, /理念重排 · 商店已刷新/, "refresh feedback stays visual without redundant copy");
  assert.match(combatStatus, /第 \$\{summary\.wave\} 波肃清/);
  assert.match(combatCss, /map-field \.wave-toast\.expanded\{position:absolute/);
  assert.match(combatCss, /wave-route-cue/);
  assert.match(combatCss, /shop-grid\.is-refreshing/);
  assert.match(combatCss, /prefers-reduced-motion:reduce/);
  assert.match(client, /className="map-inspector"/);
  assert.match(client, /VictorySequence/);
  assert.match(client, /DefeatSequence/);
  assert.match(client, /重试本波/);
  assert.match(client, /重新开始整局/);
  assert.match(client, /className="tempo-button"/);
  assert.doesNotMatch(client, /战斗中可购买|买走留空|波次后补货|出售为折价回收/);
  assert.doesNotMatch(client, /economy panel[^\n]*selection-dock/);
  assert.match(layout, /map-art\.css/);
  assert.match(mapArt, /viewBox="0 0 1600 900"/);
  assert.match(mapArt, /routeDefinitions/);
  assert.match(positions, /DEPLOYMENT_SLOT_IDS/);
  assert.doesNotMatch(mapArt, /concept-map|backgroundSize|background-size\s*:/);
  assert.doesNotMatch(client, /<details className="debug-panel/);
  assert.match(combatCss, /operation-grid[^}]*display:none/);
  assert.match(layout, /drag-safety\.css/);
  assert.match(dragSafety, /\.map-art[^}]*pointer-events:none/);
  assert.match(dragSafety, /\.operation-grid[^}]*pointer-events:none/);
  assert.match(dragSafety, /\.deploy-grid \.slot[^}]*pointer-events:auto/);
  assert.match(dragSafety, /\.enemy-track[^}]*z-index:14[^}]*pointer-events:none/);
  assert.match(client, /onDrop=\{invalidDrop\}/);
  assert.match(client, /onDrop=\{drop\}/);
  assert.match(client, /className="drag-sell-zone bench-sell-zone"/);
  assert.match(client, /shop panel \$\{dragged \? "shop--sell-target" : ""\}/);
  assert.match(client, /map-choice-layer--revolution/);
  assert.match(client, /revolutionNodeId/);
  assert.match(client, /rostrum-candidate/);
  assert.match(client, /resonance-tier-list/);
  assert.match(client, /ResonanceRoster/);
  assert.match(client, /className="unit-gauges"/, "pieces expose separate health and energy presentation gauges");
  assert.match(client, /faction-\$\{unit\.faction\}/, "piece presentation carries its faction identity without changing placement geometry");
  assert.match(client, /className=\{deployed\.has\(memberId\) \? "lit" : "unlit"\}/);
  assert.match(client, /battle\.status === "running" \? battle\.traitSnapshot/, "only an active wave may read a frozen trait snapshot");
  assert.match(client, /DecisionCards/, "major preparation choices render as dedicated decision cards");
  assert.match(client, /BossPhaseBanner/, "the W10 boss exposes a dedicated phase event layer");
  assert.match(client, /BossHealthBar/, "the W10 boss exposes a wide independent health display");
  assert.match(client, /本局战斗耗时/);
  assert.match(client, /最终成型阵营/);
  assert.match(client, /重新开始一局/);
  assert.doesNotMatch(client, /铭记胜利/);
  assert.doesNotMatch(client, /政治算术整局只能领取一次/);
  assert.doesNotMatch(client, /WaveReview/, "the compact telemetry rail does not repeat a wave review");
  assert.match(client, /visibleIds = allResonanceIds\.filter/, "the resonance rail hides traits absent from the current lineup");
  assert.match(client, /aria-label="局内资源"/, "the command rail owns a separate resource dashboard below the forecast");
  assert.match(client, /WAVE INTELLIGENCE/);
  assert.match(client, /GAME STATUS/);
  assert.match(client, /RESERVE ROSTER/);
  assert.match(client, /IDEA MARKET/);
  assert.match(client, /className="shop-odds"/);
  assert.match(client, /挡 \{unit\.block\}·防 \{unit\.stats\.guard\}/, "shop decisions expose the Guard stat used by incoming enemy damage");
  assert.match(client, /ResonanceDirectory/, "inactive resonances remain inspectable outside the battlefield text layer");
  assert.match(client, /import\.meta\.env\.DEV && local && \(query\.get\("devtools"\) === "1"/, "cheat and calibration tools require a development build and explicit localhost opt-in");
  assert.match(client, /FeedbackTools state=\{state\}/, "production settings retain the read-only balance feedback exporter");
  assert.match(client, /idea-garrison-balance-report-v2/, "feedback reports use a versioned export format");
  assert.match(client, /局后报告与反馈/);
  assert.match(client, /WaveDiagnostic/);
  assert.match(client, /王座 10% 实际增量/);
  assert.match(client, /射程和站位变化仍需与同阵容正常部署的另一局比较/);
  assert.match(client, /report\.economy\.refreshes/);
  assert.match(client, /report\.economy\.xpPurchases/);
  assert.match(client, /post-route-report/);
  assert.match(client, /post-unit-report/);
  assert.match(dragSafety, /post-battle-history/);
  assert.match(dragSafety, /post-king-report/);
  assert.doesNotMatch(client, /<span>关卡控制<\/span><em>手动波次<\/em>/, "non-interactive wave-control heading is removed");
  assert.match(client, /settings-note[^\n]*devToolsEnabled[^\n]*TestControls/, "development controls live inside settings instead of the command rail");
  assert.match(client, /调整革命节点（3 项）/);
  assert.match(client, /选择研究路线（力学 \/ 医学 \/ 政治算术）/);
  assert.match(client, /不依赖敌人入口/);
  assert.doesNotMatch(client, /实验路线/);
  assert.doesNotMatch(client, /experimentRouteIds/);
  assert.match(dragSafety, /map-choice-layer--revolution/);
  assert.match(dragSafety, /resonance-tier-list/);
  assert.match(dragSafety, /resonance-roster/);
  assert.match(client, /ArenaResonanceRail/, "all resonances live in the dedicated left arena rail");
  assert.match(client, /ArenaTelemetryRail/, "combat rankings live in the dedicated right arena rail");
  assert.match(dragSafety, /resonance-rail button[^}]*cursor:pointer/, "resonance rail buttons remain clickable beside the map");
  assert.match(dragSafety, /decision-card-grid/);
  assert.doesNotMatch(client, /className="sell-zone"/);
  assert.match(dragSafety, /map-art[^}]*pointer-events:none/);
  assert.match(dragSafety, /battlefield-showcase\.png/);
  assert.match(dragSafety, /philosophy-map-final-v1-1600x900\.png/);
  assert.match(dragSafety, /map-field\.is-dragging>\.map-art\{filter:saturate\(\.68\) brightness\(\.56\);transition:none\}/);
  assert.match(dragSafety, /is-dragging \.enemy-token[^}]*pointer-events:none/);
  assert.match(dragSafety, /map-inspector[^}]*width:218px/);
  assert.match(dragSafety, /range-preview[^}]*border-radius:50%/);
  assert.match(dragSafety, /victory-sequence/);
  assert.match(dragSafety, /bench \.slot-empty[^}]*display:grid/);
  assert.match(dragSafety, /tempo-button/);
  assert.match(dragSafety, /drag-sell-zone/);
  assert.match(dragSafety, /bench-sell-zone\{inset:0 0 0 calc\(48% \+ 10px\);width:auto;height:auto;min-height:0/);
  assert.match(dragSafety, /shop\.shop--sell-target::after\{content:"◇  拖入出售\\A折价回收"/);
  assert.match(dragSafety, /board-grid \.unit-name[^}]*font-size:7px!important[^}]*text-overflow:clip/);
  assert.match(dragSafety, /effect-core[^}]*position:absolute/);
  assert.match(dragSafety, /operation-grid[^}]*repeat\(16/);
  assert.match(dragSafety, /operation-grid[^}]*repeat\(10/);
  assert.match(dragSafety, /operation-grid\{position:absolute;inset:0;display:grid;grid-template-columns:repeat\(16,minmax\(0,1fr\)\);grid-template-rows:repeat\(10,minmax\(0,1fr\)\);padding:0;margin:0\}/, "drag targets must remain a full-map 16 × 10 overlay");
  const mapFieldStart = client.indexOf('className={`map-field');
  const mapPanelClose = client.indexOf('<aside className="economy panel">', mapFieldStart);
  const economyDeckStart = client.indexOf('<section className="economy-deck">');
  assert.ok(mapFieldStart >= 0 && mapPanelClose > mapFieldStart, "map field closes before the command rail");
  assert.ok(economyDeckStart > mapPanelClose, "economy deck is outside the map overlay container");
  assert.match(client, /<section className="economy-deck"><section className="bench panel">/);
  assert.match(client, /<\/section>\s*<section className=\{\`shop panel \$\{dragged \? "shop--sell-target" : ""\}\`\}/);
  assert.match(browserInteractions, /shop--sell-target/);
  assert.match(browserInteractions, /descartes,rousseau,sartre,foucault/);
  assert.match(browserInteractions, /医学/);
  assert.match(browserInteractions, /rousseau,locke,hume,kant/);
  assert.match(browserInteractions, /Greek rostrum UI must never expose internal piece ids/);
  assert.match(browserInteractions, /Greek rostrum must not auto-prompt again during the same run/);
});
