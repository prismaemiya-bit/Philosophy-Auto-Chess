import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const releaseZip = path.join(root, "release", "philosophy-auto-chess-v0.1-demo-windows-portable.zip");
const chromePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = Number(process.env.IDEA_GARRISON_RELEASE_PORT ?? 42108);
const remotePort = port + 1000;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(check, description, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0; const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)); const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  return { call(method, params = {}) { const requestId = ++id; socket.send(JSON.stringify({ id: requestId, method, params })); return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject })); }, close() { socket.close(); } };
}

function startPackagedServer(packageRoot) {
  const child = spawn("cmd.exe", ["/d", "/c", "start-game.cmd"], {
    cwd: packageRoot,
    env: { ...process.env, IDEA_GARRISON_FOREGROUND: "1", IDEA_GARRISON_PORT: String(port) },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; child.stdout.on("data", (chunk) => { log += String(chunk); }); child.stderr.on("data", (chunk) => { log += String(chunk); });
  return { child, getLog: () => log };
}

function stopTree(child) {
  if (!child?.pid) return;
  try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
}

async function main() {
  await readFile(releaseZip);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "往哲荣耀 Demo 烟雾测试 "));
  const packageRoot = path.join(tempRoot, "解压目录 含 空格");
  const userData = path.join(tempRoot, "全新 Chrome 用户目录");
  await mkdir(packageRoot, { recursive: true });
  execFileSync("tar.exe", ["-xf", releaseZip, "-C", packageRoot], { stdio: "inherit", windowsHide: true });

  let server = startPackagedServer(packageRoot); let chrome; let cdp;
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/__idea_garrison_health`)).ok, "packaged production server");
    chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${remotePort}`, `--user-data-dir=${userData}`, "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
    const target = await waitFor(async () => { const response = await fetch(`http://127.0.0.1:${remotePort}/json/list`); return (await response.json()).find((item) => item.type === "page" && item.webSocketDebuggerUrl); }, "fresh Chrome profile");
    cdp = await connectCdp(target.webSocketDebuggerUrl); await cdp.call("Page.enable"); await cdp.call("Runtime.enable");
    const evaluate = async (expression) => { const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
    const exists = (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const click = async (selector) => { const found = await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item) return false; item.click(); return true; })()`); assert.equal(found, true, `missing ${selector}`); await delay(180); };
    const url = `http://127.0.0.1:${port}/?devtools=1`;
    await cdp.call("Page.navigate", { url }); await waitFor(() => exists(".landing .primary"), "new-game landing");
    assert.equal(await evaluate("document.querySelector('.landing h1')?.textContent?.trim()"), "欢迎来到往哲荣耀");
    assert.equal(await evaluate("document.querySelector('.landing .primary')?.textContent?.replace('→', '')?.trim()"), "开始往哲荣耀");
    assert.equal(await evaluate("localStorage.length"), 0, "portable package must start without bundled local save data");
    await waitFor(() => evaluate(`(() => { const button = document.querySelector('.landing .primary'); return Boolean(button && Object.keys(button).some((key) => key.startsWith('__reactProps'))); })()`), "production React hydration");
    await click(".landing .primary"); await waitFor(() => exists(".game-shell"), "game shell");
    assert.equal(await exists(".developer-tools"), false, "production build must hide cheat tools even with ?devtools=1");
    assert.equal(await exists(".map-debug-overlay"), false, "production build must hide calibration layers");
    await click(".settings-button"); await waitFor(() => exists(".feedback-tools"), "production feedback tools"); await click(".settings-button");

    for (let index = 0; index < 2; index += 1) {
      await click(".shop-card:not(.shop-card--empty)");
      await waitFor(() => exists(".bench .unit-card"), "purchased bench unit");
      await click(".bench .unit-card");
      await waitFor(() => exists(".deploy-grid .slot.drop-allowed:not(.occupied)"), "empty legal deployment tile");
      await click(".deploy-grid .slot.drop-allowed:not(.occupied)");
    }
    assert.equal(await evaluate("document.querySelectorAll('.deploy-grid .slot.occupied').length"), 2, "two units must deploy");
    await click(".start-wave"); await waitFor(() => exists(".tempo-controls"), "wave one combat");
    if (await exists(".tempo-button.speed")) await click(".tempo-button.speed");
    await waitFor(() => evaluate(`(() => { const raw = localStorage.getItem('idea-garrison-v01-save-v6'); return raw ? JSON.parse(raw).wave >= 2 : false; })()`), "successful wave one settlement", 120_000);
    const saved = await evaluate("localStorage.getItem('idea-garrison-v01-save-v6')");
    assert.ok(saved?.includes('"saveVersion":6'), "wave progress must persist as V6");
    const beforeRestart = JSON.parse(saved);

    await cdp.call("Browser.close"); cdp.close(); cdp = undefined;
    await delay(1500); stopTree(chrome); chrome = undefined; stopTree(server.child);
    await delay(600);
    server = startPackagedServer(packageRoot);
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/__idea_garrison_health`)).ok, "restarted packaged server");
    chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${remotePort}`, `--user-data-dir=${userData}`, "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
    const restartedTarget = await waitFor(async () => { const response = await fetch(`http://127.0.0.1:${remotePort}/json/list`); return (await response.json()).find((item) => item.type === "page" && item.webSocketDebuggerUrl); }, "restarted Chrome profile");
    cdp = await connectCdp(restartedTarget.webSocketDebuggerUrl); await cdp.call("Page.enable"); await cdp.call("Runtime.enable");
    const evaluateRestarted = async (expression) => { const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return result.result.value; };
    await cdp.call("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await waitFor(() => evaluateRestarted("Boolean(document.querySelector('.game-shell'))"), "continued saved game after full restart");
    const afterRestart = JSON.parse(await evaluateRestarted("localStorage.getItem('idea-garrison-v01-save-v6')"));
    assert.equal(afterRestart.saveVersion, 6); assert.deepEqual(afterRestart.pieces, beforeRestart.pieces); assert.equal(afterRestart.wave, beforeRestart.wave);
    console.log("Demo release smoke passed: clean unzip, relative Unicode path, production gates, purchase, deploy, wave, close, restart and V6 continuation.");
  } catch (error) {
    console.error(server.getLog().slice(-4000)); throw error;
  } finally {
    cdp?.close(); stopTree(chrome); stopTree(server.child); await delay(300); await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
