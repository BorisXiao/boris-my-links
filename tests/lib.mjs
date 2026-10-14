/* 测试基础设施：启动本地静态服务器 + 无头 Chrome，通过 CDP 驱动页面。
   零依赖：用 Node 内置 http / WebSocket（Node 22+ 提供全局 WebSocket）。 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  process.env.CHROME_PATH || ""
];

export function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error("找不到 Chrome/Chromium。请设置环境变量 CHROME_PATH 指向可执行文件。");
}

/* ── 极简静态服务器（MIME 只需覆盖 json/svg/html）── */
export function serve(rootDir = ROOT) {
  const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".js": "text/javascript; charset=utf-8"
  };
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(rootDir, rel);
    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}/`, close: () => server.close() });
    });
  });
}

/* ── 一个受控的浏览器实例 ── */
export async function launch(port = 0) {
  const dbgPort = port || (9400 + Math.floor(Math.random() * 400));
  const udd = fs.mkdtempSync("/tmp/yiyi-test-");
  const chrome = spawn(findChrome(), [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--remote-debugging-port=" + dbgPort, "--user-data-dir=" + udd, "about:blank"
  ]);
  const get = p => new Promise((res, rej) =>
    http.get({ host: "127.0.0.1", port: dbgPort, path: p }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res(JSON.parse(d)));
    }).on("error", rej));

  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await get("/json/list"); if (list.find(t => t.type === "page")) break; } catch (e) {}
    await sleep(150);
  }
  const sock = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errors = []; const failedReqs = [];
  sock.addEventListener("message", ev => {
    const o = JSON.parse(ev.data);
    if (pend.has(o.id)) pend.get(o.id)(o);
    if (o.method === "Runtime.exceptionThrown") {
      const d = o.params.exceptionDetails;
      errors.push((d.exception && d.exception.description || d.text || "").slice(0, 200));
    }
    if (o.method === "Network.responseReceived" && o.params.response.status >= 400) {
      failedReqs.push({ status: o.params.response.status, url: o.params.response.url });
    }
    if (o.method === "Network.loadingFailed") {
      failedReqs.push({ status: "FAILED:" + o.params.errorText, url: "(unknown)" });
    }
  });
  await new Promise(r => sock.addEventListener("open", r));
  const send = (m, p = {}) => new Promise(r => {
    const i = ++id; pend.set(i, r);
    sock.send(JSON.stringify({ id: i, method: m, params: p }));
  });

  const api = {
    chrome, sock, send, errors, failedReqs,
    async enable(viewport = { width: 1400, height: 900, scale: 1 }) {
      await send("Runtime.enable"); await send("Network.enable"); await send("Log.enable"); await send("Page.enable");
      await send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width, height: viewport.height,
        deviceScaleFactor: viewport.scale || 1, mobile: !!viewport.mobile
      });
    },
    async goto(url, waitMs = 6000) { await send("Page.navigate", { url }); await sleep(waitMs); },
    /* js(expr, awaitPromise) —— 求值；异常不抛出而是返回字符串，便于断言 */
    async js(expr, awaitPromise = false) {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
      if (r.result && r.result.exceptionDetails) {
        const d = r.result.exceptionDetails;
        return "ERR:" + ((d.exception && d.exception.description) || d.text || "").slice(0, 200);
      }
      return r.result.result.value;
    },
    /* 等页面渲染完成：卡片渲染出来且骨架屏已移除 */
    async ready(timeout = 12000) {
      return waitFor(async () =>
        (await this.js("document.querySelectorAll('a.card').length")) > 0 &&
        (await this.js("!document.getElementById('skeleton')")), { timeout });
    },
    /* 等弹窗内容真正构建完成（openModal 里 buildBody 是同步的，
       但点击到执行之间存在一帧间隙，直接断言会假失败） */
    async modalReady(timeout = 6000) {
      return waitFor(async () =>
        (await this.js("document.getElementById('mask').classList.contains('show')")) &&
        (await this.js("document.querySelectorAll('#modalBody input, #modalBody textarea').length")) > 0,
        { timeout });
    },
    async shot(file) {
      const s = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(s.result.data, "base64"));
    },
    async close() { try { sock.close(); } catch (e) {} chrome.kill(); }
  };
  return api;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 轮询等待条件成立。避免用固定 sleep 猜时序 —— 这是测试里最容易出现的假失败源。 */
export async function waitFor(fn, { timeout = 6000, interval = 120 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(interval);
  }
}

/* ── 断言与统计 ── */
export function createSuite(name) {
  let pass = 0, fail = 0; const failures = [];
  return {
    name,
    ok(label, cond, extra) {
      if (cond) { pass++; console.log(`  ✓ ${label}${extra ? "  " + extra : ""}`); }
      else { fail++; failures.push(label); console.log(`  ✗ ${label}${extra ? "  " + extra : ""}`); }
      return !!cond;
    },
    eq(label, actual, expected, extra) {
      return this.ok(label, actual === expected, `(实得 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)})${extra ? " " + extra : ""}`);
    },
    section(t) { console.log(`\n${t}`); },
    get pass() { return pass; },
    get fail() { return fail; },
    get failures() { return failures; },
    summary() {
      console.log(`\n  ${pass} 通过 / ${fail} 失败`);
      if (fail) { console.log("  失败项:"); failures.forEach(f => console.log("    - " + f)); }
      return fail === 0;
    }
  };
}
