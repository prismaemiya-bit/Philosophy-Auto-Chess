import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(packageRoot, "dist", "client");
const workerPath = join(packageRoot, "dist", "server", "index.js");
const releaseInfo = JSON.parse(await readFile(join(packageRoot, "release-info.json"), "utf8"));
const host = "127.0.0.1";
const port = Number(process.env.IDEA_GARRISON_PORT ?? 32108);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"], [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"], [".woff", "font/woff"], [".woff2", "font/woff2"],
]);

await access(workerPath);
const { default: worker } = await import(`${new URL(`file:///${workerPath.replaceAll("\\", "/")}`).href}?demo=1`);

function assetPath(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
  const candidate = normalize(join(clientRoot, pathname));
  return relative(clientRoot, candidate).startsWith("..") ? null : candidate;
}

async function fetchAsset(request) {
  const filePath = assetPath(request);
  if (!filePath) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(filePath);
    return new Response(body, { headers: { "content-type": mimeTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.url === "/__idea_garrison_health") {
      outgoing.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ app: "philosophy-auto-chess", version: releaseInfo.versionId, developer: releaseInfo.developer }));
      return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const method = incoming.method ?? "GET";
    const request = new Request(`http://${host}:${port}${incoming.url ?? "/"}`, {
      method,
      headers: incoming.headers,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const assetResponse = method === "GET" || method === "HEAD" ? await fetchAsset(request) : new Response("Not found", { status: 404 });
    const response = assetResponse.status !== 404
      ? assetResponse
      : await worker.fetch(request, { ASSETS: { fetch: fetchAsset } }, { waitUntil() {}, passThroughOnException() {} });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    outgoing.end("往哲荣耀启动失败，请查看此窗口中的错误信息。");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用。请关闭旧的往哲荣耀窗口后重试。`);
  } else console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/`;
  console.log(`${releaseInfo.productName} ${releaseInfo.displayVersion} · ${releaseInfo.developer} 已启动：${url}`);
  if (process.argv.includes("--open")) {
    const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  }
});
