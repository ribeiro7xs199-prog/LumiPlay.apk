// Bancada de testes: servidor estático (com a CSP real do _headers) + Chromium + TMDB/Supabase simulados.
// Rode a partir da pasta tests/ (veja tests/README.md).
const http = require("http"), fs = require("fs"), path = require("path");
process.chdir(__dirname);
fs.mkdirSync(path.join(__dirname, "shots"), {recursive: true});
const { chromium } = require("playwright");
const mock = require("./mock.js");

const ROOT = process.env.SITE_ROOT || path.resolve(__dirname, "..");
const HEADERS_FILE = process.env.HEADERS_FILE || path.join(ROOT, "_headers");
const MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".txt": "text/plain"};

function readCSP() {
  try { const m = fs.readFileSync(HEADERS_FILE, "utf8").match(/Content-Security-Policy:\s*(.+)/); return m ? m[1].trim() : ""; } catch (_) { return ""; }
}

function startServer(port = 4173) {
  const csp = readCSP();
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, {"content-type": "text/plain"}); res.end("404"); return; }
    const headers = {"content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store"};
    if (csp && p.endsWith(".html")) headers["content-security-policy"] = csp;
    res.writeHead(200, headers); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve(server)));
}

async function launch(options = {}) {
  const server = await startServer(options.port || 4173);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: options.viewport || {width: 1440, height: 900},
    deviceScaleFactor: options.dpr || 1,
    isMobile: Boolean(options.mobile), hasTouch: Boolean(options.mobile),
    userAgent: options.userAgent,
    reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
    locale: "pt-BR", timezoneId: "America/Maceio",
  });
  // O hardware do sandbox é modesto; por padrão simulamos um aparelho comum (8 núcleos / 8 GB).
  await context.addInitScript(hw => {
    Object.defineProperty(navigator, "hardwareConcurrency", {get: () => hw.cores});
    Object.defineProperty(navigator, "deviceMemory", {get: () => hw.memory});
  }, options.lowPower ? {cores: 2, memory: 2} : {cores: 8, memory: 8});
  const sb = options.supabase === false ? null : (options.sbConfig || {tables: {}});
  if (sb) await context.addInitScript(cfg => { window.__SB__ = cfg; }, sb);
  const requests = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") {
      if (options.blockCatalogJson && url.pathname === "/data/catalog.json") return route.fulfill({status: 404, body: "nope"});
      return route.continue();
    }
    requests.push(url.href);
    if (url.hostname === "api.themoviedb.org" && options.tmdbStatus) return route.fulfill({status: options.tmdbStatus, contentType: "application/json", headers: {"access-control-allow-origin": "*"}, body: "{}"});
    if (url.hostname === "api.themoviedb.org" && options.tmdbNoTrending && /trending/.test(url.pathname)) return route.fulfill({status: 200, contentType: "application/json", headers: {"access-control-allow-origin": "*"}, body: JSON.stringify({page: 1, results: [], total_pages: 0})});
    if (url.hostname === "api.themoviedb.org") {
      const data = mock.tmdbResponse(url.pathname.replace(/^\/3\//, ""), url.searchParams);
      if (options.tmdbDelay) return setTimeout(() => route.fulfill({status: data ? 200 : 404, contentType: "application/json", body: JSON.stringify(data || {})}), options.tmdbDelay);
      return route.fulfill({status: data ? 200 : 404, contentType: "application/json", headers: {"access-control-allow-origin": "*"}, body: JSON.stringify(data || {})});
    }
    if (url.hostname === "image.tmdb.org") return route.fulfill({status: 200, contentType: "image/svg+xml", body: mock.imageSVG(url.pathname.split("/").pop())});
    if (url.hostname === "cdn.jsdelivr.net" && /supabase/.test(url.pathname)) {
      if (!sb) return route.abort();
      return route.fulfill({status: 200, contentType: "application/javascript", body: mock.SUPABASE_STUB});
    }
    if (/youtube/.test(url.hostname)) return route.fulfill({status: 200, contentType: "text/html", body: "<body style='margin:0;background:#111;color:#fff;font:20px sans-serif;display:grid;place-items:center;height:100vh'>Trailer simulado</body>"});
    if (/mgeb\.site|embed/.test(url.hostname)) return route.fulfill({status: 200, contentType: "text/html", body: "<body style='margin:0;background:#050505;color:#9fb;font:20px sans-serif;display:grid;place-items:center;height:100vh'>Player incorporado (simulado)</body>"});
    return route.fulfill({status: 200, contentType: "text/plain", body: ""});
  });
  const page = await context.newPage();
  const errors = [], warnings = [];
  page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
  page.on("console", m => { const t = m.text(); if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(t)) errors.push("CONSOLE: " + t); if (/Content Security Policy|violates/i.test(t)) errors.push("CSP: " + t); if (m.type() === "warning") warnings.push(t); });
  return {page, context, browser, server, errors, warnings, requests, close: async () => { await browser.close(); server.close(); }};
}

const BASE = "http://127.0.0.1:4173/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = {launch, BASE, sleep};
