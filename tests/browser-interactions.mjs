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
    }, "vinext development server");

    chrome = spawn(chromePath, [
      "--headless=new",
      "--disable-gpu",
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
    const applyLineup = async (lineup, pendingResearch = 0) => {
      if (!(await exists(".developer-tools"))) {
        await click(".settings-button");
        await waitSelector(".developer-tools");
      }
      await evaluate("document.querySelector('.developer-tools').open = true");
      await setValue('[data-debug="lineup"]', lineup);
      await setValue('[data-debug="pending-research"]', pendingResearch);
      await click('[data-debug="apply"]');
      await click(".settings-button");
    };

    await cdp.call("Page.navigate", { url: baseUrl });
    await waitFor(() => existsAny(".landing .primary", ".game-shell"), "initial app shell");
    await reset();

    const openingExperience = await evaluate(`(() => { const button = document.querySelector('.shop-actions button:first-child'); return { disabled: button?.disabled, text: button?.textContent }; })()`);
    assert.equal(openingExperience.disabled, true, "experience purchase must stay locked during the teaching wave");
    assert.ok(openingExperience.text?.includes("W2"), "the experience control must explain when it unlocks");

    const readGold = "Number([...document.querySelectorAll('.command-resources span')].find((item) => item.querySelector('small')?.textContent === '金币')?.querySelector('b')?.textContent.replace(/\\D/g, '') ?? 0)";
    const initialGold = await evaluate(readGold);
    await click(".shop-card:not(.shop-card--empty)");
    await waitSelector('.bench .unit-card');
    const purchasedGold = await evaluate(readGold);
    assert.ok(purchasedGold < initialGold, "purchase must spend gold");

    const openingDeploySlot = await evaluate("document.querySelector('.bench .slot.terrain-highland') ? 'deploy-13' : 'deploy-1'");
    await click('.bench .unit-card');
    await click(`[data-slot="${openingDeploySlot}"]`);
    await waitSelector(`[data-slot="${openingDeploySlot}"] .unit-card`);
    await click(`[data-slot="${openingDeploySlot}"] .unit-card`);
    await click('[data-slot="bench-1"]');
    await waitSelector('[data-slot="bench-1"] .unit-card');
    await click('[data-slot="bench-1"] .unit-card');
    await click(`[data-slot="${openingDeploySlot}"]`);

    await evaluate(`(() => { const source = document.querySelector('[data-slot="${openingDeploySlot}"] .unit-card'); const transfer = new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer })); window.__ideaDragData = transfer; })()`);
    await waitSelector(".shop--sell-target");
    const placementGuidance = await evaluate(`(() => { const slots = [...document.querySelectorAll('.map-field.is-dragging .deploy-grid>.slot.drop-allowed')]; const emptySlot = document.querySelector('.map-field.is-dragging .deploy-grid>.slot.drop-allowed:not(.occupied)'); const marker = emptySlot && getComputedStyle(emptySlot, '::before'); const gridMarker = document.querySelector('.operation-grid .map-tile.drop-allowed'); return { count: slots.length, display: marker?.display, borderWidth: marker?.borderTopWidth, gridOpacity: gridMarker ? getComputedStyle(gridMarker).opacity : '0' }; })()`);
    assert.ok(placementGuidance.count >= 8, "dragging must expose every legal frozen deployment anchor");
    assert.equal(placementGuidance.display, "block", "legal deployment anchors need a visible marker");
    assert.equal(placementGuidance.borderWidth, "1px", "placement guidance should use a restrained metallic mask rather than an oversized glow");
    assert.equal(placementGuidance.gridOpacity, "0", "the imprecise 16x10 placement overlay must stay hidden");
    await capture("placement-highlight-1920x1080.png");
    await evaluate(`(() => { const target = document.querySelector('.shop--sell-target'); const transfer = window.__ideaDragData; target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })); target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); })()`);
    await waitFor(async () => !(await exists(`[data-slot="${openingDeploySlot}"] .unit-card`)), "dragged unit to be sold");
    const soldGold = await evaluate(readGold);
    assert.ok(soldGold > purchasedGold, "selling any one-star piece must visibly add gold");

    await click(".shop-card:not(.shop-card--empty)");
    const secondDeploySlot = await evaluate("document.querySelector('.bench .slot.terrain-highland') ? 'deploy-13' : 'deploy-1'");
    await click(".bench .unit-card");
    await click(`[data-slot="${secondDeploySlot}"]`);
    await click(".start-wave");
    await waitSelector(".tempo-controls");

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
    await click(".start-wave");
    await waitSelector(".royal-barrier");
    await capture("philosopher-king-barrier-1920x1080.png");
    const royalBarrier = await evaluate(`(() => ({ king: document.querySelector('[data-slot="throne-1"] .unit-name strong')?.textContent?.trim(), label: document.querySelector('.royal-barrier b')?.textContent?.trim(), hp: document.querySelector('.royal-barrier')?.textContent }))()`);
    assert.equal(royalBarrier.king, "苏格拉底", "the chosen philosopher king must remain visibly seated during combat");
    assert.equal(royalBarrier.label, "王城屏障", "the wave must visibly create the royal barrier");
    assert.ok(royalBarrier.hp?.includes("耐久"), "the royal barrier must expose its durability");

    const mapSize = await evaluate(`(() => { const rect = document.querySelector('.map-field').getBoundingClientRect(); return { width: rect.width, height: rect.height }; })()`);
    assert.ok(mapSize.width > 0 && mapSize.height > 0, "map must retain measurable browser geometry");
    const commandLayout = await evaluate(`(() => { const rail = document.querySelector('.economy').getBoundingClientRect(); const wave = document.querySelector('.command-wave-panel').getBoundingClientRect(); const resources = document.querySelector('.command-resources').getBoundingClientRect(); return { railTop: rail.top, railBottom: rail.bottom, waveTop: wave.top, resourceBottom: resources.bottom, waveHeight: wave.height, resourcesHeight: resources.height, resonanceOverflow: getComputedStyle(document.querySelector('.resonance-rail>div')).overflowY }; })()`);
    assert.ok(Math.abs(commandLayout.railTop - commandLayout.waveTop) <= 2 && Math.abs(commandLayout.railBottom - commandLayout.resourceBottom) <= 2, "wave and resource instruments must fill the right command rail");
    assert.ok(commandLayout.waveHeight > 0 && commandLayout.resourcesHeight > 0, "both right-rail instruments must remain visible");
    assert.equal(commandLayout.resonanceOverflow, "auto", "the lineup resonance rail must accept wheel scrolling");
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(artifacts, "browser-interactions-1920x1080.png"), Buffer.from(screenshot.data, "base64"));

    await reset();
    await click(".settings-button");
    await waitSelector(".developer-tools");
    await evaluate("document.querySelector('.developer-tools').open = true");
    await clickText(".developer-actions button", "生成 W10 绝对精神");
    await click(".settings-button");
    await waitSelector(".boss-health-display");
    await waitSelector(".enemy-token.boss");
    const bossPresentation = await evaluate(`(() => { const token = document.querySelector('.enemy-token.boss').getBoundingClientRect(); const health = document.querySelector('.boss-health-display').getBoundingClientRect(); return { tokenWidth: token.width, healthWidth: health.width, label: document.querySelector('.boss-name')?.textContent?.trim() }; })()`);
    assert.ok(bossPresentation.tokenWidth >= 110, "Boss token must be visibly larger than ordinary enemies");
    assert.ok(bossPresentation.healthWidth >= 420, "Boss encounter must expose a wide independent health bar");
    assert.equal(bossPresentation.label, "绝对精神", "Boss token may only show its name below the piece");
    const bossScreenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(artifacts, "boss-encounter-1920x1080.png"), Buffer.from(bossScreenshot.data, "base64"));

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
    normalized1920.forEach((point, index) => { assert.ok(Math.abs(point.x - normalized1366[index].x) < .002 && Math.abs(point.y - normalized1366[index].y) < .002, `slot ${index + 1} must retain normalized coordinates across resolutions`); });
    await capture("map-stress-1366x768.png");
    console.log("Browser interactions passed: purchase, deploy, withdraw, drag-to-shop sale, start wave, France node, British research, Enlightenment agenda.");
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
