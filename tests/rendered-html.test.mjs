import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import releaseInfo from "../release-info.json" with { type: "json" };

async function render(pathname = "/", headers = { accept: "text/html" }) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers,
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

test("production worker exposes unified, desktop, mobile and release-contract routes", async () => {
  for (const pathname of ["/", "/?ui=desktop", "/?ui=mobile", "/desktop", "/mobile"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} must remain a valid player entry`);
    assert.match(await response.text(), /往哲荣耀/);
  }

  const healthResponse = await render("/api/health", { accept: "application/json" });
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get("cache-control"), "no-store");
  const health = await healthResponse.json();
  assert.equal(health.status, "ok");
  assert.equal(health.version, "v0.2");

  const releaseResponse = await render("/api/release", { accept: "application/json" });
  assert.equal(releaseResponse.status, 200);
  const release = await releaseResponse.json();
  assert.equal(release.release.version, "0.2.0");
  assert.equal(release.compatibility.saveVersion, 7);
  assert.equal(release.compatibility.profileVersion, 3);
  assert.match(release.play.desktop, /\/desktop$/);
  assert.match(release.play.mobile, /\/mobile$/);
});

test("server-renders the Philosophy Auto Chess landing screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, new RegExp(`<title>${releaseInfo.productName} · ${releaseInfo.englishName} · ${releaseInfo.displayVersion} · ${releaseInfo.developer}<\\/title>`, "i"));
  assert.match(html, /PHILOSOPHY AUTO CHESS \/ V0\.2/);
  assert.match(html, /折射棱镜开发/);
  assert.match(html, /理念档案/);
  assert.match(html, /当前 25 名棋子全部开放/);
  assert.match(html, /作战任务/);
  assert.match(html, /main-menu-atmosphere/);
  assert.match(html, /main-menu-sigil/);
  assert.match(html, /开始往哲荣耀/);
  assert.match(html, /本版新增/);
  assert.match(html, /历史事件与意识形态选择/);
  assert.match(html, /兼容旧版局内存档与局外档案/);
});

test("keeps game presentation and replaceable assets scoped", async () => {
  const [page, layout, client, battleInspector, combatStatus, assets, combatCss, dragSafety, readability, taskUi, mapArt, positions, browserInteractions] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/GameClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/BattleInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/CombatStatus.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/assets.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/combat-ui.css", import.meta.url), "utf8"),
    readFile(new URL("../app/game/drag-safety.css", import.meta.url), "utf8"),
    readFile(new URL("../app/game/readability.css", import.meta.url), "utf8"),
    readFile(new URL("../app/game/task-ui.css", import.meta.url), "utf8"),
    readFile(new URL("../app/game/MapArt.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/positions.ts", import.meta.url), "utf8"),
    readFile(new URL("./browser-interactions.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /resolveGamePlatform/);
  assert.match(page, /<MobileGameExperience \/>/);
  assert.match(page, /<DesktopGameExperience \/>/);
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
  for (const id of ["socrates", "plato", "aristotle", "epicurus"]) {
    assert.match(assets, new RegExp(`portrait: "/assets/characters/${id}\\.webp"`), `${id} must use its stable approved-art URL`);
  }
  for (const id of ["descartes", "rousseau", "sartre", "foucault", "althusser", "deleuze", "derrida", "lacan"]) {
    assert.match(assets, new RegExp(`portrait: "/assets/characters/${id}\\.webp"`), `${id} must use its stable approved-art URL`);
  }
  for (const id of ["fichte", "husserl", "schelling", "heidegger", "kant", "hegel", "locke", "hume", "hobbes", "russell", "bacon", "bentham", "wittgenstein"]) {
    assert.match(assets, new RegExp(`portrait: "/assets/characters/${id}\\.webp"`), `${id} must use its stable approved-art URL`);
  }
  assert.match(client, /<PortraitAsset asset=\{shopAsset\} fallback=\{unit\.portrait\}/, "shop portraits keep the card button as the input owner");
  assert.match(client, /<PortraitAsset asset=\{asset\} fallback=\{unit\.portrait\}/, "piece portraits keep the unit card as the drag owner");
  assert.match(client, /onError=\{\(\) => setFailed\(true\)\}/, "missing portrait files fall back without changing game logic");
  assert.match(client, /setWaveCue\(\{ wave: state\.wave, sequence \}\); setNotice\([^;]+; sound\("ui\.wave-start"/, "wave-start audio must fire on the initiating click instead of after the route-preview delay");
  assert.match(taskUi, /unit-avatar>img[^}]*object-fit:cover[^}]*pointer-events:none/, "portrait pixels must not change deployment hit testing");
  assert.match(assets, /enemyAssets/);
  assert.match(assets, /"war-machine"[^\n]*攻城重装/, "the World War enemy has a stable role presentation asset entry");
  assert.match(assets, /replacements/);
  assert.match(client, /WaveToast/);
  assert.match(combatStatus, /实际入账 \+\{summary\.totalGold\} 金币/);
  assert.match(combatStatus, /历史 \+\$\{historicalBonus\}/, "historical settlement income is visible and included in overflow accounting");
  assert.match(combatStatus, /ECONOMY_RULES\.goldCap\} 上限溢出/);
  assert.match(client, /预计利息（每 \$\{ECONOMY_RULES\.interestStep\} 金币 \+1）/);
  assert.doesNotMatch(client, /本局效果：/, "ideology copy must integrate philosophical meaning and available action instead of using a redundant effect label");
  assert.match(client, /WaveRouteCue key=\{waveCue\.sequence\}/, "wave start renders a deterministic route warning before combat begins");
  assert.match(client, /HistoricalDecisionDialog/, "W3 and W6 production gates expose a real player decision dialog");
  assert.match(client, /Boolean\(historicalDecision\)/, "the production start-wave control remains disabled until the decision is stored");
  assert.match(client, /data-historical-action="confirm-event"/);
  assert.match(client, /历史事件 · \$\{event\?\.title/);
  assert.match(client, /进入历史/, "the event commitment uses the requested philosophical action copy");
  assert.match(client, /data-historical-action="claim-reformation"/, "a bench-full reformation reward remains claimable after space opens");
  assert.match(client, /data-refresh-cost=\{freeRefreshes > 0 \? 0 : ECONOMY_RULES\.refreshCost\}/);
  assert.match(client, /data-historical-action="reformist-replace"/);
  assert.match(client, /shop-card-slot/);
  assert.match(client, /key=\{`shop-slot-\$\{index\}`\}/, "each market position keeps one stable React and layout owner");
  assert.match(client, /data-shop-index=\{index\}/, "filled and empty market cards expose the same slot boundary for browser geometry checks");
  assert.doesNotMatch(client, /className="shop-card shop-card--empty" key=/, "an empty purchase result must not replace its stable market-slot wrapper");
  assert.doesNotMatch(client, /reformist-replace"[^>]*>\{index \+ 1\}/, "reformism no longer exposes detached numbered market controls");
  assert.match(client, /<small>意识形态<\/small>/, "the upper status bar uses the requested ideology label");
  assert.match(client, /HistoricalQuickGuide/, "history teaching remains available from a compact non-blocking status control");
  assert.match(client, /HistoricalArchiveSummary/, "historical records share the existing mission drawer");
  assert.match(client, /档案印记.*幂等占位奖励/, "placeholder rewards explicitly promise no permanent combat value");
  const quickGuideSource = client.slice(client.indexOf("function HistoricalQuickGuide"), client.indexOf("function MainMenu"));
  assert.match(client, /<HistoricalQuickGuide state=\{state\} \/>/, "the compact history record reads the current run state");
  assert.match(quickGuideSource, /本局历史事件 · W3/);
  assert.match(quickGuideSource, /本局意识形态 · W6/);
  assert.match(quickGuideSource, /historicalEventDefinitionById\.get/, "the history card resolves only the event stored in this run");
  assert.match(quickGuideSource, /historicalStanceSummaryForEvent/, "the ideology card explains only the stance stored in this run");
  assert.match(quickGuideSource, /stance\.philosophy/, "the run record must explain philosophical meaning before the permitted action");
  for (const unrelatedEntry of ["工业革命", "改良主义", "自由主义", "世界大战", "五月风暴"]) {
    assert.doesNotMatch(quickGuideSource, new RegExp(unrelatedEntry), `the current-run history card must not hardcode ${unrelatedEntry}`);
  }
  assert.match(taskUi, /\.historical-quick-guide-panel[^}]*position: absolute[^}]*top: calc\(100% \+ 7px\)[^}]*right: 0/s, "the history record must open directly below its own summary control");
  assert.match(client, /function CoreHealthControl/, "the philosopher stone health bar owns an interactive damage ledger");
  assert.match(client, /data-core-damage-source=\{source\}/);
  assert.match(client, /battle\.summary\?\.statistics\.coreDamageBySource \?\? battle\.statistics\?\.coreDamageBySource/, "the core ledger reads the authoritative deterministic combat statistics");
  assert.match(taskUi, /\.core-damage-ledger\{[^}]*right:0[^}]*left:auto/, "the core damage ledger stays anchored to the clickable health bar");
  assert.match(client, /data-historical-action="liberal-sale"/);
  assert.match(client, /toggleShopFreeze/);
  assert.match(client, /aria-pressed=\{state\.shopFrozen\}/, "shop freeze is an engine-owned persisted preparation choice");
  assert.match(client, /boss boss-kind-\$\{enemy\.kind\}/, "every boss kind receives the large landmark presentation class");
  assert.match(client, /effectiveMaxDeploy\(state\.level, state\.historicalEvents\)/, "event population bonuses are visible in the main HUD");
  assert.match(client, /effectiveInterestForGold\(state\.gold, state\.historicalEvents\)/, "event economy changes are visible in the main HUD");
  assert.match(taskUi, /\.historical-decision-layer[^}]*position: fixed/s, "historical decisions use a blocking production modal");
  assert.match(taskUi, /\.reformist-replace-button[^}]*position: absolute/s, "each replacement control is anchored to its own market card slot");
  assert.match(taskUi, /\.game-shell--showcase > \.status-line \{ display: flex!important/, "the historical status line must override the old desktop hidden rule");
  assert.match(taskUi, /\.enemy-token\.boss[^}]*--map-enemy: max\(11\.5cqw, 144px\)/, "mid-run bosses have a large visual floor");
  assert.match(taskUi, /boss-kind-leviathan-boss[^}]*--map-enemy: max\(13\.5cqw, 170px\)/s, "final bosses have an even larger visual floor");
  assert.match(client, /startWave\(stateRef\.current\)/, "the delayed route cue starts from the latest preparation state instead of a stale closure");
  assert.match(client, /return \(\) => window\.clearTimeout\(timer\)/, "transient feedback timers clean up on lifecycle changes");
  assert.match(client, /经验 \+4/);
  assert.doesNotMatch(client, /理念重排 · 商店已刷新/, "refresh feedback stays visual without redundant copy");
  assert.match(combatStatus, /第 \$\{summary\.wave\} 波肃清/);
  assert.match(combatStatus, /setTimeout\(\(\) => setExpanded\(false\), 1450\)/, "ordinary wave settlement automatically yields to the next preparation phase");
  assert.match(client, /battle\.status !== "complete" && <WaveToast/, "the persistent final victory screen is not covered by a transient wave settlement");
  assert.match(combatCss, /map-field \.wave-toast\.expanded\{position:absolute/);
  assert.match(combatCss, /wave-route-cue/);
  assert.match(combatCss, /shop-grid\.is-refreshing/);
  assert.match(combatCss, /prefers-reduced-motion:reduce/);
  assert.match(client, /className="map-inspector"/);
  assert.match(battleInspector, /className="inspector-cost"[^>]*>\{unit\.cost\} 费</, "battlefield unit details show the canonical character cost");
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
  assert.match(layout, /readability\.css/);
  assert.match(layout, /task-ui\.css/);
  assert.match(dragSafety, /\.map-art[^}]*pointer-events:none/);
  assert.match(dragSafety, /\.operation-grid[^}]*pointer-events:none/);
  assert.match(dragSafety, /\.deploy-grid \.slot[^}]*pointer-events:auto/);
  assert.match(dragSafety, /\.enemy-track[^}]*z-index:14[^}]*pointer-events:none/);
  assert.match(client, /onDrop=\{invalidDrop\}/);
  assert.match(client, /onDrop=\{drop\}/);
  assert.match(client, /className="drag-sell-zone bench-sell-zone"/);
  assert.match(client, /operationDockOpen \? "" : "economy-deck-collapsed"/, "reserve and market share one visibility state");
  assert.match(client, /setOperationDockOpen\(true\)/, "advancing a wave automatically reopens the unified operation drawer");
  assert.match(client, /setOperationDockOpen\(false\)/, "starting combat collapses the unified drawer without changing game state");
  assert.doesNotMatch(client, /shopOpen|benchOpen/, "reserve and market must not retain independent visibility sources");
  assert.doesNotMatch(client, />情报<\/button>/, "the duplicated intel window control must not remain in the player-facing top bar");
  assert.match(client, /className="top-info-popover economy-breakdown"/, "gold owns its income and interest explanation");
  assert.match(client, /className="top-info-popover progression-breakdown"/, "population owns the adjacent level and experience explanation");
  assert.match(client, /className="top-info-popover wave-breakdown"/, "wave owns the concrete enemy forecast");
  assert.match(client, /className="economy-dock-tabs"/, "reserve and market controls live in the lower operation band");
  assert.match(taskUi, /economy-deck[^}]*height:230px!important[^}]*overflow:hidden!important/, "the desktop operation frame reserves bottom breathing room and clips accidental overflow");
  assert.match(taskUi, /economy-deck>\.bench,[^}]*economy-deck>\.shop\{height:187px!important;min-height:187px!important;align-self:stretch;overflow:hidden!important\}/, "reserve and market share one contained bottom edge");
  assert.match(client, /备战与商店/, "reserve and market expose one combined drawer control");
  assert.match(client, /setOperationDockOpen\(\(open\) => !open\)/, "the one lower control collapses and expands both sections together");
  assert.match(taskUi, /shop-skill-summary\{font-size:10px!important/, "shop skill text must not regress to the previous six-to-seven-pixel desktop size");
  assert.match(taskUi, /board-grid \.unit-name strong\{font-size:11px!important/, "battlefield unit names remain readable after the map yields space to text");
  assert.match(taskUi, /quick-wave\{min-width:112px[^}]*font-size:15px!important/, "start wave remains visually stronger than secondary top actions");
  assert.match(taskUi, /map-field\{width:92%!important[^}]*max-width:92%!important/, "desktop map yields measured room to larger information panels without changing its ratio");
  assert.match(taskUi, /telemetry-rail p[^}]*font-size:12px!important/, "persistent side information uses a readable desktop floor");
  assert.match(taskUi, /shop-skill-summary\{font-size:10px!important/, "shop decision copy receives the readability-first desktop scale");
  assert.match(taskUi, /grid-template-columns:minmax\(0,40fr\) minmax\(0,60fr\)/, "the unified drawer assigns spare reserve width to shop readability");
  assert.match(taskUi, /font-family:Georgia,"Noto Serif SC","Source Han Serif SC"/, "display labels must use the deliberate philosophy serif stack");
  assert.match(taskUi, /font-family:"Noto Sans SC","Source Han Sans SC","Microsoft YaHei UI"/, "body copy must retain a readable local sans stack");
  assert.match(client, /philosophy-auto-chess-profile-v1/);
  assert.match(client, /import\.meta\.env\.DEV && local/);
  assert.match(client, /data-debug="reset-profile"/);
  assert.match(client, /if \(!devToolsEnabled \|\| battle\.status === "running"\) return/, "profile reset remains unavailable outside the explicit local development gate");
  assert.match(client, /map-choice-layer--revolution/);
  assert.match(client, /portrait-\$\{shopAsset\.portraitShape\}/);
  assert.match(client, /portrait-\$\{asset\.portraitShape\}/);
  assert.match(taskUi, /portrait-pentagon[^}]*clip-path:polygon/);
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
  assert.match(client, /battle\.status !== "running" \|\| !phaseEvent/, "Boss phase banners must leave the screen before victory or defeat presentation");
  assert.match(client, /BossHealthBar/, "the W10 boss exposes a wide independent health display");
  assert.match(client, /本局战斗耗时/);
  assert.match(client, /最终成型阵营/);
  assert.match(client, /阵容与贡献战绩/);
  assert.match(client, /最终阵营/);
  assert.match(client, /激活羁绊/);
  assert.match(client, /data-victory-ranking=\{rankingMetric\}/);
  assert.match(client, /aria-pressed=\{rankingMetric === metric\}/, "damage, tanking, healing and shielding share one compact switchable ranking");
  assert.match(client, /state\.historicalEvents\.eventId === "event:world_war" && machines > 0/, "World War records appear only when that event and an actual encounter exist");
  assert.doesNotMatch(client, /<small>刷新次数<\/small>/, "debug-like refresh counts do not occupy the shareable victory record");
  assert.doesNotMatch(client, /<small>购买经验<\/small>/, "debug-like XP purchase counts do not occupy the shareable victory record");
  assert.match(client, /summarizeVictoryRun/);
  assert.match(client, /className="victory-lineup"/, "victory presents the actual final fielded roster");
  assert.match(client, /data-victory-character-id=\{unit\.id\}/, "victory roster icons retain stable character identities");
  assert.match(client, /className="victory-record-toggle"/, "detailed settlement data opens from a dedicated adjacent record control");
  assert.match(client, /className="victory-record-drawer"/, "the historical ledger is hidden in an intentional record drawer");
  assert.doesNotMatch(client, /THE RUN IN HISTORY/, "the English history block no longer occupies the centre of the victory screen");
  assert.match(client, /aria-label="音乐与音效设置"/);
  assert.match(client, /AUDIO_SETTINGS_KEY/);
  assert.match(client, /SoundEffectPlayer/);
  assert.match(client, /MusicTrackPlayer/);
  assert.match(client, /data-refresh-cost=\{freeRefreshes > 0 \? 0 : ECONOMY_RULES\.refreshCost\}/, "industrial refresh must reuse the stable market refresh control");
  assert.doesNotMatch(client, /data-historical-action="free-refresh"/, "industrial refresh must not add a fourth detached market button");
  assert.doesNotMatch(client, /\[SAVE_KEY, MANUAL_SAVE_KEY, \.\.\.LEGACY_SAVE_KEYS\]/, "whole-run reset must not erase the independent manual slot");
  assert.match(client, /手动存档仍可读取/, "reset feedback must state that the manual fallback remains available");
  assert.match(dragSafety, /\.settings-dialog>header>button\{/, "only the direct dialog close button may receive the fixed square geometry");
  assert.doesNotMatch(dragSafety, /\.settings-dialog header button\{/, "nested settings controls must not inherit the close-button width");
  assert.match(taskUi, /\.audio-settings>header button\{[^}]*min-width:68px[^}]*white-space:nowrap/, "the audio mute control must keep a readable horizontal label");
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
  assert.match(client, /philosophy-auto-chess-save/, "production settings export a versioned portable save bundle");
  assert.match(client, /className="save-transfer-input"/, "production settings expose a player-facing JSON import path");
  assert.match(client, /IMPORT_BACKUP_KEY/, "successful imports retain a recovery backup");
  assert.match(client, /文件结构无效或已损坏，现有进度未被修改/, "invalid imports fail without replacing the current run");
  assert.match(client, /idea-garrison-balance-report-v2/, "feedback reports use a versioned export format");
  assert.match(client, /局后报告与反馈/);
  assert.match(client, /WaveDiagnostic/);
  assert.match(client, /王座职业实际增量/);
  assert.match(client, /攻击与技能射程遍布全图/, "the philosopher king guide must disclose global reach");
  assert.match(client, /射手\/群攻伤害 \+30%/, "the throne guide must disclose role-specialized power");
  assert.match(client, /absolute-spirit-sigil/, "Absolute Spirit uses its authored triadic sigil instead of a text glyph");
  assert.match(client, /\$\{template\.name\}·分有/, "atomized Absolute Spirit fragments keep their boss identity");
  assert.match(taskUi, /\.enemy-token\.boss\.atom-boss[^}]*--map-enemy/, "Absolute Spirit fragments have a dedicated small-boss footprint");
  assert.match(client, /className="royal-barrier-shield"/, "the royal barrier renders as a core-covering shield instead of a lane-local wall");
  assert.match(client, /三路核心护罩/, "the barrier presentation makes its shared three-route ownership explicit");
  assert.match(dragSafety, /\.royal-barrier-shield\{[^}]*border-radius:50%/, "the shared barrier has a visible protective-dome silhouette");
  assert.match(client, /全图射程和站位变化仍需与同阵容正常部署的另一局比较/);
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
  assert.match(dragSafety, /map-inspector\{top:58px;bottom:auto;width:280px;max-height:calc\(100% - 68px\)/, "desktop unit details anchor above the floating operation dock");
  assert.match(dragSafety, /map-inspector\{top:58px;bottom:auto;width:280px/, "desktop unit details use the enlarged readable width");
  assert.match(dragSafety, /range-preview[^}]*border-radius:50%/);
  assert.match(dragSafety, /victory-sequence/);
  assert.match(dragSafety, /victory-lineup-grid[^}]*grid-template-columns:repeat\(auto-fit/, "victory lineup adapts to the number of winning pieces");
  assert.match(dragSafety, /victory-record-layer[^}]*place-items:stretch end/, "settlement details open as a side ledger instead of a permanent centre block");
  assert.match(dragSafety, /bench \.slot-empty[^}]*display:grid/);
  assert.match(dragSafety, /tempo-button/);
  assert.match(dragSafety, /drag-sell-zone/);
  assert.match(dragSafety, /bench-sell-zone\{inset:0 0 0 calc\(48% \+ 10px\);width:auto;height:auto;min-height:0/);
  assert.match(dragSafety, /shop\.shop--sell-target::after\{content:"◇  拖入出售\\A折价回收"/);
  assert.match(readability, /unit-name strong\{font-size:max\(\.76cqw,8px\)!important/);
  assert.match(readability, /game-shell--showcase\{[^}]*height:auto!important;[^}]*min-height:100dvh!important;[^}]*max-height:none!important;[^}]*overflow-y:visible!important/, "desktop zoom must grow the document instead of clipping it to one viewport");
  assert.match(readability, /aspect-ratio:16\/9!important/, "readability changes preserve the 1600 by 900 combat coordinate ratio");
  assert.match(readability, /max-width:1400px[^]*board-grid\{grid-template-columns:1fr!important/, "narrow desktop viewports stack the command rail instead of shrinking the arena");
  assert.match(dragSafety, /effect-core[^}]*position:absolute/);
  assert.match(dragSafety, /operation-grid[^}]*repeat\(16/);
  assert.match(dragSafety, /operation-grid[^}]*repeat\(10/);
  assert.match(dragSafety, /operation-grid\{position:absolute;inset:0;display:grid;grid-template-columns:repeat\(16,minmax\(0,1fr\)\);grid-template-rows:repeat\(10,minmax\(0,1fr\)\);padding:0;margin:0\}/, "drag targets must remain a full-map 16 × 10 overlay");
  const mapFieldStart = client.indexOf('className={`map-field');
  const mapPanelClose = client.indexOf('<aside className={`economy panel', mapFieldStart);
  const economyDeckStart = client.indexOf('<section className={`economy-deck');
  assert.ok(mapFieldStart >= 0 && mapPanelClose > mapFieldStart, "map field closes before the command rail");
  assert.ok(economyDeckStart > mapPanelClose, "economy deck is outside the map overlay container");
  assert.match(client, /<section className=\{\`economy-deck/);
  assert.match(client, /<section data-tutorial="bench" className="bench panel"/);
  assert.match(client, /<section data-tutorial="shop" className=\{\`shop panel/);
  assert.match(client, /<b>人口 \{state\.pieces\.filter/, "population is labeled inside the prominent value, not only in secondary copy");
  assert.match(client, /TUTORIAL_STEPS[^]*购买经验提升等级/);
  assert.match(client, /localStorage\.setItem\(TUTORIAL_KEY, "complete"\)/, "tutorial completion persists independently from the game save");
  assert.match(client, /重看新手引导/);
  assert.match(browserInteractions, /shop--sell-target/);
  assert.match(browserInteractions, /descartes,rousseau,sartre,foucault/);
  assert.match(browserInteractions, /医学/);
  assert.match(browserInteractions, /rousseau,locke,hume,kant/);
  assert.match(browserInteractions, /Greek rostrum UI must never expose internal piece ids/);
  assert.match(browserInteractions, /Greek rostrum must not auto-prompt again during the same run/);
});

test("exposes automatic, desktop and mobile UI entry choices without forking saves", async () => {
  const gameClientSource = await readFile(new URL("../app/game/GameClient.tsx", import.meta.url), "utf8");
  assert.match(gameClientSource, /aria-label="界面模式"/);
  assert.match(gameClientSource, /href="\/">自动<\/a>/);
  assert.match(gameClientSource, /href="\/\?ui=desktop">桌面版<\/a>/);
  assert.match(gameClientSource, /href="\/\?ui=mobile">手机版<\/a>/);
  assert.match(gameClientSource, /不会改变同源浏览器中的存档和游戏规则/);
});

test("ships valid production portraits for the approved character rosters", async () => {
  const [processor, provenance] = await Promise.all([
    readFile(new URL("../scripts/process-character-art.py", import.meta.url), "utf8"),
    readFile(new URL("../work/art-source/greek-v1/README.md", import.meta.url), "utf8"),
  ]);
  assert.match(processor, /def normalize_framed_art/, "approved framed art must use the deterministic full-composition pipeline");
  assert.match(processor, /ImageDraw\.floodfill/, "white canvas removal must stay edge-connected instead of deleting light costume details");
  assert.match(provenance, /--crop 0,0,2048,2048 --framed-art --frame-padding 8/, "Greek asset provenance must preserve the complete source composition");
  for (const id of ["socrates", "plato", "aristotle", "epicurus"]) {
    const portrait = await readFile(new URL(`../public/assets/characters/${id}.webp`, import.meta.url));
    assert.ok(portrait.length > 80_000, `${id} portrait should retain enough detail for UI scaling`);
    assert.equal(portrait.subarray(0, 4).toString("ascii"), "RIFF", `${id} portrait must use a WebP RIFF container`);
    assert.equal(portrait.subarray(8, 12).toString("ascii"), "WEBP", `${id} portrait must be a valid WebP asset`);
    assert.equal(portrait.subarray(12, 16).toString("ascii"), "VP8X", `${id} portrait must support the transparent pentagon crop`);
    assert.ok((portrait[20] & 0x10) !== 0, `${id} portrait must carry an alpha channel instead of white crop corners`);
  }
  const franceProvenance = await readFile(new URL("../work/art-source/france-v1/README.md", import.meta.url), "utf8");
  assert.match(franceProvenance, /8 个法国角色使用 8 张唯一素材/);
  assert.match(franceProvenance, /--crop 0,0,2048,2048 --size 512 --framed-art --frame-padding 8/, "French asset provenance must preserve the complete source composition");
  for (const id of ["descartes", "rousseau", "sartre", "foucault", "althusser", "deleuze", "derrida", "lacan"]) {
    const portrait = await readFile(new URL(`../public/assets/characters/${id}.webp`, import.meta.url));
    assert.ok(portrait.length > 75_000, `${id} portrait should retain enough detail for UI scaling`);
    assert.equal(portrait.subarray(0, 4).toString("ascii"), "RIFF", `${id} portrait must use a WebP RIFF container`);
    assert.equal(portrait.subarray(8, 12).toString("ascii"), "WEBP", `${id} portrait must be a valid WebP asset`);
    assert.equal(portrait.subarray(12, 16).toString("ascii"), "VP8X", `${id} portrait must support the transparent pentagon corners`);
    assert.ok((portrait[20] & 0x10) !== 0, `${id} portrait must carry an alpha channel instead of white corners`);
  }
  const finalProvenance = await readFile(new URL("../work/art-source/germany-britain-v1/README.md", import.meta.url), "utf8");
  assert.match(finalProvenance, /两张霍布斯图是同一构图的近似重复副本/);
  assert.match(finalProvenance, /罗素原图随后单独交付并按相同规范接入/);
  for (const id of ["fichte", "husserl", "schelling", "heidegger", "kant", "hegel", "locke", "hume", "hobbes", "russell", "bacon", "bentham", "wittgenstein"]) {
    const portrait = await readFile(new URL(`../public/assets/characters/${id}.webp`, import.meta.url));
    assert.ok(portrait.length > 50_000, `${id} portrait should retain enough detail for UI scaling`);
    assert.equal(portrait.subarray(0, 4).toString("ascii"), "RIFF", `${id} portrait must use a WebP RIFF container`);
    assert.equal(portrait.subarray(8, 12).toString("ascii"), "WEBP", `${id} portrait must be a valid WebP asset`);
    assert.equal(portrait.subarray(12, 16).toString("ascii"), "VP8X", `${id} portrait must support transparent framed art`);
    assert.ok((portrait[20] & 0x10) !== 0, `${id} portrait must carry an alpha channel instead of canvas corners`);
  }
});
