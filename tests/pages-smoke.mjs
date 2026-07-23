import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const previewPort = Number(process.env.PAGES_PREVIEW_PORT ?? 43191);
const debugPort = previewPort + 1000;
const baseUrl = `http://127.0.0.1:${previewPort}/Philosophy-Auto-Chess/`;
const chromePath = process.env.CHROME_PATH
  ?? (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/google-chrome");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(check, description, timeout = 30_000) {
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
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  return {
    call(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
    onEvent(listener) { listeners.add(listener); },
    close() { socket.close(); },
  };
}

const userData = await mkdtemp(path.join(tmpdir(), "philosophy-pages-chrome-"));
const preview = spawn(process.execPath, [
  path.join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview",
  "--config",
  "vite.pages.config.ts",
  "--host",
  "127.0.0.1",
  "--port",
  String(previewPort),
  "--strictPort",
], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let previewLog = "";
preview.stdout.on("data", (chunk) => { previewLog += String(chunk); });
preview.stderr.on("data", (chunk) => { previewLog += String(chunk); });
let chrome;
let cdp;

try {
  await waitFor(async () => (await fetch(baseUrl)).ok, "GitHub Pages preview");
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userData}`,
    "--window-size=1920,1080",
    "about:blank",
  ], { stdio: "ignore" });
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    return (await response.json()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  }, "Chrome DevTools endpoint");
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  const failedRequests = [];
  cdp.onEvent((message) => {
    if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
      failedRequests.push(`${message.params.response.status} ${message.params.response.url}`);
    }
    if (message.method === "Network.loadingFailed" && !message.params.canceled) {
      failedRequests.push(`${message.params.errorText} ${message.params.requestId}`);
    }
  });
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  const evaluate = async (expression) => {
    const response = await cdp.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  const exists = (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);

  await cdp.call("Page.navigate", { url: `${baseUrl}?ui=desktop` });
  await waitFor(() => exists(".main-menu"), "desktop main menu");
  assert.equal(await evaluate("document.documentElement.dataset.gameUi"), "desktop");
  assert.equal(await evaluate("document.querySelector('.main-menu h1')?.textContent"), "往哲荣耀");
  await waitFor(() => evaluate(`(() => {
    const button = document.querySelector(".main-menu .primary");
    return Boolean(button && Object.keys(button).some((key) => key.startsWith("__reactProps")));
  })()`), "desktop React hydration");
  assert.equal(await evaluate(`(() => {
    document.querySelector(".main-menu .primary")?.click();
    return true;
  })()`), true);
  await waitFor(() => exists(".game-shell"), "desktop game shell");
  await waitFor(() => evaluate(`[...document.querySelectorAll(".shop-card img")].some((image) => image.complete && image.naturalWidth > 0)`), "shop portraits");
  await delay(500);
  assert.deepEqual(failedRequests, [], `failed page assets: ${failedRequests.join(", ")}`);

  await cdp.call("Page.navigate", { url: `${baseUrl}?ui=mobile` });
  await waitFor(() => exists(".main-menu"), "mobile main menu");
  assert.equal(await evaluate("document.documentElement.dataset.gameUi"), "mobile");
  console.log("GitHub Pages smoke passed: desktop and mobile UI render with no failed assets.");
} catch (error) {
  console.error(previewLog.slice(-4000));
  throw error;
} finally {
  cdp?.close();
  chrome?.kill();
  preview.kill();
  await delay(300);
  await rm(userData, { recursive: true, force: true });
}
