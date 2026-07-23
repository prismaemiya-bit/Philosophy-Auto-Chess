import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.IDEA_GARRISON_E2E_PORT ?? 4173);
const baseUrl = `http://127.0.0.1:${port}/?devtools=1`;
const chromePath = process.env.CHROME_PATH
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const remotePort = port + 1000;
const artifacts = path.join(root, "artifacts");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(check, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  return {
    call(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
    close() { socket.close(); },
  };
}

async function main() {
  const userData = await mkdtemp(path.join(tmpdir(), "idea-garrison-chrome-"));
  const server = spawn(process.execPath, [path.join(root, "node_modules", "vinext", "dist", "cli.js"), "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: { ...process.env, BROWSER: "none", WRANGLER_LOG_PATH: path.join(root, ".wrangler", "wrangler.log") },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += String(chunk); });
  server.stderr.on("data", (chunk) => { serverLog += String(chunk); });
  let chrome;
  let cdp;
  try {
    await waitFor(async () => {
      const response = await fetch(baseUrl);
      return response.ok;
    }, "vinext development server", 45_000);

    chrome = spawn(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${remotePort}`,
      `--user-data-dir=${userData}`,
      "--window-size=1920,1080",
      "about:blank",
    ], { stdio: "ignore" });

    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json/list`);
      const targets = await response.json();
      return targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    }, "Chrome DevTools endpoint");
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const response = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    };
    const exists = (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const existsAny = async (...selectors) => {
      for (const selector of selectors) if (await exists(selector)) return true;
      return false;
    };
    const waitSelector = (selector) => waitFor(() => exists(selector), selector);
    const waitHydrated = () => waitFor(() => evaluate(`(() => { const button = document.querySelector('.landing .primary'); return Boolean(button && Object.keys(button).some((key) => key.startsWith('__reactProps'))); })()`), "React hydration");
    const click = async (selector) => {
      const clicked = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
      assert.equal(clicked, true, `missing clickable element: ${selector}`);
      await delay(180);
    };
    const clickText = async (selector, text) => {
      const clicked = await evaluate(`(() => { const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)})); if (!element) return false; element.click(); return true; })()`);
      assert.equal(clicked, true, `missing ${selector} containing ${text}`);
      await delay(180);
    };
    const setValue = async (selector, value) => {
      const changed = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, ${JSON.stringify(String(value))}); element.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
      assert.equal(changed, true, `missing input: ${selector}`);
      await delay(120);
    };
    const capture = async (name) => {
      const shot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await mkdir(artifacts, { recursive: true });
      await writeFile(path.join(artifacts, name), Buffer.from(shot.data, "base64"));
    };
    const reset = async () => {
      await evaluate("localStorage.clear()");
      // Keep the existing interaction suite focused on drag/drop and combat.
      // Tutorial behavior has its own rendered-DOM assertions and acceptance pass.
      await evaluate("localStorage.setItem('philosophy-auto-chess-tutorial-v1', 'complete')");
      await cdp.call("Page.navigate", { url: baseUrl });
      await delay(800);
      await waitFor(() => existsAny(".landing .primary", ".game-shell"), "landing or game shell after reset");
      if (await exists(".landing .primary")) {
        await waitHydrated();
        await click(".landing .primary");
      }
      await waitSelector(".game-shell");
      await waitSelector(".settings-button");
    };
    const loadHistoricalScenario = async (wave, historicalPatch) => {
      await reset();
      await waitFor(() => evaluate("Boolean(localStorage.getItem('idea-garrison-v01-save-v6'))"), "stable V7 save before historical scenario");
      await evaluate(`(() => { const key = 'idea-garrison-v01-save-v6'; const save = JSON.parse(localStorage.getItem(key)); const patch = ${JSON.stringify(historicalPatch)}; save.wave = ${wave}; save.battle = undefined; save.waveCheckpoint = undefined; save.historicalEvents = { ...save.historicalEvents, ...patch, waveFlags: { ...save.historicalEvents.waveFlags, ...(patch.waveFlags ?? {}), wave: ${wave} } }; localStorage.setItem(key, JSON.stringify(save)); })()`);
      await cdp.call("Page.navigate", { url: baseUrl });
      await waitFor(() => existsAny(".landing .primary", ".game-shell"), "historical scenario landing");
      if (await exists(".landing .primary")) {
        await waitHydrated();
        await clickText(".main-menu-actions button", "继续征程");
      }
      await waitSelector(".game-shell");
      const expectsDecision = (wave === 3 && historicalPatch.eventResolved !== true) || (wave === 6 && !historicalPatch.selectedStanceId);
      if (expectsDecision) await waitSelector(".historical-decision-dialog");
    };
    const applyLineup = async (lineup, pendingResearch = 0, shop = undefined) => {
      if (!(await exists(".developer-tools"))) {
        await click(".settings-button");
        await waitSelector(".developer-tools");
      }
      await evaluate("document.querySelector('.developer-tools').open = true");
      await setValue('[data-debug="lineup"]', lineup);
      await setValue('[data-debug="pending-research"]', pendingResearch);
      if (shop !== undefined) await setValue('[data-debug="shop"]', shop);
      await click('[data-debug="apply"]');
      await click(".settings-button");
    };

    await cdp.call("Page.navigate", { url: baseUrl });
    await waitFor(() => existsAny(".landing .primary", ".game-shell"), "initial app shell");
    await waitHydrated();
    await capture("main-menu-1920x1080.png");
    assert.equal(await exists(".main-menu .version-notes"), true, "the main menu must expose concise V0.2 notes without opening gameplay");
    await evaluate("document.querySelector('.main-menu .version-notes').open = true");
    const versionNotes = await evaluate(`(() => { const node = document.querySelector('.main-menu .version-notes'); const rect = node.getBoundingClientRect(); return { text: node.textContent, inViewport: rect.top >= 0 && rect.bottom <= innerHeight, overflow: document.documentElement.scrollHeight - innerHeight }; })()`);
    assert.ok(versionNotes.text.includes("历史事件与意识形态选择") && versionNotes.text.includes("兼容旧版局内存档与局外档案"), "version notes must name the material systems and compatibility promise");
    assert.equal(versionNotes.inViewport, true, "expanded version notes must remain inside the 1920x1080 landing viewport");
    assert.ok(versionNotes.overflow <= 1, "expanded version notes must not create landing-page scrolling");
    await evaluate("document.querySelector('.main-menu .version-notes').open = false");
    await clickText(".main-menu-actions button", "作战任务");
    await waitSelector(".mission-drawer");
    assert.equal(await evaluate("document.querySelectorAll('.mission-list article').length"), 17, "the main menu must expose base and historical mechanism-learning missions");
    assert.ok((await evaluate("document.querySelector('.mission-drawer')?.textContent ?? ''")).includes("当前版本不锁棋子"), "missions must state that the full roster remains available");
    assert.equal(await exists(".historical-archive-summary"), true, "the mission drawer must expose the migrated historical profile without opening a second progression system");
    await capture("main-menu-missions-1920x1080.png");
    await click(".mission-drawer header button");
    await reset();
    await click(".shop-card:not(.shop-card--empty)");
    const manualSnapshot = await evaluate(`(() => ({ gold: Number(document.querySelector('.top-info-control button b')?.textContent.match(/\\d+/)?.[0]), pieces: document.querySelectorAll('.unit-card').length }))()`);
    assert.ok(manualSnapshot.pieces > 0, "manual-save recovery needs a state visibly different from a new run");
    await click(".settings-button");
    await clickText(".settings-actions button", "手动存档");
    const manualPayload = await evaluate("localStorage.getItem('idea-garrison-v01-save-v6:manual')");
    assert.ok(manualPayload?.includes('"pieces"'), "manual save must occupy its independent stable slot");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await clickText(".developer-actions button", "清空存档");
    const resetObservation = await evaluate(`(() => ({ notice: document.querySelector('.status-notice')?.textContent ?? '', pieces: document.querySelectorAll('.unit-card').length, settingsOpen: Boolean(document.querySelector('.settings-dialog')), manualPresent: Boolean(localStorage.getItem('idea-garrison-v01-save-v6:manual')) }))()`);
    assert.equal(resetObservation.notice.includes("手动存档仍可读取"), true, `whole-run reset must confirm the retained manual slot: ${JSON.stringify(resetObservation)}`);
    assert.equal(resetObservation.pieces, 0, "whole-run reset must clear the active roster");
    assert.equal(await evaluate("localStorage.getItem('idea-garrison-v01-save-v6:manual')"), manualPayload, "whole-run reset must preserve the independent manual slot byte-for-byte");
    await clickText(".settings-actions button", "读取手动存档");
    await waitFor(() => evaluate(`document.querySelectorAll('.unit-card').length === ${manualSnapshot.pieces}`), "manual roster to restore after whole-run reset");
    const restoredManual = await evaluate(`(() => ({ gold: Number(document.querySelector('.top-info-control button b')?.textContent.match(/\\d+/)?.[0]), pieces: document.querySelectorAll('.unit-card').length, notice: document.querySelector('.status-notice')?.textContent ?? '' }))()`);
    assert.deepEqual(restoredManual, { ...manualSnapshot, notice: "已读取手动存档，并安全返回准备阶段。" }, "manual load must restore the saved economy and roster after a whole-run reset");
    const beforeImport = await evaluate("localStorage.getItem('idea-garrison-v01-save-v6')");
    await evaluate(`(() => { const input = document.querySelector('.save-transfer-input'); const transfer = new DataTransfer(); transfer.items.add(new File(['not-json'], 'broken.json', { type: 'application/json' })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(() => evaluate("document.querySelector('.status-notice')?.textContent.includes('导入失败')"), "invalid imported save rejection");
    assert.equal(await evaluate("localStorage.getItem('idea-garrison-v01-save-v6')"), beforeImport, "invalid imported save must not overwrite the existing run");
    const importedGold = manualSnapshot.gold === 17 ? 18 : 17;
    const portablePayload = JSON.stringify({ format: "philosophy-auto-chess-save", formatVersion: 1, gameVersion: "v0.2", game: { ...JSON.parse(beforeImport), gold: importedGold } });
    await evaluate(`(() => { const input = document.querySelector('.save-transfer-input'); const transfer = new DataTransfer(); transfer.items.add(new File([${JSON.stringify(portablePayload)}], 'portable-save.json', { type: 'application/json' })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(() => evaluate(`document.querySelector('.top-info-control button b')?.textContent.includes('${importedGold}')`), "validated portable save import");
    assert.equal(await evaluate("Boolean(localStorage.getItem('idea-garrison-v01-save-v6:pre-import'))"), true, "a successful import must retain a recovery backup");
    await clickText(".settings-actions button", "恢复导入前备份");
    await waitFor(() => evaluate(`document.querySelector('.top-info-control button b')?.textContent.includes('${manualSnapshot.gold}')`), "pre-import backup restoration");
    await reset();
    await click(".settings-button");
    await waitSelector(".audio-settings");
    assert.equal(await evaluate(`document.querySelectorAll('.audio-settings input[type="range"]').length`), 2, "settings must expose independent music and effect volume controls");
    const audioLayout = await evaluate(`(() => { const panel = document.querySelector('.audio-settings').getBoundingClientRect(); const button = document.querySelector('.audio-settings>header button'); const rect = button.getBoundingClientRect(); const outputs = [...document.querySelectorAll('.audio-settings output')].map((node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, clipped: node.scrollWidth > node.clientWidth + 1 }; }); return { panelLeft: panel.left, panelRight: panel.right, buttonWidth: rect.width, buttonHeight: rect.height, buttonInside: rect.left >= panel.left && rect.right <= panel.right, buttonClipped: button.scrollWidth > button.clientWidth + 1, outputs }; })()`);
    assert.ok(audioLayout.buttonWidth >= 68 && audioLayout.buttonHeight <= 36 && audioLayout.buttonInside && !audioLayout.buttonClipped, `audio mute control must remain horizontal and inside its panel: ${JSON.stringify(audioLayout)}`);
    assert.ok(audioLayout.outputs.every((output) => !output.clipped && output.left >= audioLayout.panelLeft && output.right <= audioLayout.panelRight), `audio percentages must remain readable and inside the panel: ${JSON.stringify(audioLayout)}`);
    await capture("audio-settings-1920x1080.png");
    await setValue('.audio-settings input[aria-label="音乐音量"]', 27);
    await setValue('.audio-settings input[aria-label="音效音量"]', 41);
    await click(".audio-settings header button");
    const storedAudio = await evaluate(`(() => { const raw = localStorage.getItem('philosophy-auto-chess-audio-v1'); return raw ? JSON.parse(raw) : null; })()`);
    assert.deepEqual(storedAudio, { version: 2, musicVolume: .27, effectsVolume: .41, muted: true }, "music, effects and mute must persist independently of the run save");
    await click(".settings-button");
    await cdp.call("Page.reload", { ignoreCache: true });
    await waitFor(() => existsAny(".landing .primary", ".game-shell"), "refresh recovery landing");
    if (await exists(".landing .primary")) { await waitHydrated(); await clickText(".main-menu-actions button", "继续征程"); }
    await waitSelector(".game-shell");
    await click(".settings-button");
    const restoredAudio = await evaluate(`(() => { const music = document.querySelector('.audio-settings input[aria-label="音乐音量"]'); const effects = document.querySelector('.audio-settings input[aria-label="音效音量"]'); const button = document.querySelector('.audio-settings header button'); return { musicVolume: Number(music?.value), effectsVolume: Number(effects?.value), muted: button?.getAttribute('aria-pressed') === 'true' }; })()`);
    assert.deepEqual(restoredAudio, { musicVolume: 27, effectsVolume: 41, muted: true }, "refresh must restore V7 gameplay and independent music/effect settings");
    await click(".settings-button");

    const singleScreen = await evaluate(`(() => { const dock = document.querySelector('.economy-deck').getBoundingClientRect(); const map = document.querySelector('.map-field').getBoundingClientRect(); const mapPanel = document.querySelector('.map-panel').getBoundingClientRect(); const topbar = document.querySelector('.topbar').getBoundingClientRect(); const intel = document.querySelector('.board-grid>.economy'); const coreBar = document.querySelector('.top-core-resource>em>i').getBoundingClientRect(); const resonance = document.querySelector('.resonance-rail').getBoundingClientRect(); const telemetry = document.querySelector('.telemetry-rail').getBoundingClientRect(); const quickWave = document.querySelector('.quick-wave'); const clippedShopLabels = [...document.querySelectorAll('.shop-card h3,.shop-card .shop-meta,.shop-card .shop-skill>small')].filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent.trim()); const clippedResonances = [...document.querySelectorAll('.resonance-rail button b')].filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent.trim()); return { dockPosition: getComputedStyle(document.querySelector('.economy-deck')).position, dockTop: dock.top, dockBottom: dock.bottom, mapWidth: map.width, mapHeight: map.height, mapBottom: map.bottom, topToBoardGap: mapPanel.top - topbar.bottom, dockOverlap: Math.max(0, map.bottom - dock.top), topbarTop: topbar.top, topbarBottom: topbar.bottom, topbarHeight: topbar.height, dockOverMap: dock.bottom > map.top && dock.top < map.bottom, dockBelowTopbar: dock.top >= topbar.bottom, topbarVisible: topbar.top >= 0 && topbar.bottom <= innerHeight, collapsedIntelDisplay: getComputedStyle(intel).display, hasEdgeToggle: Boolean(intel.querySelector('.panel-edge-toggle')), coreBarWidth: coreBar.width, coreWidth: document.querySelector('.top-core-resource').getBoundingClientRect().width, telemetryDisplay: getComputedStyle(document.querySelector('.telemetry-rail')).display, sideRailWidth: resonance.width, sideRailDelta: Math.abs(resonance.width - telemetry.width), sideCopySize: parseFloat(getComputedStyle(document.querySelector('.telemetry-rail p')).fontSize), shopCopySize: parseFloat(getComputedStyle(document.querySelector('.shop-skill-summary')).fontSize), clippedShopLabels, clippedResonances, scrollY, verticalOverflow: document.documentElement.scrollHeight - innerHeight, hudCount: document.querySelectorAll('.top-info-control').length, quickWave: Boolean(quickWave), quickWaveWidth: quickWave?.getBoundingClientRect().width, quickWaveFont: quickWave ? parseFloat(getComputedStyle(quickWave).fontSize) : 0, hasIntelButton: [...document.querySelectorAll('.window-switches>button')].some((button) => button.textContent.trim() === '情报') }; })()`);
    assert.equal(singleScreen.dockPosition, "fixed", "reserve and shop must share one floating lower drawer");
    assert.equal(singleScreen.dockOverMap, true, "the unified operation drawer may overlap the battlefield edge");
    assert.ok(singleScreen.dockOverlap <= 220, `the operation drawer may cover only the lower battlefield band: ${JSON.stringify(singleScreen)}`);
    assert.ok(singleScreen.mapWidth >= 1200 && singleScreen.mapWidth <= 1450 && Math.abs(singleScreen.mapWidth / singleScreen.mapHeight - 16 / 9) < .02, `the desktop battlefield should yield measured space to readable HUD copy while preserving coordinates: ${JSON.stringify(singleScreen)}`);
    assert.equal(singleScreen.topbarVisible, true, "entering gameplay must reset stale landing-page scroll and keep the top bar visible");
    assert.equal(singleScreen.dockBelowTopbar, true, "the preparation dock must stay below the persistent top bar");
    assert.ok(singleScreen.scrollY <= 1, "the single-screen game shell must start at the top of the viewport");
    assert.ok(singleScreen.verticalOverflow <= 1, "1920x1080 gameplay must fit one viewport without browser scrolling");
    assert.equal(singleScreen.hudCount, 3, "gold, population/progression and wave must remain visible beside the dedicated philosopher-stone display");
    assert.equal(singleScreen.hasIntelButton, false, "the redundant intel window button must be removed from the top bar");
    assert.equal(singleScreen.quickWave, true, "starting a wave must remain available outside the optional intel panel");
    assert.ok(singleScreen.quickWaveWidth >= 124 && singleScreen.quickWaveFont >= 17, "start wave must remain the most prominent top action");
    assert.equal(singleScreen.collapsedIntelDisplay, "none", "collapsed intel must return its width to the battlefield instead of leaving a right-edge tab");
    assert.equal(singleScreen.hasEdgeToggle, false, "the top-bar intel button must be the only intel window control");
    assert.ok(singleScreen.coreBarWidth > 0, "the philosopher stone must keep a persistent health bar in the top HUD");
    assert.ok(singleScreen.coreWidth >= 168, "the top philosopher-stone display must retain the original emblem, label, wide bar and numeric treatment");
    assert.notEqual(singleScreen.telemetryDisplay, "none", "collapsed detailed intel must expose the compact battle telemetry rail instead of blank space");
    assert.ok(singleScreen.topbarHeight >= 84, "the persistent status bar must gain enough height for larger copy");
    assert.ok(singleScreen.topToBoardGap <= 28, `the status strip must not leave expensive dead space above the battlefield: ${JSON.stringify(singleScreen)}`);
    assert.ok(singleScreen.sideRailWidth >= 190, "the side rails must use the space yielded by the battlefield");
    assert.ok(singleScreen.sideRailDelta <= 2, "resonance and compact battle telemetry must form a symmetric pair of side rails");
    assert.ok(singleScreen.sideCopySize >= 12, "resonance and telemetry detail must remain legible at normal viewing distance");
    assert.ok(singleScreen.shopCopySize >= 10, "shop skill summaries must receive the same readability increase as persistent HUD copy");
    assert.deepEqual(singleScreen.clippedShopLabels, [], `primary shop labels must not be clipped after scaling: ${JSON.stringify(singleScreen.clippedShopLabels)}`);
    assert.deepEqual(singleScreen.clippedResonances, [], `resonance names must not be replaced by ellipses: ${JSON.stringify(singleScreen.clippedResonances)}`);
    await capture("preparation-floating-shop-1920x1080.png");

    await click(".historical-quick-guide>summary");
    const historyGuide = await evaluate(`(() => { const panel = document.querySelector('.historical-quick-guide-panel'); const summary = document.querySelector('.historical-quick-guide>summary'); const rect = panel?.getBoundingClientRect(); const anchor = summary?.getBoundingClientRect(); return { text: panel?.textContent ?? '', visible: Boolean(rect && rect.width > 0 && rect.height > 0), inside: Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight), anchorGap: rect && anchor ? rect.top - anchor.bottom : null, rightDelta: rect && anchor ? Math.abs(rect.right - anchor.right) : null, verticalOverflow: document.documentElement.scrollHeight - innerHeight }; })()`);
    assert.equal(historyGuide.visible, true, "the compact history help must open without a blocking decision modal");
    assert.equal(historyGuide.inside, true, `history help must stay inside the viewport: ${JSON.stringify(historyGuide)}`);
    assert.ok(historyGuide.anchorGap >= 4 && historyGuide.anchorGap <= 12 && historyGuide.rightDelta <= 1, `history help must sit directly below its own summary control: ${JSON.stringify(historyGuide)}`);
    assert.ok(historyGuide.text.includes("本局历史事件 · W3") && historyGuide.text.includes("尚未揭示") && historyGuide.text.includes("本局意识形态 · W6") && historyGuide.text.includes("尚未选择"), "a fresh run must show only its unresolved history milestones");
    for (const unrelatedEntry of ["工业革命", "改良主义", "自由主义", "世界大战", "五月风暴"]) {
      assert.equal(historyGuide.text.includes(unrelatedEntry), false, `a fresh run must not present ${unrelatedEntry} as if it happened`);
    }
    assert.ok(historyGuide.verticalOverflow <= 1, "opening history help must overlay instead of extending the game shell");
    await click(".historical-quick-guide>summary");

    await click(".core-health-control>.top-core-resource");
    const untouchedCoreLedger = await evaluate(`(() => { const ledger = document.querySelector('.core-damage-ledger'); const health = document.querySelector('.top-core-resource').getBoundingClientRect(); const rect = ledger?.getBoundingClientRect(); return { text: ledger?.textContent ?? '', rows: ledger?.querySelectorAll('[data-core-damage-source]').length ?? 0, inside: Boolean(rect && rect.left >= 0 && rect.top >= health.bottom && rect.right <= innerWidth && rect.bottom <= innerHeight), expanded: document.querySelector('.top-core-resource')?.getAttribute('aria-expanded') }; })()`);
    assert.ok(untouchedCoreLedger.text.includes("本局尚未受到核心损伤") && untouchedCoreLedger.rows === 0, "an untouched core must explain that no enemy has damaged it");
    assert.equal(untouchedCoreLedger.inside && untouchedCoreLedger.expanded === "true", true, `the clickable health ledger must open below the health bar and stay in view: ${JSON.stringify(untouchedCoreLedger)}`);
    await click(".core-health-control>.top-core-resource");

    await click(".top-info-control:first-child>button");
    const economyHelp = await evaluate(`(() => ({ text: document.querySelector('.economy-breakdown')?.textContent ?? '', fontSize: parseFloat(getComputedStyle(document.querySelector('.economy-breakdown>small')).fontSize) }))()`);
    assert.ok(economyHelp.text.includes("基础收入") && economyHelp.text.includes("利息"), "clicking gold must explain base income and interest at the value source");
    assert.ok(economyHelp.fontSize >= 11, "top information explanations must remain readable");
    await click(".population-info>button");
    assert.ok((await evaluate("document.querySelector('.progression-breakdown')?.textContent ?? ''")).includes("等级决定人口上限"), "population must explain level and experience together");
    await click(".wave-info>button");
    assert.equal(await exists(".wave-breakdown .lane-forecast"), true, "clicking wave must expose concrete enemies and routes");
    await click(".wave-info>button");

    await applyLineup("socrates,plato,aristotle,epicurus", 0, "socrates,plato,aristotle,epicurus");
    await waitSelector('.unit-avatar img[src^="/assets/characters/"]');
    if (await exists(".decision-card-grid button")) await click(".decision-card-grid button");
    if (await exists(".resonance-popup-layer")) await click(".resonance-popup-layer");
    await click('.map-field [data-character-id="socrates"]');
    await waitSelector(".map-inspector");
    const unitInspector = await evaluate(`(() => { const panel = document.querySelector('.map-inspector'); const map = document.querySelector('.map-field'); const dock = document.querySelector('.economy-deck'); const panelRect = panel.getBoundingClientRect(); const mapRect = map.getBoundingClientRect(); const dockRect = dock.getBoundingClientRect(); const skill = panel.querySelector('.battle-inspector p'); const title = panel.querySelector('.inspector-title strong'); return { text: panel.textContent ?? '', width: panelRect.width, skillFont: parseFloat(getComputedStyle(skill).fontSize), titleFont: parseFloat(getComputedStyle(title).fontSize), top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom, mapTop: mapRect.top, mapRight: mapRect.right, mapBottom: mapRect.bottom, dockTop: dockRect.top, overflow: panel.scrollHeight - panel.clientHeight }; })()`);
    assert.ok(unitInspector.text.includes("1 费"), `map unit details must show the canonical character cost: ${JSON.stringify(unitInspector)}`);
    assert.ok(unitInspector.text.includes("反诘") && unitInspector.text.includes("降低最近威胁敌人的能量"), `map unit details must retain the concrete skill effect: ${JSON.stringify(unitInspector)}`);
    assert.ok(unitInspector.width >= 280 && unitInspector.skillFont >= 12 && unitInspector.titleFont >= 15, `map unit details must use the enlarged readable card and copy scale: ${JSON.stringify(unitInspector)}`);
    assert.ok(unitInspector.top >= unitInspector.mapTop && unitInspector.right <= unitInspector.mapRight + 1 && unitInspector.bottom <= Math.min(unitInspector.mapBottom, unitInspector.dockTop) + 1, `map unit details must stay fully above the floating operation dock: ${JSON.stringify(unitInspector)}`);
    assert.ok(unitInspector.overflow <= 1, `map unit details must expose the full effect without internal clipping: ${JSON.stringify(unitInspector)}`);
    await capture("map-unit-inspector-1920x1080.png");
    await click(".game-shell");
    const greekPortraits = await evaluate(`(() => { const mapImages = [...document.querySelectorAll('.map-field [data-character-id] .unit-avatar img')]; const shopImages = [...document.querySelectorAll('.shop-card .portrait img')]; const summarize = (images) => images.map((image) => { const rect = image.getBoundingClientRect(); const frame = image.parentElement; const frameRect = frame.getBoundingClientRect(); return { source: image.getAttribute('src'), complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: rect.width, height: rect.height, frameWidth: frameRect.width, frameHeight: frameRect.height, computedFrameWidth: getComputedStyle(frame).width, pointerEvents: getComputedStyle(image).pointerEvents }; }); const mapCards = [...document.querySelectorAll('.map-field [data-character-id].unit-card')].map((card) => card.getBoundingClientRect()).map(({ left, top, right, bottom }) => ({ left, top, right, bottom })); const overlaps = mapCards.some((first, index) => mapCards.slice(index + 1).some((second) => first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top)); const gauges = [...document.querySelectorAll('.map-field [data-character-id].unit-card')].map((card) => { const energy = card.querySelector('.unit-energy'); return { gaugeCount: card.querySelectorAll('.unit-gauges>i').length, energyDisplay: energy ? getComputedStyle(energy).display : 'missing', cardBorder: getComputedStyle(card).borderTopWidth, cardBackground: getComputedStyle(card).backgroundImage }; }); return { map: summarize(mapImages), shop: summarize(shopImages), overlaps, gauges, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, draggableCards: [...document.querySelectorAll('.map-field [data-character-id].unit-card')].every((card) => card.draggable) }; })()`);
    assert.equal(greekPortraits.map.length, 4, "all four approved Greek portraits must render on battlefield pieces");
    assert.equal(greekPortraits.shop.length, 4, "all four approved Greek portraits must render in the configured shop");
    for (const portrait of [...greekPortraits.map, ...greekPortraits.shop]) {
      assert.equal(portrait.complete, true, `portrait must finish loading: ${portrait.source}`);
      assert.equal(portrait.naturalWidth, 512, `portrait must use the production 512px crop: ${portrait.source}`);
      assert.equal(portrait.naturalHeight, 512, `portrait must remain square: ${portrait.source}`);
      assert.equal(portrait.pointerEvents, "none", `portrait pixels must not steal drag or click input: ${portrait.source}`);
    }
    const mapPortraitWidths = greekPortraits.map.map(({ width }) => width);
    const mapPortraitHeights = greekPortraits.map.map(({ height }) => height);
    assert.ok(Math.max(...mapPortraitWidths) - Math.min(...mapPortraitWidths) < 0.01 && Math.max(...mapPortraitHeights) - Math.min(...mapPortraitHeights) < 0.01, `all Greek battlefield pentagons must use one visual size: ${JSON.stringify(greekPortraits.map)}`);
    assert.ok(greekPortraits.map.every(({ width, height }) => width >= 60 && height >= 60), `battlefield portraits must show more than a face-only thumbnail: ${JSON.stringify(greekPortraits.map)}`);
    assert.equal(greekPortraits.overlaps, false, "larger battlefield pieces must not overlap at the approved deployment anchors");
    assert.equal(greekPortraits.draggableCards, true, "portrait integration must preserve draggable unit-card owners");
    assert.ok(greekPortraits.gauges.every(({ gaugeCount, energyDisplay, cardBorder, cardBackground }) => gaugeCount === 2 && energyDisplay !== "none" && Number.parseFloat(cardBorder) >= 1 && cardBackground !== "none"), `pieces must retain two readable gauges and a square card frame: ${JSON.stringify(greekPortraits.gauges)}`);
    await click('.shop-card:not(.shop-card--empty)');
    await waitSelector('.bench .unit-avatar img[src^="/assets/characters/"]');
    const benchPortrait = await evaluate(`(() => { const avatar = document.querySelector('.bench .unit-avatar'); const card = document.querySelector('.bench .unit-card'); const avatarRect = avatar.getBoundingClientRect(); const cardRect = card.getBoundingClientRect(); return { avatarWidth: avatarRect.width, avatarHeight: avatarRect.height, cardWidth: cardRect.width, cardHeight: cardRect.height, draggable: card.draggable }; })()`);
    assert.ok(benchPortrait.avatarWidth >= 52 && benchPortrait.avatarHeight >= 52, `reserve portraits must preserve the complete framed composition: ${JSON.stringify(benchPortrait)}`);
    assert.ok(benchPortrait.cardWidth >= 58 && benchPortrait.cardHeight >= 78, `reserve pieces must provide enough visual area without changing their slot: ${JSON.stringify(benchPortrait)}`);
    assert.equal(benchPortrait.draggable, true, "larger reserve art must preserve drag ownership");
    const unifiedPieceGeometry = await evaluate(`(() => {
      const rect = (node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      const deck = document.querySelector('.economy-deck');
      const bench = document.querySelector('.economy-deck>.bench');
      const shop = document.querySelector('.economy-deck>.shop');
      const shopContent = shop?.querySelector('.shop-content');
      const cardRows = [...document.querySelectorAll('.map-field .unit-card,.economy-deck>.bench .unit-card')].map((card) => {
        const name = card.querySelector('.unit-name');
        const gauges = card.querySelector('.unit-gauges');
        const avatar = card.querySelector('.unit-avatar');
        return { card: rect(card), name: rect(name), gauges: rect(gauges), avatar: rect(avatar) };
      });
      const shopChildren = [...shop.querySelectorAll('.shop-card-slot,.shop-actions')].map(rect);
      return {
        deck: rect(deck),
        bench: rect(bench),
        shop: rect(shop),
        shopContent: rect(shopContent),
        shopChildren,
        cardRows,
      };
    })()`);
    assert.ok(Math.abs(unifiedPieceGeometry.bench.bottom - unifiedPieceGeometry.shop.bottom) <= 0.5, `reserve and market must share one bottom edge: ${JSON.stringify(unifiedPieceGeometry)}`);
    assert.ok(unifiedPieceGeometry.bench.bottom <= unifiedPieceGeometry.deck.bottom + 0.5 && unifiedPieceGeometry.shop.bottom <= unifiedPieceGeometry.deck.bottom + 0.5, `both operation panels must remain inside their outer frame: ${JSON.stringify(unifiedPieceGeometry)}`);
    assert.ok(unifiedPieceGeometry.shopContent.bottom <= unifiedPieceGeometry.shop.bottom + 0.5 && unifiedPieceGeometry.shopChildren.every(({ bottom }) => bottom <= unifiedPieceGeometry.shop.bottom + 0.5), `market cards and actions must not breach the market frame: ${JSON.stringify(unifiedPieceGeometry)}`);
    assert.ok(unifiedPieceGeometry.cardRows.length >= 5, `the model check needs battlefield and reserve pieces: ${JSON.stringify(unifiedPieceGeometry)}`);
    assert.ok(unifiedPieceGeometry.cardRows.every(({ card, avatar }) => Math.abs(card.width - unifiedPieceGeometry.cardRows[0].card.width) <= 0.5 && Math.abs(card.height - unifiedPieceGeometry.cardRows[0].card.height) <= 0.5 && Math.abs(avatar.width - unifiedPieceGeometry.cardRows[0].avatar.width) <= 0.5 && Math.abs(avatar.height - unifiedPieceGeometry.cardRows[0].avatar.height) <= 0.5), `battlefield and reserve pieces must use one card and portrait model: ${JSON.stringify(unifiedPieceGeometry.cardRows)}`);
    assert.ok(unifiedPieceGeometry.cardRows.every(({ card, name, gauges }) => name.bottom <= gauges.top + 0.5 && gauges.bottom <= card.bottom + 0.5), `piece names and health/energy tracks must occupy separate rows inside the card: ${JSON.stringify(unifiedPieceGeometry.cardRows)}`);
    await capture("greek-portraits-map-shop-1920x1080.png");
    await reset();

    await applyLineup("descartes,rousseau,sartre,foucault,althusser,deleuze,derrida,lacan", 0, "descartes,rousseau,sartre,foucault,althusser");
    await waitFor(async () => (await evaluate("document.querySelectorAll('.map-field [data-character-id] .unit-avatar img[src^=\"/assets/characters/\"]').length")) === 8, "all eight French portraits on the battlefield");
    const frenchPortraits = await evaluate(`(() => { const mapImages = [...document.querySelectorAll('.map-field [data-character-id] .unit-avatar img[src^="/assets/characters/"]')]; const shopImages = [...document.querySelectorAll('.shop-card .portrait img[src^="/assets/characters/"]')]; const summarize = (images) => images.map((image) => { const rect = image.getBoundingClientRect(); const card = image.closest('.unit-card,.shop-card'); const cardRect = card?.getBoundingClientRect(); return { source: image.getAttribute('src'), complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: rect.width, height: rect.height, cardWidth: cardRect?.width ?? 0, cardHeight: cardRect?.height ?? 0, pointerEvents: getComputedStyle(image).pointerEvents }; }); const mapCards = [...document.querySelectorAll('.map-field [data-character-id].unit-card')].map((card) => card.getBoundingClientRect()).map(({ left, top, right, bottom }) => ({ left, top, right, bottom })); const overlaps = mapCards.some((first, index) => mapCards.slice(index + 1).some((second) => first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top)); const gauges = [...document.querySelectorAll('.map-field [data-character-id].unit-card')].map((card) => ({ gaugeCount: card.querySelectorAll('.unit-gauges>i').length, cardBorder: getComputedStyle(card).borderTopWidth, cardBackground: getComputedStyle(card).backgroundImage })); return { map: summarize(mapImages), shop: summarize(shopImages), overlaps, gauges, draggableCards: [...document.querySelectorAll('.map-field [data-character-id].unit-card')].every((card) => card.draggable) }; })()`);
    assert.equal(frenchPortraits.map.length, 8, "all eight French portraits must render on battlefield pieces");
    assert.equal(frenchPortraits.shop.length, 5, "configured French shop portraits must render in all visible shop slots");
    for (const portrait of [...frenchPortraits.map, ...frenchPortraits.shop]) {
      assert.equal(portrait.complete, true, `French portrait must finish loading: ${portrait.source}`);
      assert.equal(portrait.naturalWidth, 512, `French portrait must use the production 512px canvas: ${portrait.source}`);
      assert.equal(portrait.naturalHeight, 512, `French portrait must remain square: ${portrait.source}`);
      assert.equal(portrait.pointerEvents, "none", `French portrait pixels must not steal drag or click input: ${portrait.source}`);
    }
    const frenchMapWidths = frenchPortraits.map.map(({ width }) => width);
    const frenchMapHeights = frenchPortraits.map.map(({ height }) => height);
    assert.ok(Math.max(...frenchMapWidths) - Math.min(...frenchMapWidths) < 0.01 && Math.max(...frenchMapHeights) - Math.min(...frenchMapHeights) < 0.01, `all French battlefield pentagons must use one visual size: ${JSON.stringify(frenchPortraits.map)}`);
    assert.ok(frenchPortraits.map.every(({ width, height }) => width >= 60 && height >= 60), `French battlefield portraits must show the complete framed composition: ${JSON.stringify(frenchPortraits.map)}`);
    assert.equal(frenchPortraits.overlaps, false, "larger French pieces must not overlap at the approved deployment anchors");
    assert.equal(frenchPortraits.draggableCards, true, "French portrait integration must preserve draggable unit-card owners");
    assert.ok(frenchPortraits.gauges.every(({ gaugeCount, cardBorder, cardBackground }) => gaugeCount === 2 && Number.parseFloat(cardBorder) >= 1 && cardBackground !== "none"), `French pieces must retain two readable gauges and a square card frame: ${JSON.stringify(frenchPortraits.gauges)}`);
    await click('.shop-card:not(.shop-card--empty)');
    await waitSelector('.bench .unit-avatar img[src^="/assets/characters/"]');
    const frenchBenchPortrait = await evaluate(`(() => { const image = document.querySelector('.bench .unit-avatar img[src^="/assets/characters/"]'); const card = image?.closest('.unit-card'); const imageRect = image?.getBoundingClientRect(); const cardRect = card?.getBoundingClientRect(); return { source: image?.getAttribute('src'), width: imageRect?.width ?? 0, height: imageRect?.height ?? 0, cardWidth: cardRect?.width ?? 0, cardHeight: cardRect?.height ?? 0, draggable: Boolean(card?.draggable) }; })()`);
    assert.ok(frenchBenchPortrait.source?.includes('/assets/characters/'), `French bench portrait must retain a stable resource id: ${JSON.stringify(frenchBenchPortrait)}`);
    assert.ok(frenchBenchPortrait.width >= 52 && frenchBenchPortrait.height >= 52 && frenchBenchPortrait.cardWidth >= 58 && frenchBenchPortrait.cardHeight >= 78, `French reserve portraits must preserve the complete framed composition: ${JSON.stringify(frenchBenchPortrait)}`);
    assert.equal(frenchBenchPortrait.draggable, true, "French reserve art must preserve drag ownership");
    await capture("french-portraits-map-shop-1920x1080.png");
    await reset();

    const openingExperience = await evaluate(`(() => { const button = document.querySelector('.shop-actions button:first-child'); return { disabled: button?.disabled, text: button?.textContent }; })()`);
    assert.equal(openingExperience.disabled, true, "experience purchase must stay locked during the teaching wave");
    assert.ok(openingExperience.text?.includes("W2"), "the experience control must explain when it unlocks");

    const readGold = "Number(document.querySelector('.top-info-control:first-child>button b')?.textContent.replace(/\\D/g, '') ?? 0)";
    const initialGold = await evaluate(readGold);
    if (!(await exists(".shop-card:not(.shop-card--empty)"))) await clickText(".economy-dock-tabs button", "备战与商店");
    await click(".shop-card:not(.shop-card--empty)");
    await waitSelector('.bench .unit-card');
    const purchasedGold = await evaluate(readGold);
    assert.ok(purchasedGold < initialGold, "purchase must spend gold");

    const openingDeploySlot = await evaluate("document.querySelector('.bench .slot.terrain-highland') ? 'deploy-13' : 'deploy-1'");
    await click('.bench .unit-card');
    await click(`[data-slot="${openingDeploySlot}"]`);
    await waitSelector(`[data-slot="${openingDeploySlot}"] .unit-card`);
    await click(`[data-slot="${openingDeploySlot}"] .unit-card`);
    await waitSelector('[data-slot="bench-1"]');
    await click('[data-slot="bench-1"]');
    await waitSelector('[data-slot="bench-1"] .unit-card');
    await click('[data-slot="bench-1"] .unit-card');
    await click(`[data-slot="${openingDeploySlot}"]`);

    await evaluate(`(() => { const source = document.querySelector('[data-slot="${openingDeploySlot}"] .unit-card'); const transfer = new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer })); window.__ideaDragData = transfer; })()`);
    await waitSelector(".shop--sell-target");
    const placementGuidance = await evaluate(`(() => { const slots = [...document.querySelectorAll('.map-field.is-dragging .deploy-grid>.slot.drop-allowed')]; const emptySlot = document.querySelector('.map-field.is-dragging .deploy-grid>.slot.drop-allowed:not(.occupied)'); const marker = emptySlot && getComputedStyle(emptySlot, '::before'); const gridMarker = document.querySelector('.operation-grid .map-tile.drop-allowed'); const art = getComputedStyle(document.querySelector('.map-art')); return { count: slots.length, display: marker?.display, borderWidth: marker?.borderTopWidth, gridOpacity: gridMarker ? getComputedStyle(gridMarker).opacity : '0', background: art.backgroundImage, filter: art.filter }; })()`);
    assert.ok(placementGuidance.count >= 8, "dragging must expose every legal frozen deployment anchor");
    assert.equal(placementGuidance.display, "block", "legal deployment anchors need a visible marker");
    assert.equal(placementGuidance.borderWidth, "1px", "placement guidance should use a restrained metallic mask rather than an oversized glow");
    assert.equal(placementGuidance.gridOpacity, "0", "the imprecise 16x10 placement overlay must stay hidden");
    assert.match(placementGuidance.background, /philosophy-map-final-v1/, "the supplied final map must be the active battlefield paint layer");
    assert.match(placementGuidance.filter, /brightness\(0\.56\)/, "dragging must dim the painted map beneath legal placement anchors");
    await capture("placement-highlight-1920x1080.png");
    await evaluate(`(() => { const target = document.querySelector('.shop--sell-target'); const transfer = window.__ideaDragData; target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })); target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); })()`);
    await waitFor(async () => !(await exists(`[data-slot="${openingDeploySlot}"] .unit-card`)), "dragged unit to be sold");
    const soldGold = await evaluate(readGold);
    assert.ok(soldGold > purchasedGold, "selling any one-star piece must visibly add gold");

    if (!(await exists(".shop-card:not(.shop-card--empty)"))) await clickText(".economy-dock-tabs button", "备战与商店");
    await click(".shop-card:not(.shop-card--empty)");
    const secondDeploySlot = await evaluate("document.querySelector('.bench .slot.terrain-highland') ? 'deploy-13' : 'deploy-1'");
    await click(".bench .unit-card");
    await click(`[data-slot="${secondDeploySlot}"]`);
    await click(".quick-wave");
    await waitSelector(".wave-route-cue");
    assert.equal(await exists(".economy-deck.economy-deck-collapsed"), true, "starting combat must collapse reserve and shop as one drawer");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.economy-deck>.shop')).display"), "none", "the collapsed drawer hides the market body");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.economy-deck>.bench')).display"), "none", "the collapsed drawer hides the reserve body at the same time");
    const openingRouteCue = await evaluate(`(() => ({ label: document.querySelector('.wave-route-cue')?.textContent, routes: document.querySelectorAll('.route-signal').length, running: Boolean(document.querySelector('.tempo-controls')) }))()`);
    assert.ok(openingRouteCue.label?.includes("A 路") && openingRouteCue.label?.includes("B 路"), "the teaching wave must preview its two deterministic entrances");
    assert.equal(openingRouteCue.routes, 2, "route warning count must match the wave's round-robin spawn routes");
    assert.equal(openingRouteCue.running, false, "route warning must appear before the combat loop starts");
    await capture("wave-route-warning-1920x1080.png");
    await waitSelector(".quick-combat");
    await waitSelector(".wave-toast.expanded");
    const clearOverlay = await evaluate(`(() => { const overlay = document.querySelector('.wave-toast.expanded'); const rect = overlay?.getBoundingClientRect(); const map = document.querySelector('.map-field')?.getBoundingClientRect(); return { text: overlay?.textContent, width: rect?.width, height: rect?.height, mapWidth: map?.width, mapHeight: map?.height }; })()`);
    assert.ok(clearOverlay.text?.includes("第 1 波肃清"), "wave settlement must announce the cleared wave");
    assert.ok(Math.abs(clearOverlay.width - clearOverlay.mapWidth) <= 2 && Math.abs(clearOverlay.height - clearOverlay.mapHeight) <= 2, `wave settlement must cover the battlefield at the same size as the final victory sequence: ${JSON.stringify(clearOverlay)}`);
    await capture("wave-clear-overlay-1920x1080.png");
    await waitSelector(".wave-toast.collapsed");
    await waitSelector(".shop .shop-content");
    assert.equal(await exists(".shop.panel-collapsed"), false, "settlement and wave advance must reopen the updated shop");
    await click(".shop-actions button:first-child");
    await waitSelector(".shop-action-feedback.xp");
    assert.ok((await evaluate("document.querySelector('.shop-action-feedback.xp')?.textContent ?? ''")).includes("经验"), "buying experience must produce local visual feedback");
    await clickText(".shop-actions button", "刷新");
    assert.equal(await exists(".shop-grid.is-refreshing"), true, "refreshing must animate the replacement shop cards");
    assert.equal(await exists(".shop-action-feedback.refresh"), false, "refreshing must not add redundant floating copy");
    await delay(750);
    await click(".shop-actions .shop-freeze");
    assert.equal(await evaluate("document.querySelector('.shop-actions .shop-freeze').getAttribute('aria-pressed')"), "true", "the shop freeze control must expose its active state");
    assert.ok(await evaluate("(localStorage.getItem('idea-garrison-v01-save-v6') || '').includes('\\\"shopFrozen\\\":true')"), "shop freeze must persist through the engine save, not React-only state");
    await click(".shop-actions .shop-freeze");
    assert.equal(await evaluate("document.querySelector('.shop-actions .shop-freeze').getAttribute('aria-pressed')"), "false", "shop freeze must be reversible before combat");
    await capture("economy-feedback-1920x1080.png");

    await reset();
    await applyLineup("descartes,rousseau,sartre,foucault");
    await waitSelector(".decision-card-grid");
    await click(".decision-card-grid button:nth-child(2)");
    assert.equal(await evaluate("document.querySelectorAll('.map-choice-layer--revolution button.active').length"), 1, "France node choice must become visible on the map");
    await waitFor(async () => !(await exists(".resonance-popup-layer")), "France node choice to close after selection");
    await applyLineup("descartes,rousseau,sartre,foucault");
    await delay(400);
    assert.equal(await exists(".resonance-popup-layer"), false, "France node must not auto-prompt again during the same run");

    await reset();
    await applyLineup("locke,hume,hobbes,russell", 1);
    await waitSelector(".decision-card-grid");
    const researchDialogPosition = await evaluate(`(() => { const overlayNode = document.querySelector('.decision-overlay--research'); const dialog = overlayNode?.querySelector('.decision-cards')?.getBoundingClientRect(); const overlay = overlayNode?.getBoundingClientRect(); const style = overlayNode ? getComputedStyle(overlayNode) : null; return { top: dialog?.top, bottom: dialog?.bottom, center: dialog ? (dialog.top + dialog.bottom) / 2 : null, viewport: window.innerHeight, overlayHeight: overlay?.height, paddingTop: style?.paddingTop, paddingBottom: style?.paddingBottom, boxSizing: style?.boxSizing }; })()`);
    assert.ok(researchDialogPosition.center >= researchDialogPosition.viewport * .4 && researchDialogPosition.center <= researchDialogPosition.viewport * .48, `the research route dialog must sit just above the visual center: ${JSON.stringify(researchDialogPosition)}`);
    assert.ok(researchDialogPosition.bottom <= researchDialogPosition.viewport - 12, `the raised research route dialog must remain fully visible: ${JSON.stringify(researchDialogPosition)}`);
    await clickText(".decision-card-grid button", "医学");
    await waitFor(async () => (await evaluate("localStorage.getItem('idea-garrison-v01-save-v6') || ''")).includes("medicine"), "British research choice to persist");
    await waitFor(async () => !(await exists(".resonance-popup-layer")), "British research choice to return directly to the map");

    await reset();
    await applyLineup("rousseau,locke,hume,kant");
    await waitSelector(".decision-card-grid");
    await clickText(".decision-card-grid button", "公民");
    await waitFor(async () => (await evaluate("localStorage.getItem('idea-garrison-v01-save-v6') || ''")).includes("citizen"), "Enlightenment agenda to persist");
    await clickText(".decision-card-grid button", "教育");
    await waitFor(async () => !(await exists(".decision-overlay")), "Enlightenment 4 decision to close after two selections");

    await reset();
    await applyLineup("socrates,socrates");
    await delay(400);
    assert.equal(await exists(".resonance-popup-layer"), false, "two copies of Socrates must not activate the Greek choice prompt");
    const duplicateGreekHud = await evaluate(`[...document.querySelectorAll('.resonance-rail button')].find((button) => button.textContent.includes('古希腊'))?.textContent ?? ''`);
    assert.ok(duplicateGreekHud.includes("1/4"), "the Greek HUD must count duplicate Socrates copies as one distinct character");
    assert.equal(duplicateGreekHud.includes("2/4"), false, "duplicate character copies must not activate the Greek tier");

    await reset();
    await applyLineup("plato");
    assert.equal(await exists('[data-slot="throne-1"].locked'), true, "one-star Plato must leave the philosopher king throne locked");

    await reset();
    await applyLineup("socrates,plato@2");
    await waitSelector('.resonance-popup [aria-label="收起共鸣详情"]');
    assert.equal(await evaluate("document.querySelector('.resonance-popup').textContent.includes('piece-')"), false, "Greek rostrum UI must never expose internal piece ids");
    await clickText(".preparation-controls button", "苏格拉底");
    await waitFor(async () => (await evaluate("localStorage.getItem('idea-garrison-v01-save-v6') || ''")).includes('rostrumId'), "Greek rostrum choice to persist");
    await waitFor(async () => !(await exists(".resonance-popup-layer")), "Greek rostrum choice to close after selection");
    await applyLineup("socrates,plato@2");
    await delay(400);
    assert.equal(await exists(".resonance-popup-layer"), false, "Greek rostrum must not auto-prompt again during the same run");
    await waitSelector('[data-slot="throne-1"]');
    assert.equal(await exists('[data-slot="throne-1"].locked'), false, "deployed Plato must unlock the philosopher king throne");
    const dragPreview = await evaluate(`(() => { const source = document.querySelector('[data-character-id="socrates"]'); const transfer = new DataTransfer(); const original = transfer.setDragImage.bind(transfer); let args; transfer.setDragImage = (element, x, y) => { args = { x, y, width: element.offsetWidth, height: element.offsetHeight }; original(element, x, y); }; source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer })); window.__ideaThroneDrag = transfer; return args; })()`);
    assert.ok(Math.abs(dragPreview.x - dragPreview.width / 2) < .1 && Math.abs(dragPreview.y - dragPreview.height / 2) < .1, "the drag ghost hotspot must use the piece center so its preview matches the final anchor");
    await delay(180);
    await evaluate(`(() => { const target = document.querySelector('[data-slot="throne-1"]'); const transfer = window.__ideaThroneDrag; target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })); target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); })()`);
    await waitSelector('[data-slot="throne-1"] [data-character-id="socrates"]');
    const thronePresentation = await evaluate(`(() => { const map = document.querySelector('.map-field').getBoundingClientRect(); const throne = document.querySelector('[data-slot="throne-1"]'); const card = throne.querySelector('.unit-card'); const throneRect = throne.getBoundingClientRect(); const cardStyle = getComputedStyle(card); const crown = getComputedStyle(throne, '::before'); const expectedX = map.left + map.width * .94; const expectedY = map.top + map.height * .50; return { deltaX: Math.abs((throneRect.left + throneRect.width / 2) - expectedX), deltaY: Math.abs((throneRect.top + throneRect.height / 2) - expectedY), border: cardStyle.borderTopColor, crown: crown.content, crownDisplay: crown.display, buffCount: throne.querySelectorAll('.unit-buffs').length }; })()`);
    assert.ok(thronePresentation.deltaX <= 2 && thronePresentation.deltaY <= 2, "the philosopher king must occupy the exact center of the philosopher-stone star");
    assert.ok(thronePresentation.crown.includes("♛"), "a crown must identify the philosopher king directly");
    assert.equal(thronePresentation.crownDisplay, "block", "the philosopher king crown must not be hidden by generic slot CSS");
    assert.equal(thronePresentation.buffCount, 0, "tiny philosopher-king effect labels must not cover the piece");
    assert.equal(thronePresentation.border, "rgb(239, 209, 117)", "the philosopher king card itself must use a gold outline without a separate gold box");
    await waitFor(async () => (await evaluate("localStorage.getItem('idea-garrison-v01-save-v6') || ''")).includes('throne-1'), "philosopher king choice to persist");
    await click(".quick-wave");
    await waitSelector(".royal-barrier");
    await capture("philosopher-king-barrier-1920x1080.png");
    const royalBarrier = await evaluate(`(() => ({ king: document.querySelector('[data-slot="throne-1"] .unit-name strong')?.textContent?.trim(), label: document.querySelector('.royal-barrier b')?.textContent?.trim(), hp: document.querySelector('.royal-barrier')?.textContent }))()`);
    assert.equal(royalBarrier.king, "苏格拉底", "the chosen philosopher king must remain visibly seated during combat");
    assert.equal(royalBarrier.label, "王城屏障", "the wave must visibly create the royal barrier");
    assert.ok(royalBarrier.hp?.includes("耐久"), "the royal barrier must expose its durability");
    assert.ok(royalBarrier.hp?.includes("三路核心护罩"), "the barrier must explain that all routes share the same protection");
    const barrierGeometry = await evaluate(`(() => { const map = document.querySelector('.map-field').getBoundingClientRect(); const barrier = document.querySelector('.royal-barrier').getBoundingClientRect(); const shield = document.querySelector('.royal-barrier-shield').getBoundingClientRect(); const core = { x: map.left + map.width * .94, y: map.top + map.height * .5 }; return { mapWidth: map.width, width: shield.width, containsCore: core.x >= shield.left && core.x <= shield.right && core.y >= shield.top && core.y <= shield.bottom, pointerEvents: getComputedStyle(document.querySelector('.royal-barrier')).pointerEvents, readoutVisible: document.querySelector('.royal-barrier-readout').getBoundingClientRect().height > 0 }; })()`);
    assert.ok(barrierGeometry.width >= barrierGeometry.mapWidth * .17, "the royal barrier must read as a core-wide shield instead of a lane-local token");
    assert.equal(barrierGeometry.containsCore, true, "the visible shield must enclose the philosopher-stone core");
    assert.equal(barrierGeometry.pointerEvents, "none", "the decorative shield must never steal drag or selection input");
    assert.equal(barrierGeometry.readoutVisible, true, "durability and blocking remain readable below the shield");

    const combatViewport = await evaluate(`(() => ({ scrollX, horizontalOverflow: document.documentElement.scrollWidth - innerWidth, titleLeft: document.querySelector('.game-title').getBoundingClientRect().left, mapPanelBottom: document.querySelector('.map-panel').getBoundingClientRect().bottom, viewportHeight: innerHeight }))()`);
    assert.ok(combatViewport.scrollX <= 1 && combatViewport.horizontalOverflow <= 1, "combat interactions must not shift the single-screen shell horizontally");
    assert.ok(combatViewport.titleLeft >= 0, "the expanded top HUD must not clip the game title off the left edge");
    assert.ok(combatViewport.mapPanelBottom >= combatViewport.viewportHeight - 56, `combat must return the drawer body while preserving its 34px unified tab and shell gutters: ${JSON.stringify(combatViewport)}`);
    await capture("combat-clean-1920x1080.png");
    const collapsedDock = await evaluate(`(() => { const dock = document.querySelector('.economy-deck'); const rect = dock.getBoundingClientRect(); return { display: getComputedStyle(dock).display, width: rect.width, height: rect.height, tabs: [...document.querySelectorAll('.economy-dock-tabs button')].filter((button) => { const rect = button.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }).map((button) => button.textContent.trim()), switches: [...document.querySelectorAll('.window-switches>button')].map((button) => button.textContent.trim()) }; })()`);
    assert.equal(collapsedDock.display, "grid", "combat keeps one small lower reopening tab instead of separate reserve and shop controls");
    assert.ok(collapsedDock.height <= 34.5, `collapsed operation drawer must stay compact: ${JSON.stringify(collapsedDock)}`);
    assert.equal(collapsedDock.tabs.length, 1, "desktop reserve and shop must share exactly one visible control");
    assert.ok(collapsedDock.tabs.some((label) => label.includes("备战")) && collapsedDock.tabs.some((label) => label.includes("商店")), "reserve and shop controls must belong to the lower operation band");
    assert.equal(collapsedDock.switches.some((label) => label === "情报" || label.includes("商店") || label.includes("备战")), false, "top actions must stay free of redundant window controls");

    const mapSize = await evaluate(`(() => { const rect = document.querySelector('.map-field').getBoundingClientRect(); return { width: rect.width, height: rect.height }; })()`);
    assert.ok(mapSize.width > 0 && mapSize.height > 0, "map must retain measurable browser geometry");
    await click(".wave-info>button");
    const commandLayout = await evaluate(`(() => { const wave = document.querySelector('.wave-breakdown').getBoundingClientRect(); return { waveHeight: wave.height, waveFont: parseFloat(getComputedStyle(document.querySelector('.wave-breakdown .lane-row i')).fontSize), resonanceOverflow: getComputedStyle(document.querySelector('.resonance-rail>div')).overflowY, telemetryDisplay: getComputedStyle(document.querySelector('.telemetry-rail')).display }; })()`);
    assert.ok(commandLayout.waveHeight > 0 && commandLayout.waveFont >= 11, "wave details must be readable from the top wave value");
    assert.equal(commandLayout.resonanceOverflow, "auto", "the lineup resonance rail must accept wheel scrolling");
    assert.notEqual(commandLayout.telemetryDisplay, "none", "the right rail must keep compact combat rankings without an intel window");
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(artifacts, "browser-interactions-1920x1080.png"), Buffer.from(screenshot.data, "base64"));

    await reset();
    await click(".settings-button");
    await waitSelector(".developer-tools");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await clickText(".developer-actions button", "生成 W5 洞穴之影");
    await click(".settings-button");
    await waitSelector(".enemy-token.boss-kind-cave-boss");
    const midBossWidth = await evaluate("document.querySelector('.enemy-token.boss-kind-cave-boss').getBoundingClientRect().width");
    assert.ok(midBossWidth >= 144, "the W5 boss must be a large map landmark, not an ordinary enemy-sized token");
    await capture("mid-boss-cave-shadow-1920x1080.png");

    await reset();
    await click(".settings-button");
    await waitSelector(".developer-tools");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await clickText(".developer-actions button", "生成 W10 绝对精神");
    await click(".settings-button");
    await waitSelector(".boss-health-display");
    await waitSelector(".enemy-token.boss");
    const bossPresentation = await evaluate(`(() => { const token = document.querySelector('.enemy-token.boss').getBoundingClientRect(); const health = document.querySelector('.boss-health-display').getBoundingClientRect(); return { tokenWidth: token.width, healthWidth: health.width, label: document.querySelector('.boss-name')?.textContent?.trim() }; })()`);
    assert.ok(bossPresentation.tokenWidth >= 170, "the final Boss must dominate ordinary enemies at a glance");
    assert.ok(bossPresentation.healthWidth >= 420, "Boss encounter must expose a wide independent health bar");
    assert.match(bossPresentation.label, /绝对精神.*阶段Boss/, "the final Boss must show both its philosophical name and combat identity");
    const bossScreenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(artifacts, "boss-encounter-1920x1080.png"), Buffer.from(bossScreenshot.data, "base64"));

    await reset();
    await click(".settings-button");
    await waitSelector(".developer-tools");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await click('[data-debug="absolute-fragments"]');
    await click(".settings-button");
    await waitFor(() => evaluate("document.querySelectorAll('.enemy-token.atom-boss').length === 3"), "three visible Absolute Spirit fragments");
    const fragmentPresentation = await evaluate(`(() => { const tokens = [...document.querySelectorAll('.enemy-token.atom-boss')].map((token) => ({ width: token.getBoundingClientRect().width, label: token.querySelector('.boss-name')?.textContent?.trim(), hpWidth: token.querySelector(':scope>i')?.getBoundingClientRect().width, aria: token.querySelector(':scope>i')?.getAttribute('aria-label') })); const aggregate = document.querySelector('.boss-health-display'); return { tokens, aggregate: aggregate?.textContent, aggregateWidth: aggregate?.getBoundingClientRect().width }; })()`);
    assert.equal(fragmentPresentation.tokens.length, 3, "atomization must show exactly three small Absolute Spirits");
    assert.ok(fragmentPresentation.tokens.every((token) => token.width >= 72 && token.width < 170 && token.hpWidth >= 60 && token.label?.includes("分有") && token.aria?.includes("绝对精神·分有") && token.aria?.includes("生命")), `every fragment needs recognizable boss art and its own health bar: ${JSON.stringify(fragmentPresentation)}`);
    assert.ok(fragmentPresentation.aggregate?.includes("逻辑原子化 · 3 个分有") && fragmentPresentation.aggregateWidth >= 420, `the global Boss bar must aggregate the three fragments: ${JSON.stringify(fragmentPresentation)}`);
    await capture("absolute-spirit-fragments-1920x1080.png");

    await reset();
    await click(".settings-button");
    await waitSelector(".developer-tools");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await setValue(".developer-tools>div:first-of-type label:nth-child(2) input", 8);
    await setValue(".developer-tools>div:first-of-type label:nth-child(3) input", 8);
    await setValue('[data-debug="lineup"]', "fichte@3,heidegger@3,hobbes@3,epicurus@3,schelling@3,kant@3,hegel@3,bacon@3");
    await click('[data-debug="apply"]');
    await evaluate("document.querySelector('.developer-tools').open = true");
    await clickText(".developer-actions button", "生成 W10 绝对精神");
    await click(".settings-button");
    await clickText(".quick-combat", "1×");
    await waitFor(() => exists(".victory-sequence .victory-lineup"), "real W10 victory lineup", 45_000);
    const victoryHonours = await evaluate(`(() => { const overlay = document.querySelector('.victory-sequence').getBoundingClientRect(); const lineup = document.querySelector('.victory-lineup').getBoundingClientRect(); const cards = [...document.querySelectorAll('.victory-unit-card')].map((card) => { const rect = card.getBoundingClientRect(); const portrait = card.querySelector('.victory-unit-portrait').getBoundingClientRect(); return { id: card.dataset.victoryCharacterId, text: card.textContent.trim(), width: rect.width, height: rect.height, portraitWidth: portrait.width, portraitHeight: portrait.height, inside: rect.left >= lineup.left && rect.right <= lineup.right + 1 && rect.top >= lineup.top && rect.bottom <= lineup.bottom + 1 }; }); const restart = document.querySelector('.victory-restart').getBoundingClientRect(); const record = document.querySelector('.victory-record-toggle').getBoundingClientRect(); return { text: document.querySelector('.victory-sequence').textContent, cards, lineupInside: lineup.left >= overlay.left && lineup.right <= overlay.right && lineup.top >= overlay.top && lineup.bottom <= overlay.bottom, actionsAligned: Math.abs(restart.top - record.top) <= 1 && Math.abs(restart.height - record.height) <= 1 && record.left > restart.right, actionsInside: restart.bottom <= overlay.bottom && record.bottom <= overlay.bottom, drawerPresent: Boolean(document.querySelector('.victory-record-drawer')), staleBossBanner: Boolean(document.querySelector('.boss-phase-banner')) }; })()`);
    assert.deepEqual(victoryHonours.cards.map((card) => card.id), ["fichte", "heidegger", "hobbes", "epicurus", "schelling", "kant", "hegel", "bacon"], `victory must preserve the actual final fielded roster in slot order: ${JSON.stringify(victoryHonours.cards)}`);
    assert.ok(victoryHonours.cards.every((card) => card.inside && card.width >= 60 && card.portraitWidth >= 39 && card.portraitHeight >= 39 && card.text.includes("3★")), `every winning philosopher needs a readable icon, name and star rank: ${JSON.stringify(victoryHonours.cards)}`);
    assert.equal(victoryHonours.lineupInside && victoryHonours.actionsAligned && victoryHonours.actionsInside, true, `the hall of honour and adjacent record action must remain inside the victory overlay: ${JSON.stringify(victoryHonours)}`);
    assert.equal(victoryHonours.drawerPresent, false, "settlement data must not occupy the centre before the player requests it");
    assert.equal(victoryHonours.text.includes("THE RUN IN HISTORY"), false, "the old English history block must be absent from the victory presentation");
    assert.equal(victoryHonours.staleBossBanner, false, "a late Boss phase banner must not cover the final victory title or honours");
    await delay(1800);
    assert.equal(await exists(".victory-sequence"), true, "final settlement must remain until the player chooses an action");
    assert.equal(await exists(".wave-toast"), false, "transient wave settlement must not cover the final victory decision");
    await capture("victory-lineup-1920x1080.png");
    await click(".victory-record-toggle");
    await waitSelector(".victory-record-drawer");
    const victorySummary = await evaluate(`(() => { const overlay = document.querySelector('.victory-sequence').getBoundingClientRect(); const drawerNode = document.querySelector('.victory-record-drawer'); const drawer = drawerNode.getBoundingClientRect(); const text = drawerNode.textContent; return { text, tabs: [...drawerNode.querySelectorAll('.victory-ranking nav button')].map((button) => ({ text: button.textContent, pressed: button.getAttribute('aria-pressed') })), rows: [...drawerNode.querySelectorAll('.victory-ranking p:not(.empty)')].map((row) => row.textContent), metric: drawerNode.querySelector('.victory-ranking')?.dataset.victoryRanking, visible: drawer.width > 0 && drawer.height > 0, inViewport: drawer.top >= overlay.top && drawer.right <= overlay.right && drawer.bottom <= overlay.bottom, expanded: document.querySelector('.victory-record-toggle').getAttribute('aria-expanded') === 'true' }; })()`);
    assert.ok(victorySummary.text.includes("阵容与贡献战绩") && victorySummary.text.includes("最终阵营") && victorySummary.text.includes("激活羁绊") && victorySummary.text.includes("棋子贡献榜") && victorySummary.text.includes("本局总收入"), "the shareable record must prioritize the final build and real unit contributions");
    assert.equal(victorySummary.text.includes("刷新次数") || victorySummary.text.includes("购买经验") || victorySummary.text.includes("战争机器"), false, "ordinary victory records must not be filled with debug economy or event-only rows");
    assert.deepEqual(victorySummary.tabs.map((tab) => tab.text), ["伤害", "承伤", "治疗", "护盾"], "the compact contribution record must expose four switchable rankings");
    assert.equal(victorySummary.metric, "damage");
    assert.ok(victorySummary.rows.length > 0 && victorySummary.tabs[0].pressed === "true", "damage ranking must open with real recorded contributors");
    assert.equal(victorySummary.visible && victorySummary.inViewport && victorySummary.expanded, true, `the record drawer must be visible, bounded and announced as expanded: ${JSON.stringify(victorySummary)}`);
    await clickText(".victory-ranking nav button", "治疗");
    assert.equal(await evaluate("document.querySelector('.victory-ranking')?.dataset.victoryRanking"), "healing", "contribution rankings must switch in place instead of expanding the drawer");
    await capture("victory-summary-1920x1080.png");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 667, height: 375, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
    await delay(300);
    const mobileVictory = await evaluate(`(() => {
      const overlay = document.querySelector('.victory-sequence').getBoundingClientRect();
      const drawer = document.querySelector('.victory-record-drawer').getBoundingClientRect();
      const close = document.querySelector('.victory-record-drawer>header>button').getBoundingClientRect();
      const tabs = [...document.querySelectorAll('.victory-ranking nav button')].map((button) => button.getBoundingClientRect().height);
      const topbar = document.querySelector('.game-shell>.topbar');
      const statusLine = document.querySelector('.game-shell>.status-line');
      const economy = document.querySelector('.game-shell>.economy-deck');
      return {
        overlay: { left: overlay.left, top: overlay.top, right: overlay.right, bottom: overlay.bottom },
        drawer: { left: drawer.left, top: drawer.top, right: drawer.right, bottom: drawer.bottom },
        closeHeight: close.height,
        minimumTabHeight: Math.min(...tabs),
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        underlyingChromeHidden: getComputedStyle(topbar).visibility === 'hidden' && getComputedStyle(statusLine).visibility === 'hidden' && getComputedStyle(economy).visibility === 'hidden',
      };
    })()`);
    assert.ok(mobileVictory.overlay.left >= 0 && mobileVictory.overlay.top >= 0 && mobileVictory.overlay.right <= 668 && mobileVictory.overlay.bottom <= 376, `mobile settlement must own the viewport: ${JSON.stringify(mobileVictory)}`);
    assert.ok(mobileVictory.drawer.left >= mobileVictory.overlay.left && mobileVictory.drawer.top >= mobileVictory.overlay.top && mobileVictory.drawer.right <= mobileVictory.overlay.right && mobileVictory.drawer.bottom <= mobileVictory.overlay.bottom, `mobile record drawer must remain bounded: ${JSON.stringify(mobileVictory)}`);
    assert.ok(mobileVictory.closeHeight >= 40 && mobileVictory.minimumTabHeight >= 40 && mobileVictory.horizontalOverflow <= 1 && mobileVictory.underlyingChromeHidden, `mobile settlement controls must be touchable and must shield the underlying game UI: ${JSON.stringify(mobileVictory)}`);
    await clickText(".victory-ranking nav button", "护盾");
    assert.equal(await evaluate("document.querySelector('.victory-ranking')?.dataset.victoryRanking"), "shielding", "mobile contribution tabs must remain operable");
    await capture("mobile-victory-record-667x375.png");
    await click(".victory-record-drawer>header>button");
    await waitFor(() => evaluate("!document.querySelector('.victory-record-drawer')"), "mobile victory record to close");
    const mobileVictoryHall = await evaluate(`(() => {
      const overlay = document.querySelector('.victory-sequence');
      const actions = [...overlay.querySelectorAll('.victory-actions button')].map((button) => button.getBoundingClientRect().height);
      return {
        scrollable: overlay.scrollHeight > overlay.clientHeight,
        minimumActionHeight: Math.min(...actions),
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    })()`);
    assert.ok(mobileVictoryHall.minimumActionHeight >= 40 && mobileVictoryHall.horizontalOverflow <= 1, `mobile victory hall must remain operable through its internal vertical scroller: ${JSON.stringify(mobileVictoryHall)}`);
    await capture("mobile-victory-667x375.png");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await delay(300);

    await loadHistoricalScenario(3, { eventId: "event:reformation", eventPresented: false, eventResolved: false, reformationCandidates: undefined, reformationChosenId: undefined });
    assert.equal(await evaluate("document.querySelector('.quick-wave').disabled"), true, "W3 must remain blocked before the event is stored");
    await click('[data-historical-action="confirm-event"]');
    await waitFor(() => evaluate("document.querySelectorAll('.historical-choice-grid [data-historical-choice]').length === 3"), "three reformation choices");
    await capture("historical-event-w3-1920x1080.png");
    await click(".historical-choice-grid [data-historical-choice]");
    await waitFor(() => evaluate("!document.querySelector('.historical-decision-dialog')"), "W3 decision to clear");
    assert.equal(await evaluate("document.querySelector('.quick-wave').disabled"), false, "choosing the saved reformation reward must unlock W3");

    const measureShopActions = () => evaluate(`(() => ({ buttons: [...document.querySelectorAll('.shop-actions>button')].map((button) => { const rect = button.getBoundingClientRect(); return { text: button.textContent.replace(/\\s+/g, ' ').trim(), left: rect.left, top: rect.top, width: rect.width, height: rect.height }; }), freeDetachedAction: Boolean(document.querySelector('[data-historical-action="free-refresh"]')) }))()`);
    await loadHistoricalScenario(4, { eventId: "event:industrial_revolution", eventPresented: true, eventResolved: true, waveFlags: { normalPurchaseSpend: 0, freeRefreshesAvailable: 0, freeRefreshesUsed: 0 } });
    const paidRefreshLayout = await measureShopActions();
    assert.equal(paidRefreshLayout.buttons.length, 3, "the market must always own exactly experience, refresh and freeze controls");
    assert.match(paidRefreshLayout.buttons[1].text, /刷新\s*2 ◈/);
    await loadHistoricalScenario(4, { eventId: "event:industrial_revolution", eventPresented: true, eventResolved: true, waveFlags: { normalPurchaseSpend: 8, freeRefreshesAvailable: 1, freeRefreshesUsed: 0 } });
    const freeRefreshLayout = await measureShopActions();
    assert.equal(freeRefreshLayout.buttons.length, 3, "earning an industrial refresh must not create a fourth market control");
    assert.equal(freeRefreshLayout.freeDetachedAction, false, "industrial refresh must reuse the normal refresh button");
    assert.match(freeRefreshLayout.buttons[1].text, /刷新\s*0 ◈/);
    for (let index = 0; index < 3; index += 1) {
      const paid = paidRefreshLayout.buttons[index];
      const free = freeRefreshLayout.buttons[index];
      assert.ok(["left", "top", "width", "height"].every((field) => Math.abs(paid[field] - free[field]) <= .5), `industrial refresh must not move market control ${index}: ${JSON.stringify({ paid, free })}`);
    }
    await capture("industrial-free-refresh-ready-1920x1080.png");
    const industrialGoldBefore = await evaluate(readGold);
    await click('.shop-actions>button[data-refresh-cost="0"]');
    assert.equal(await evaluate(readGold), industrialGoldBefore, "the shared refresh button must consume the industrial free use before charging gold");
    assert.equal(await evaluate("document.querySelectorAll('.shop-actions>button').length"), 3);
    assert.match(await evaluate("document.querySelector('.shop-actions>button:nth-child(2)')?.textContent ?? ''"), /2 ◈/, "the unchanged refresh button must return to its normal price after the free use");
    await capture("industrial-free-refresh-1920x1080.png");

    await loadHistoricalScenario(6, { eventId: "event:world_war", eventPresented: true, eventResolved: true, stanceCandidateIds: ["stance:liberalism", "stance:communism", "stance:reformism"], stancePresented: false, selectedStanceId: undefined });
    assert.equal(await evaluate("document.querySelector('.quick-wave').disabled"), true, "W6 must remain blocked before a stance is stored");
    const ideologyShopBefore = await evaluate("[...document.querySelectorAll('.shop-card h3')].map((node) => node.textContent)");
    await capture("historical-stance-choice-w6-1920x1080.png");
    await click('[data-historical-choice="stance:liberalism"]');
    await waitFor(() => evaluate("!document.querySelector('.historical-decision-dialog')"), "W6 stance decision to clear");
    assert.ok((await evaluate("document.querySelector('.status-line')?.textContent ?? ''")).includes("自由主义"), "the chosen ideology must be present in the upper production status bar");
    const historicalStatusVisibility = await evaluate(`(() => { const line = document.querySelector('.status-line'); const event = [...line.querySelectorAll('.historical-status-inline')].find((item) => item.textContent.includes('历史事件')); const ideology = [...line.querySelectorAll('.historical-status-inline')].find((item) => item.textContent.includes('意识形态')); const visible = (node) => { const rect = node?.getBoundingClientRect(); return Boolean(rect && rect.width > 0 && rect.height > 0 && getComputedStyle(node).display !== 'none'); }; return { line: visible(line), event: visible(event), ideology: visible(ideology) }; })()`);
    assert.deepEqual(historicalStatusVisibility, { line: true, event: true, ideology: true }, "history and ideology must be visibly rendered, not merely present in hidden DOM");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.shop-card h3')].map((node) => node.textContent)"), ideologyShopBefore, "choosing liberalism must not silently reroll the market");
    assert.ok(await evaluate("document.documentElement.scrollHeight - innerHeight <= 1"), "the historical status in the upper bar must preserve the 1920x1080 single-screen shell");
    const measureLiberalShop = () => evaluate(`(() => { const grid = document.querySelector('.shop-grid'); const slots = [...grid.children]; const box = (rect) => rect ? ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }) : undefined; const measured = slots.map((slot, index) => { const card = slot.querySelector('.shop-card'); const purchase = slot.querySelector('button.shop-card'); const portrait = slot.querySelector('.portrait'); const cost = slot.querySelector('.cost'); const heading = slot.querySelector('.shop-card-heading'); const text = slot.querySelector('.shop-text'); const slotRect = slot.getBoundingClientRect(); const cardRect = card.getBoundingClientRect(); const inside = (inner, outer) => !inner || (inner.left >= outer.left - .5 && inner.right <= outer.right + .5 && inner.top >= outer.top - .5 && inner.bottom <= outer.bottom + .5); const centerOwner = purchase ? document.elementFromPoint(purchase.getBoundingClientRect().left + purchase.getBoundingClientRect().width / 2, purchase.getBoundingClientRect().top + purchase.getBoundingClientRect().height / 2)?.closest('button.shop-card') === purchase : true; return { index, slotClass: slot.classList.contains('shop-card-slot'), empty: card.classList.contains('shop-card--empty'), slotRect: box(slotRect), cardRect: box(cardRect), textRect: box(text?.getBoundingClientRect()), headingRect: box(heading?.getBoundingClientRect()), costRect: box(cost?.getBoundingClientRect()), headingColumns: heading ? getComputedStyle(heading).gridTemplateColumns : undefined, sameBox: Math.abs(slotRect.left - cardRect.left) <= .5 && Math.abs(slotRect.top - cardRect.top) <= .5 && Math.abs(slotRect.width - cardRect.width) <= .5 && Math.abs(slotRect.height - cardRect.height) <= .5, portraitInside: inside(portrait?.getBoundingClientRect(), cardRect), costInside: inside(cost?.getBoundingClientRect(), cardRect), centerOwner, transform: getComputedStyle(card).transform }; }); return { childCount: slots.length, measured }; })()`);
    const assertStableLiberalShop = (layout, label, allowAnimation = false) => { assert.equal(layout.childCount, 5, `${label}: market must keep five direct slot owners`); assert.ok(layout.measured.every((slot) => slot.slotClass && (allowAnimation || slot.sameBox) && slot.portraitInside && slot.costInside && slot.centerOwner), `${label}: icon, price, visual card and click owner must share one stable box: ${JSON.stringify(layout)}`); if (!allowAnimation) assert.ok(layout.measured.every((slot) => slot.transform === 'none'), `${label}: no stale purchase or refresh transform may remain`); };
    assertStableLiberalShop(await measureLiberalShop(), "before liberal purchase");
    const liberalGoldBefore = await evaluate(readGold);
    await click(".shop-card:not(.shop-card--empty)");
    await waitSelector(".unit-card>.liberal-refund-button");
    assertStableLiberalShop(await measureLiberalShop(), "after liberal purchase");
    const liberalLayout = await evaluate(`(() => { const button = document.querySelector('.unit-card>.liberal-refund-button'); const card = button?.closest('.unit-card'); const oldBar = document.querySelector('.historical-action-bar [data-historical-action="liberal-sale"]'); const rect = button?.getBoundingClientRect(); return { boundToPiece: Boolean(card), oldBar: Boolean(oldBar), visible: Boolean(rect && rect.width > 0 && rect.height > 0), label: button?.textContent ?? '' }; })()`);
    assert.equal(liberalLayout.boundToPiece, true, "liberalism must attach its refund action to the corresponding owned piece");
    assert.equal(liberalLayout.oldBar, false, "liberalism must not add a detached control that shifts the market layout");
    assert.equal(liberalLayout.visible, true);
    assert.match(liberalLayout.label, /全退 \d+◈/);
    await capture("historical-liberal-refund-1920x1080.png");
    await click(".unit-card>.liberal-refund-button");
    await waitFor(() => evaluate("document.querySelectorAll('.unit-card>.liberal-refund-button').length === 0"), "single-use liberal refund controls to clear");
    assert.equal(await evaluate(readGold), liberalGoldBefore, "buying and then fully refunding one piece must restore the exact gold amount");
    assertStableLiberalShop(await measureLiberalShop(), "after liberal full refund");
    await clickText(".shop-actions button", "刷新");
    assertStableLiberalShop(await measureLiberalShop(), "during liberal refresh", true);
    await delay(750);
    assertStableLiberalShop(await measureLiberalShop(), "after liberal refresh");
    await click(".shop-card:not(.shop-card--empty)");
    assertStableLiberalShop(await measureLiberalShop(), "after second liberal purchase");
    assert.equal(await evaluate("document.querySelectorAll('.unit-card>.liberal-refund-button').length"), 0, "the once-per-wave refund must not leave a stale action on the next purchased piece");
    for (const viewport of [{ width: 1366, height: 768, label: "1366x768" }, { width: 1093, height: 614, label: "125 percent desktop zoom" }]) {
      await cdp.call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await delay(180);
      assertStableLiberalShop(await measureLiberalShop(), viewport.label);
    }
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await delay(180);
    await capture("historical-stance-w6-1920x1080.png");

    await loadHistoricalScenario(6, { eventId: "event:may_1968", eventPresented: true, eventResolved: true, stanceCandidateIds: ["stance:reformism", "stance:liberalism", "stance:communism"], stancePresented: true, selectedStanceId: "stance:reformism" });
    await click(".historical-quick-guide>summary");
    const currentRunHistory = await evaluate(`(() => { const event = document.querySelector('[data-history-record="event"]'); const ideology = document.querySelector('[data-history-record="ideology"]'); const panel = document.querySelector('.historical-quick-guide-panel')?.getBoundingClientRect(); const anchor = document.querySelector('.historical-quick-guide>summary')?.getBoundingClientRect(); return { event: event?.textContent ?? '', ideology: ideology?.textContent ?? '', all: document.querySelector('.historical-quick-guide-panel')?.textContent ?? '', anchorGap: panel && anchor ? panel.top - anchor.bottom : null, rightDelta: panel && anchor ? Math.abs(panel.right - anchor.right) : null }; })()`);
    assert.ok(currentRunHistory.event.includes("五月风暴"), "the history record must show the event stored in this run");
    assert.ok(currentRunHistory.ideology.includes("改良主义") && currentRunHistory.ideology.includes("既有制度中持续修补") && currentRunHistory.ideology.includes("每一波") && currentRunHistory.ideology.includes("商店槽位"), "the ideology record must explain reformism's philosophical meaning before the action it permits");
    assert.equal(currentRunHistory.ideology.includes("本局效果"), false, "the ideology record must not retain the redundant effect label");
    assert.ok(currentRunHistory.anchorGap >= 4 && currentRunHistory.anchorGap <= 12 && currentRunHistory.rightDelta <= 1, `the populated history record must remain directly under its summary: ${JSON.stringify(currentRunHistory)}`);
    for (const unrelatedEntry of ["工业革命", "世界大战", "自由主义", "保守主义", "激进主义", "共产主义"]) {
      assert.equal(currentRunHistory.all.includes(unrelatedEntry), false, `the current-run record must not mix in ${unrelatedEntry}`);
    }
    await capture("historical-current-run-guide-1920x1080.png");
    await click(".historical-quick-guide>summary");
    const reformistLayout = await evaluate(`(() => { const cards = [...document.querySelectorAll('.shop-card-slot')]; const buttons = [...document.querySelectorAll('.shop-card-slot>.reformist-replace-button')]; return { cards: cards.length, buttons: buttons.length, numberedBarButtons: document.querySelectorAll('.historical-action-bar [data-historical-action="reformist-replace"]').length, aligned: buttons.every((button) => { const buttonRect = button.getBoundingClientRect(); const cardRect = button.parentElement.getBoundingClientRect(); return buttonRect.left >= cardRect.left && buttonRect.right <= cardRect.right && buttonRect.top >= cardRect.top && buttonRect.bottom <= cardRect.bottom; }), status: document.querySelector('.status-line')?.textContent ?? '' }; })()`);
    assert.equal(reformistLayout.cards, 5, "the market must retain five stable card slots under reformism");
    assert.equal(reformistLayout.buttons, 5, "each available market card must own one clearly bound replacement button");
    assert.equal(reformistLayout.numberedBarButtons, 0, "reformism must not render the old detached 1/2/3/4/5 controls");
    assert.equal(reformistLayout.aligned, true, "replacement controls must stay inside their corresponding card slot");
    assert.ok(reformistLayout.status.includes("五月风暴") && reformistLayout.status.includes("意识形态"), "May 1968 and ideology must be visible in the upper status bar");
    const reformistBefore = await evaluate("[...document.querySelectorAll('.shop-card-slot')].map((slot) => ({ name: slot.querySelector('h3')?.textContent, cost: slot.querySelector('.cost')?.textContent }))");
    await click('.shop-card-slot>.reformist-replace-button');
    await waitFor(() => evaluate("document.querySelectorAll('.shop-card-slot>.reformist-replace-button').length === 0"), "single-use reformist replacement controls to clear");
    const reformistAfter = await evaluate("[...document.querySelectorAll('.shop-card-slot')].map((slot) => ({ name: slot.querySelector('h3')?.textContent, cost: slot.querySelector('.cost')?.textContent }))");
    assert.equal(reformistAfter.length, 5, "reformism must keep all five market slots visible");
    assert.ok(reformistAfter.every((card) => card.name && card.cost), "reformism must not create a blank or detached market card");
    assert.equal(reformistAfter[0].cost, reformistBefore[0].cost, "reformism must preserve the selected slot's cost");
    assert.deepEqual(reformistAfter.slice(1), reformistBefore.slice(1), "reformism must change only the selected market slot");
    await capture("historical-reformism-market-1920x1080.png");

    await loadHistoricalScenario(8, { eventId: "event:may_1968", eventPresented: true, eventResolved: true, stanceCandidateIds: ["stance:reformism", "stance:liberalism", "stance:communism"], stancePresented: true, selectedStanceId: "stance:reformism" });
    await applyLineup("epicurus");
    await click(".quick-wave");
    await waitSelector(".quick-combat");
    await waitFor(() => evaluate("Number(document.querySelector('.top-core-resource>strong')?.childNodes[0]?.textContent ?? 100) < 100"), "an enemy to damage the philosopher stone", 35_000);
    await clickText(".quick-combat", "暂停");
    await click(".core-health-control>.top-core-resource");
    const damagedCoreLedger = await evaluate(`(() => { const button = document.querySelector('.top-core-resource'); const ledger = document.querySelector('.core-damage-ledger'); const health = Number(button?.querySelector('strong')?.childNodes[0]?.textContent ?? 100); const rows = [...ledger.querySelectorAll('[data-core-damage-source]')].map((row) => ({ source: row.dataset.coreDamageSource, amount: Number(row.dataset.coreDamageAmount), text: row.textContent })); return { health, text: ledger.textContent, rows, total: rows.reduce((sum, row) => sum + row.amount, 0) }; })()`);
    assert.ok(damagedCoreLedger.rows.length > 0 && damagedCoreLedger.rows.every((row) => row.source && row.amount > 0 && row.text.includes("突破防线")), `real core damage must name every source and amount: ${JSON.stringify(damagedCoreLedger)}`);
    assert.equal(damagedCoreLedger.total, 100 - damagedCoreLedger.health, "the clickable ledger total must equal the actual health lost in this run");
    await capture("core-damage-ledger-1920x1080.png");

    // Map-layout review artifacts use the real UI and the same developer state
    // hooks as manual balancing. No DOM-only visual mock is substituted.
    await reset();
    await capture("map-code-layout-1920x1080.png");
    await click(".settings-button");
    await waitSelector(".developer-tools");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await click('[data-debug="map-merge"]');
    await click(".settings-button");
    await waitFor(() => evaluate("document.querySelectorAll('.map-field .slot.occupied').length === 8"), "eight deployed map pieces");
    await capture("map-eight-merge-concentrated-1920x1080.png");

    await click(".settings-button");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await click('[data-debug="map-split"]');
    await click(".settings-button");
    await capture("map-eight-three-lane-split-1920x1080.png");

    await click(".settings-button");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await click('[data-debug="map-max"]');
    await click(".settings-button");
    await capture("map-maximum-piece-dense-1920x1080.png");

    await click(".settings-button");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await click('[data-debug="map-stress"]');
    await click(".settings-button");
    await waitSelector(".enemy-token.boss");
    assert.equal(await evaluate("document.querySelectorAll('.enemy-token').length"), 4, "stress scene must show ordinary, armored, elite and boss together");
    const normalized1920 = await evaluate(`(() => { const map = document.querySelector('.map-field').getBoundingClientRect(); return [...document.querySelectorAll('.map-field .slot.occupied')].map((slot) => { const rect = slot.getBoundingClientRect(); return { x: (rect.left + rect.width / 2 - map.left) / map.width, y: (rect.top + rect.height / 2 - map.top) / map.height }; }); })()`);
    await capture("map-core-boss-pressure-1920x1080.png");
    await click(".settings-button");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await click('[data-debug="map-debug"]');
    await click(".settings-button");
    await waitSelector(".map-debug-overlay");
    await capture("map-coordinate-collision-debug-1920x1080.png");
    await click(".settings-button");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await click('[data-debug="map-debug"]');
    await click(".settings-button");

    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await delay(350);
    const normalized1366 = await evaluate(`(() => { const map = document.querySelector('.map-field').getBoundingClientRect(); return [...document.querySelectorAll('.map-field .slot.occupied')].map((slot) => { const rect = slot.getBoundingClientRect(); return { x: (rect.left + rect.width / 2 - map.left) / map.width, y: (rect.top + rect.height / 2 - map.top) / map.height }; }); })()`);
    normalized1920.forEach((point, index) => { assert.ok(Math.abs(point.x - normalized1366[index].x) < .0025 && Math.abs(point.y - normalized1366[index].y) < .0025, `slot ${index + 1} must retain normalized coordinates within subpixel-responsive tolerance: ${JSON.stringify({ desktop: point, compact: normalized1366[index] })}`); });
    const compactReadability = await evaluate(`(() => { const coreEnglish = document.querySelector('.top-core-resource>div small'); const coreLabel = document.querySelector('.top-core-resource>div b').getBoundingClientRect(); const coreHealth = document.querySelector('.top-core-resource>strong').getBoundingClientRect(); const bench = document.querySelector('.bench').getBoundingClientRect(); const lastBenchSlot = [...document.querySelectorAll('.bench-grid .slot')].at(-1).getBoundingClientRect(); const clipped = [...document.querySelectorAll('.shop-card h3,.shop-card .shop-meta,.shop-card .shop-skill>small,.resonance-rail button b')].filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent.trim()); return { coreEnglishDisplay: getComputedStyle(coreEnglish).display, coreTextGap: coreHealth.left - coreLabel.right, lastBenchOverflow: lastBenchSlot.right - bench.right, clipped }; })()`);
    assert.equal(compactReadability.coreEnglishDisplay, "none", "compact desktop hides the decorative core subtitle before it can collide with health");
    assert.ok(compactReadability.coreTextGap >= 2, `compact desktop core label must not collide with health: ${JSON.stringify(compactReadability)}`);
    assert.ok(compactReadability.lastBenchOverflow <= 1, `all nine reserve slots must remain inside the unified drawer: ${JSON.stringify(compactReadability)}`);
    assert.deepEqual(compactReadability.clipped, [], `compact desktop primary labels must not be ellipsized: ${JSON.stringify(compactReadability.clipped)}`);
    await capture("map-stress-1366x768.png");
    const zoomViewports = [
      { label: "1920 at 110%", width: 1745, height: 982 },
      { label: "1920 at 125%", width: 1536, height: 864 },
      { label: "1366 at 125%", width: 1093, height: 614 },
    ];
    for (const viewport of zoomViewports) {
      await cdp.call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await delay(250);
      const accessibility = await evaluate(`(() => { window.scrollTo(0, document.documentElement.scrollHeight); const root = document.documentElement; const map = document.querySelector('.map-field').getBoundingClientRect(); return { horizontalOverflow: root.scrollWidth - root.clientWidth, reachedBottom: window.scrollY + window.innerHeight >= root.scrollHeight - 2, mapWidth: map.width, mapRatio: map.width / map.height, shopHeading: Boolean(document.querySelector('.shop .panel-heading')), benchHeading: Boolean(document.querySelector('.bench .panel-heading')) }; })()`);
      assert.ok(accessibility.horizontalOverflow <= 1, `${viewport.label} must not create inaccessible horizontal overflow`);
      assert.equal(accessibility.reachedBottom, true, `${viewport.label} must keep the whole interface reachable by vertical scrolling`);
      assert.ok(accessibility.mapWidth > 0 && Math.abs(accessibility.mapRatio - 16 / 9) < .02, `${viewport.label} must preserve the map coordinate ratio: ${JSON.stringify(accessibility)}`);
      assert.equal(accessibility.shopHeading && accessibility.benchHeading, true, `${viewport.label} must retain access to shop and reserve toggles`);
    }
    const mobileViewports = [
      { label: "small phone portrait", width: 360, height: 800, expectScrollableMap: true, expectHint: true },
      { label: "phone portrait", width: 390, height: 844, expectScrollableMap: true, expectHint: false },
      { label: "compact phone landscape", width: 667, height: 375, expectScrollableMap: false },
      { label: "phone landscape", width: 844, height: 390, expectScrollableMap: false },
      { label: "large phone landscape", width: 932, height: 430, expectScrollableMap: false },
      { label: "tablet portrait", width: 768, height: 1024, expectScrollableMap: false, expectFixedDrawer: false },
    ];
    await evaluate("sessionStorage.removeItem('philosophy-auto-chess-landscape-hint-dismissed')");
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: 360,
      height: 800,
      deviceScaleFactor: 1,
      mobile: true,
      screenOrientation: { type: "portraitPrimary", angle: 0 },
    });
    await cdp.call("Page.navigate", { url: baseUrl });
    await waitFor(() => exists(".main-menu"), "mobile hint session reset landing");
    await waitHydrated();
    const portraitMenu = await evaluate(`(() => {
      const root = document.documentElement;
      const hint = document.querySelector('.landscape-hint');
      const visibleButtons = [...document.querySelectorAll('.main-menu button')]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      window.scrollTo(0, root.scrollHeight);
      return {
        horizontalOverflow: root.scrollWidth - root.clientWidth,
        canReachBottom: window.scrollY + innerHeight >= root.scrollHeight - 2,
        minimumButtonHeight: Math.min(...visibleButtons.map((node) => node.getBoundingClientRect().height)),
        landscapeHintAbsent: hint === null,
        versionNotesPresent: Boolean(document.querySelector('.main-menu .version-notes')),
      };
    })()`);
    assert.ok(portraitMenu.horizontalOverflow <= 1, `portrait main menu must not overflow horizontally: ${JSON.stringify(portraitMenu)}`);
    assert.equal(portraitMenu.canReachBottom, true, "portrait main menu must remain vertically reachable");
    assert.ok(portraitMenu.minimumButtonHeight >= 40, `portrait main menu buttons must remain touchable: ${JSON.stringify(portraitMenu)}`);
    assert.equal(portraitMenu.landscapeHintAbsent, true, "landscape suggestion must not cover the portrait main menu");
    assert.equal(portraitMenu.versionNotesPresent, true, "portrait main menu must retain version notes");
    await capture("mobile-main-menu-360x800.png");
    await clickText(".main-menu-actions button", "继续征程");
    await waitSelector(".game-shell");
    for (const viewport of mobileViewports) {
      await cdp.call("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: true,
        screenOrientation: viewport.width < viewport.height ? { type: "portraitPrimary", angle: 0 } : { type: "landscapePrimary", angle: 90 },
      });
      await evaluate("window.scrollTo(0, 0)");
      await delay(300);
      const mobileLayout = await evaluate(`(() => {
        const root = document.documentElement;
        const panel = document.querySelector('.map-panel');
        const map = document.querySelector('.map-field');
        const topbar = document.querySelector('.topbar');
        const brand = document.querySelector('.game-title');
        const resonance = document.querySelector('.resonance-rail');
        const telemetry = document.querySelector('.telemetry-rail');
        const shop = document.querySelector('.shop-grid');
        const bench = document.querySelector('.bench-grid');
        const actionHeights = [...document.querySelectorAll('.shop-actions button,.window-switches>button,.window-switches>.top-info-control>button,.window-switches>.core-health-control button')].map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => rect.height);
        const topbarRect = topbar.getBoundingClientRect();
        const brandRect = brand.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const resonanceRect = resonance.getBoundingClientRect();
        const telemetryRect = telemetry.getBoundingClientRect();
        const mapUnitRects = [...document.querySelectorAll('.map-field .slot.occupied .unit-card')]
          .map((node) => {
            const unitRect = node.getBoundingClientRect();
            return { id: node.dataset.characterId ?? node.textContent.trim(), left: unitRect.left, top: unitRect.top, right: unitRect.right, bottom: unitRect.bottom };
          });
        const mapUnitOverlaps = mapUnitRects.flatMap((first, index) => mapUnitRects.slice(index + 1).flatMap((second) => {
          const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
          const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
          return overlapWidth > 1 && overlapHeight > 1 ? [{ first: first.id, second: second.id, overlapWidth, overlapHeight }] : [];
        }));
        const resonanceLabelOverflow = [...resonance.querySelectorAll('button b')].map((node) => ({
          label: node.textContent.trim(),
          horizontal: node.scrollWidth - node.clientWidth,
          vertical: node.scrollHeight - node.clientHeight,
        }));
        const topControlOverflow = [...document.querySelectorAll('.window-switches>.top-info-control>button,.window-switches>.core-health-control>button,.window-switches>.quick-wave,.window-switches>.quick-combat,.window-switches>.mobile-more-toggle')]
          .filter((node) => {
            const controlRect = node.getBoundingClientRect();
            return controlRect.width > 0 && controlRect.height > 0;
          })
          .map((node) => {
            const controlRect = node.getBoundingClientRect();
            return {
              label: node.textContent.trim(),
              left: controlRect.left,
              right: controlRect.right,
              contentOverflow: node.scrollWidth - node.clientWidth,
              insideTopbar: controlRect.left >= topbarRect.left - 1 && controlRect.right <= topbarRect.right + 1,
              insideViewport: controlRect.left >= -1 && controlRect.right <= innerWidth + 1,
            };
          });
        const topPrimaryLabelOverflow = [...document.querySelectorAll('.window-switches>.top-info-control>button b')]
          .map((node) => ({
            label: node.textContent.trim(),
            overflow: node.scrollWidth - node.clientWidth,
          }));
        const mobileCoreLabel = document.querySelector('.window-switches>.core-health-control .top-core-resource>div b');
        const mobileCoreBar = document.querySelector('.window-switches>.core-health-control .top-core-resource>em');
        const mobileCoreLabelRect = mobileCoreLabel?.getBoundingClientRect();
        const mobileCoreBarRect = mobileCoreBar?.getBoundingClientRect();
        const landscapeHint = document.querySelector('.landscape-hint');
        const drawer = document.querySelector('.economy-deck');
        const benchPanel = bench.closest('.bench');
        const drawerRect = drawer.getBoundingClientRect();
        const benchRect = bench.getBoundingClientRect();
        const benchPanelRect = benchPanel.getBoundingClientRect();
        const mobileShopToggle = document.querySelector('.mobile-shop-toggle');
        const rect = map.getBoundingClientRect();
        window.scrollTo(9999, window.scrollY);
        const globalScrollX = window.scrollX;
        window.scrollTo(0, window.scrollY);
        return {
          documentOverflow: root.scrollWidth - innerWidth,
          globalScrollX,
          mapRatio: rect.width / rect.height,
          mapPanelClient: panel.clientWidth,
          mapPanelScroll: panel.scrollWidth,
          shopClient: shop.clientWidth,
          shopScroll: shop.scrollWidth,
          benchClient: bench.clientWidth,
          benchScroll: bench.scrollWidth,
          minimumBenchSlotWidth: Math.min(...[...bench.querySelectorAll('.slot')].map((node) => node.getBoundingClientRect().width)),
          minimumActionHeight: Math.min(...actionHeights),
          landscapeHintVisible: Boolean(landscapeHint && getComputedStyle(landscapeHint).display !== 'none'),
          landscapeHintText: landscapeHint?.textContent ?? '',
          landscapeHintClass: landscapeHint?.className ?? '',
          landscapeHintDismissed: sessionStorage.getItem('philosophy-auto-chess-landscape-hint-dismissed'),
          portraitMedia: matchMedia('(max-width: 600px) and (orientation: portrait)').matches,
          landscapeMedia: matchMedia('(max-width: 999px) and (orientation: landscape)').matches,
          brandText: brand.textContent ?? '',
          brandVisible: getComputedStyle(brand).display !== 'none' && brandRect.width > 0 && brandRect.height > 0,
          brandInsideTopbar: brandRect.left >= topbarRect.left - 1 && brandRect.right <= topbarRect.right + 1 && brandRect.top >= topbarRect.top - 1 && brandRect.bottom <= topbarRect.bottom + 1,
          topControlOverflow,
          topPrimaryLabelOverflow,
          coreLabelText: mobileCoreLabel?.textContent.trim() ?? '',
          coreLabelOverflow: mobileCoreLabel ? mobileCoreLabel.scrollWidth - mobileCoreLabel.clientWidth : 999,
          coreLabelBarGap: mobileCoreLabelRect && mobileCoreBarRect ? mobileCoreBarRect.left - mobileCoreLabelRect.right : -999,
          coreBarWidth: mobileCoreBarRect?.width ?? 0,
          resonanceVisible: getComputedStyle(resonance).display !== 'none' && resonanceRect.width > 0 && resonanceRect.height > 0,
          telemetryVisible: getComputedStyle(telemetry).display !== 'none' && telemetryRect.width > 0 && telemetryRect.height > 0,
          railsInsidePanel: resonanceRect.left >= panelRect.left - 1 && resonanceRect.right <= panelRect.right + 1 && telemetryRect.left >= panelRect.left - 1 && telemetryRect.right <= panelRect.right + 1,
          railWidths: [resonanceRect.width, telemetryRect.width],
          mapUnitOverlaps,
          resonanceLabelOverflow,
          mapInsideViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
          drawerFixed: getComputedStyle(drawer).position === 'fixed',
          reserveBelowMap: benchRect.top >= panelRect.bottom - 1 && drawerRect.bottom <= innerHeight + 1,
          reserveIntegratedWithMap:
            getComputedStyle(drawer).position === 'fixed'
            && benchPanelRect.top <= panelRect.bottom + 6
            && benchPanelRect.bottom <= innerHeight + 1
            && getComputedStyle(benchPanel.querySelector('.panel-heading')).display === 'none',
          mobileShopToggleVisible: Boolean(mobileShopToggle && mobileShopToggle.getBoundingClientRect().width > 0 && mobileShopToggle.getBoundingClientRect().height > 0),
          shopCardsBound: [...document.querySelectorAll('.shop-card-slot>.shop-card')].every((button) => {
            const buttonRect = button.getBoundingClientRect();
            const slotRect = button.parentElement.getBoundingClientRect();
            return buttonRect.left >= slotRect.left - 2 && buttonRect.right <= slotRect.right + 2 && buttonRect.top >= slotRect.top - 2 && buttonRect.bottom <= slotRect.bottom + 2;
          }),
          shopCardRects: [...document.querySelectorAll('.shop-card-slot>.shop-card')].map((button) => {
            const buttonRect = button.getBoundingClientRect();
            const slotRect = button.parentElement.getBoundingClientRect();
            return { button: [buttonRect.left, buttonRect.top, buttonRect.right, buttonRect.bottom], slot: [slotRect.left, slotRect.top, slotRect.right, slotRect.bottom] };
          }),
          overflowOwners: [...document.querySelectorAll('body *')].filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.right > innerWidth + 1 || rect.left < -1;
          }).slice(0, 12).map((node) => ({ tag: node.tagName, className: String(node.className), left: Math.round(node.getBoundingClientRect().left), right: Math.round(node.getBoundingClientRect().right), width: Math.round(node.getBoundingClientRect().width) })),
        };
      })()`);
      assert.ok(mobileLayout.globalScrollX <= 1, `${viewport.label} must keep horizontal movement inside explicit local scrollers: ${JSON.stringify(mobileLayout)}`);
      assert.equal(mobileLayout.landscapeHintVisible, Boolean(viewport.expectHint), `${viewport.label} must use a dismissible in-game hint instead of a global orientation gate: ${JSON.stringify(mobileLayout)}`);
      if (viewport.expectHint) {
        assert.ok(mobileLayout.landscapeHintText.includes("建议横屏游玩") && mobileLayout.landscapeHintText.includes("竖屏仍可继续"), `portrait hint must be brief and non-blocking: ${JSON.stringify(mobileLayout)}`);
        await click(".landscape-hint button");
        await waitFor(() => evaluate("getComputedStyle(document.querySelector('.landscape-hint')).display === 'none'"), "portrait landscape hint dismissal");
      }
      assert.ok(Math.abs(mobileLayout.mapRatio - 16 / 9) < .02, `${viewport.label} must preserve battle coordinates: ${JSON.stringify(mobileLayout)}`);
      assert.ok(mobileLayout.minimumActionHeight >= 40, `${viewport.label} must retain touchable primary controls: ${JSON.stringify(mobileLayout)}`);
      if (mobileLayout.landscapeMedia) {
        assert.equal(mobileLayout.brandVisible && mobileLayout.brandInsideTopbar && mobileLayout.brandText.includes("往哲荣耀"), true, `${viewport.label} must keep the game identity visible inside the original top bar: ${JSON.stringify(mobileLayout)}`);
        assert.equal(mobileLayout.topControlOverflow.every((control) => control.insideTopbar && control.insideViewport && control.contentOverflow <= 1), true, `${viewport.label} top resources and actions must remain inside their own controls and the visible viewport: ${JSON.stringify(mobileLayout.topControlOverflow)}`);
        assert.equal(mobileLayout.topPrimaryLabelOverflow.every((label) => label.overflow <= 1), true, `${viewport.label} primary resource labels must stay fully readable instead of being clipped inside a valid button: ${JSON.stringify(mobileLayout.topPrimaryLabelOverflow)}`);
        assert.equal(mobileLayout.coreLabelText, "哲人之石", `${viewport.label} must retain the complete philosopher-stone label`);
        assert.ok(mobileLayout.coreLabelOverflow <= 1 && mobileLayout.coreLabelBarGap >= 2, `${viewport.label} philosopher-stone label must clear the health bar without clipping: ${JSON.stringify({ text: mobileLayout.coreLabelText, overflow: mobileLayout.coreLabelOverflow, gap: mobileLayout.coreLabelBarGap })}`);
        assert.ok(mobileLayout.coreBarWidth >= 34, `${viewport.label} philosopher-stone health bar must stay long enough to communicate percentage changes: ${JSON.stringify({ width: mobileLayout.coreBarWidth })}`);
        assert.equal(mobileLayout.resonanceVisible && mobileLayout.telemetryVisible && mobileLayout.railsInsidePanel, true, `${viewport.label} must retain both the resonance and battle-intelligence rails: ${JSON.stringify(mobileLayout)}`);
        assert.ok(mobileLayout.railWidths.every((width) => width >= 70), `${viewport.label} side rails must stay readable instead of collapsing into decorative slivers: ${JSON.stringify(mobileLayout.railWidths)}`);
        assert.deepEqual(mobileLayout.mapUnitOverlaps, [], `${viewport.label} deployed unit cards must not overlap one another: ${JSON.stringify(mobileLayout.mapUnitOverlaps)}`);
        assert.equal(mobileLayout.resonanceLabelOverflow.every((label) => label.horizontal <= 1 && label.vertical <= 1), true, `${viewport.label} resonance names must use their button area instead of being clipped: ${JSON.stringify(mobileLayout.resonanceLabelOverflow)}`);
      }
      if (!mobileLayout.landscapeMedia) {
        assert.ok(mobileLayout.shopScroll > mobileLayout.shopClient, `${viewport.label} must expose readable shop cards through local scrolling: ${JSON.stringify(mobileLayout)}`);
      }
      assert.ok(
        mobileLayout.benchScroll > mobileLayout.benchClient
          || mobileLayout.minimumBenchSlotWidth >= (mobileLayout.landscapeMedia ? 44 : 60),
        `${viewport.label} must scroll the reserve or fit all readable reserve cards: ${JSON.stringify(mobileLayout)}`,
      );
      if (viewport.expectScrollableMap) {
        assert.ok(mobileLayout.mapPanelScroll > mobileLayout.mapPanelClient, `${viewport.label} must pan the tactical canvas instead of shrinking deployment targets: ${JSON.stringify(mobileLayout)}`);
      } else if (viewport.expectFixedDrawer === false) {
        assert.equal(mobileLayout.mapInsideViewport && !mobileLayout.drawerFixed, true, `${viewport.label} must retain the reachable tablet/desktop flow without inheriting the short-landscape drawer: ${JSON.stringify(mobileLayout)}`);
      } else {
        assert.equal(
          mobileLayout.mapInsideViewport
            && mobileLayout.reserveIntegratedWithMap
            && mobileLayout.drawerFixed
            && mobileLayout.mobileShopToggleVisible,
          true,
          `${viewport.label} must integrate the persistent reserve into the battlefield edge with an independent market toggle: ${JSON.stringify(mobileLayout)}`,
        );
      }
      assert.equal(mobileLayout.shopCardsBound, true, `${viewport.label} purchase icons and hit targets must share the same card container: ${JSON.stringify(mobileLayout.shopCardRects)}`);
      await capture(`mobile-${viewport.width}x${viewport.height}.png`);
      if (mobileLayout.landscapeMedia) {
        await click(".mobile-shop-toggle");
        await waitFor(() => evaluate("document.querySelector('.economy-deck')?.classList.contains('mobile-shop-open')"), `${viewport.label} independent mobile shop to open`);
        const mobileShopLayout = await evaluate(`(() => {
          const panel = document.querySelector('.economy-deck>.shop');
          const grid = panel.querySelector('.shop-grid');
          const panelRect = panel.getBoundingClientRect();
          const gridRect = grid.getBoundingClientRect();
          const slots = [...grid.querySelectorAll('.shop-card-slot')].map((slot) => {
            const slotRect = slot.getBoundingClientRect();
            const card = slot.querySelector('.shop-card');
            const cardRect = card?.getBoundingClientRect();
            return {
              left: slotRect.left,
              right: slotRect.right,
              top: slotRect.top,
              bottom: slotRect.bottom,
              cardBound: Boolean(cardRect && cardRect.left >= slotRect.left - 1 && cardRect.right <= slotRect.right + 1 && cardRect.top >= slotRect.top - 1 && cardRect.bottom <= slotRect.bottom + 1),
            };
          });
          const actions = document.querySelector('.shop-actions').getBoundingClientRect();
          return {
            panelInsideViewport: panelRect.left >= 0 && panelRect.right <= innerWidth && panelRect.top >= 0 && panelRect.bottom <= innerHeight,
            slotCount: slots.length,
            slotsInsideGrid: slots.every((slot) => slot.left >= gridRect.left - 1 && slot.right <= gridRect.right + 1 && slot.top >= gridRect.top - 1 && slot.bottom <= gridRect.bottom + 1 && slot.cardBound),
            gridOverflow: grid.scrollWidth - grid.clientWidth,
            actionsInsidePanel: actions.left >= panelRect.left && actions.right <= panelRect.right && actions.top >= panelRect.top && actions.bottom <= panelRect.bottom,
          };
        })()`);
        assert.equal(mobileShopLayout.panelInsideViewport && mobileShopLayout.slotCount === 5 && mobileShopLayout.slotsInsideGrid && mobileShopLayout.gridOverflow <= 1 && mobileShopLayout.actionsInsidePanel, true, `${viewport.label} independent market must show all five cards and all three actions at once: ${JSON.stringify(mobileShopLayout)}`);
        await capture(`mobile-shop-${viewport.width}x${viewport.height}.png`);
        await click(".mobile-shop-toggle");
      }
    }
    for (const viewport of [
      { width: 667, height: 375 },
      { width: 844, height: 390 },
      { width: 932, height: 430 },
    ]) {
      await cdp.call("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: true,
        screenOrientation: { type: "landscapePrimary", angle: 90 },
      });
      await delay(220);
      await capture(`mobile-tactical-${viewport.width}x${viewport.height}.png`);
    }
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
    await reset();
    await applyLineup("", 0, "fichte,locke,aristotle,epicurus,kant");
    const mobilePurchaseStartGold = await evaluate(readGold);
    await click(".mobile-shop-toggle");
    await evaluate("(() => { const card = document.querySelector('.shop-card:not(.shop-card--empty)'); card.click(); card.click(); })()");
    await waitFor(() => evaluate("document.querySelectorAll('.bench-grid .slot.occupied').length === 1"), "mobile purchase to enter the reserve");
    assert.equal(mobilePurchaseStartGold - await evaluate(readGold), 1, "a rapid double tap on one one-cost shop card must purchase exactly once");
    await click(".mobile-shop-toggle");
    await capture("mobile-reserve-occupied-844x390.png");
    await click(".bench-grid .slot.occupied .unit-card");
    assert.equal(await exists(".mobile-selection-bar"), true, "tap selection must expose explicit mobile movement and sale actions");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
    await delay(250);
    assert.equal(await evaluate("Boolean(document.querySelector('.bench-grid .slot.selected')) && Boolean(document.querySelector('.mobile-selection-bar')) && getComputedStyle(document.querySelector('.landscape-hint')).display === 'none'"), true, "rotation must preserve selection while respecting the session-dismissed hint");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
    await delay(250);
    await click('[data-slot="deploy-1"]');
    await waitFor(() => evaluate("document.querySelector('[data-slot=\"deploy-1\"] .unit-card')?.dataset.characterId === 'fichte'"), "tap-selected mobile piece to deploy");
    assert.equal(await evaluate("document.querySelectorAll('.bench-grid .slot.occupied').length"), 0, "tap deployment must remove the purchased piece from reserve");
    await waitFor(() => evaluate("JSON.parse(localStorage.getItem('idea-garrison-v01-save-v6')).pieces.some((piece) => piece.characterId === 'fichte' && piece.slotId === 'deploy-1')"), "mobile deployed state to reach stable autosave");
    await cdp.call("Page.navigate", { url: baseUrl });
    await waitFor(() => exists(".main-menu"), "mobile refresh to return to the main menu");
    await waitHydrated();
    await clickText(".main-menu-actions button", "继续征程");
    await waitFor(() => evaluate("document.querySelector('[data-slot=\"deploy-1\"] .unit-card')?.dataset.characterId === 'fichte'"), "mobile refresh to restore the deployed save");
    await click('[data-slot="deploy-1"] .unit-card');
    await clickText(".mobile-selection-bar button", "撤回");
    await waitFor(() => evaluate("document.querySelectorAll('.bench-grid .slot.occupied').length === 1"), "explicit mobile withdraw action");
    const beforeMobileSale = await evaluate(readGold);
    await click(".bench-grid .slot.occupied .unit-card");
    await click(".mobile-selection-bar .danger");
    assert.equal(await evaluate("document.querySelectorAll('.bench-grid .slot.occupied').length"), 1, "the first mobile sale tap must only arm the confirmation");
    await click(".mobile-selection-bar .danger.armed");
    await waitFor(() => evaluate("document.querySelectorAll('.bench-grid .slot.occupied').length === 0"), "confirmed mobile sale");
    assert.equal(await evaluate(readGold), beforeMobileSale + 1, "mobile sale confirmation must settle exactly once");
    await applyLineup("", 0, "fichte,locke,aristotle,epicurus,kant");
    await click(".mobile-shop-toggle");
    await click(".shop-card:not(.shop-card--empty)");
    await click(".mobile-shop-toggle");
    await click(".bench-grid .slot.occupied .unit-card");
    await click('[data-slot="deploy-1"]');
    await click(".mobile-more-toggle");
    await clickText(".mobile-more-menu button", "设置与存档");
    assert.equal(await exists(".settings-dialog"), true, "landscape phone must open the settings panel");
    await capture("mobile-settings-844x390.png");
    await click(".settings-dialog>header button");
    await click(".quick-wave");
    await waitSelector(".quick-combat");
    assert.equal(await evaluate("document.querySelectorAll('.quick-combat').length"), 2, "landscape phone must expose pause and speed controls after starting combat");
    await click(".quick-combat");
    await capture("mobile-landscape-playable-844x390.png");

    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 667, height: 375, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
    await loadHistoricalScenario(3, { eventId: "event:reformation", eventPresented: false, eventResolved: false, reformationCandidates: undefined, reformationChosenId: undefined });
    const mobileHistory = await evaluate(`(() => {
      const dialog = document.querySelector('.historical-decision-dialog');
      const rect = dialog.getBoundingClientRect();
      const button = dialog.querySelector('[data-historical-action="confirm-event"]').getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, buttonHeight: button.height, scrollable: dialog.scrollHeight <= dialog.clientHeight + 1 || ['auto','scroll'].includes(getComputedStyle(dialog).overflowY) };
    })()`);
    assert.ok(mobileHistory.left >= 0 && mobileHistory.top >= 0 && mobileHistory.right <= 667 && mobileHistory.bottom <= 375 && mobileHistory.buttonHeight >= 40 && mobileHistory.scrollable, `historical decision must remain fully operable in compact landscape: ${JSON.stringify(mobileHistory)}`);
    await capture("mobile-historical-event-667x375.png");
    await click('[data-historical-action="confirm-event"]');
    await waitFor(() => evaluate("document.querySelectorAll('.historical-choice-grid [data-historical-choice]').length === 3"), "mobile reformation candidates");
    const mobileChoices = await evaluate("[...document.querySelectorAll('.historical-choice-grid [data-historical-choice]')].every((button) => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && rect.height >= 44; })");
    assert.equal(mobileChoices, true, "all mobile historical reward choices must stay inside the viewport with touchable targets");
    await capture("mobile-historical-reward-667x375.png");
    await click(".historical-choice-grid [data-historical-choice]");

    const pwaState = await evaluate(`(async () => {
      const manifestLink = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
      const manifest = manifestLink ? await fetch(manifestLink).then((response) => response.json()) : null;
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/') : null;
      return {
        manifestLink,
        name: manifest?.name,
        display: manifest?.display,
        iconSizes: manifest?.icons?.map((icon) => icon.sizes) ?? [],
        appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content'),
        serviceWorkerScript: registration?.active?.scriptURL ?? registration?.waiting?.scriptURL ?? registration?.installing?.scriptURL ?? '',
      };
    })()`);
    assert.equal(pwaState.name, "往哲荣耀 / Philosophy Auto Chess");
    assert.equal(pwaState.display, "standalone");
    assert.deepEqual(pwaState.iconSizes, ["192x192", "512x512"]);
    assert.equal(pwaState.appleCapable, "yes");
    assert.ok(pwaState.serviceWorkerScript.endsWith("/sw.js"), `PWA service worker must register without caching game HTML: ${JSON.stringify(pwaState)}`);
    await cdp.call("Page.navigate", { url: baseUrl });
    await waitFor(() => evaluate("navigator.serviceWorker?.controller?.scriptURL?.endsWith('/sw.js')"), "PWA page to become controlled after reload");
    const serviceWorkerTarget = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json/list`);
      const targets = await response.json();
      return targets.find((item) => item.type === "service_worker" && item.url.endsWith("/sw.js") && item.webSocketDebuggerUrl);
    }, "service-worker debugging target");
    const serviceWorkerCdp = await connectCdp(serviceWorkerTarget.webSocketDebuggerUrl);
    await cdp.call("Network.enable");
    await serviceWorkerCdp.call("Network.enable");
    await cdp.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await serviceWorkerCdp.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    try {
      await cdp.call("Page.navigate", { url: baseUrl });
      await waitFor(() => evaluate("document.body?.textContent?.includes('思想暂时离线')"), "service-worker offline startup fallback");
      assert.equal(await evaluate("document.documentElement.lang"), "zh-CN", "offline startup fallback must keep the Chinese app context");
      await capture("mobile-pwa-offline-667x375.png");
    } finally {
      await cdp.call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await serviceWorkerCdp.call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      serviceWorkerCdp.close();
    }
    console.log("Browser interactions passed: desktop regression plus six mobile viewports, dismissible portrait hint, bottom drawer, rapid-tap guards, tap deploy/withdraw/sell, resize recovery, history, settlement, PWA registration and offline startup fallback.");
    console.log(`Screenshot: ${path.join(artifacts, "browser-interactions-1920x1080.png")}`);
    console.log(`Boss screenshot: ${path.join(artifacts, "boss-encounter-1920x1080.png")}`);
    console.log(`Map review screenshots: ${artifacts}`);
  } catch (error) {
    if (serverLog) console.error(serverLog.slice(-4000));
    throw error;
  } finally {
    cdp?.close();
    chrome?.kill();
    chrome?.unref();
    server.kill();
    server.stdout.destroy();
    server.stderr.destroy();
    server.unref();
    await delay(250);
    await rm(userData, { recursive: true, force: true });
  }
}

await main();
