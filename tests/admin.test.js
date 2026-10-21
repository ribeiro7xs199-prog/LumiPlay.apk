const {launch, BASE, sleep} = require("./harness");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };
const ADMIN = "f6144686-40dd-4e8e-8e4d-e49febce94ec";
(async () => {
  const sbConfig = {adminSession: {user: {id: ADMIN, email: "admin@lumiplay.test"}}, tables: {tv_channels: [
    {id: "c1", name: "Canal Cultura", category: "Público", url: "https://example.com/embed/1", logo: "", updated_at: "2026-01-01"},
    {id: "c2", name: "Notícias 24h", category: "Notícias", url: "https://example.com/embed/2", logo: "", updated_at: "2026-01-01"}]}, errors: {}};
  const t = await launch({supabase: true, sbConfig, viewport: {width: 1440, height: 900}});
  const {page} = t;
  await page.goto(BASE, {waitUntil: "load"}); await sleep(3000);

  console.log("# Painel admin");
  await page.click("#userMenuButton"); await page.click("#adminOpen"); await sleep(900);
  const a = await page.evaluate(() => ({open: !document.getElementById("adminModal").classList.contains("hidden"), login: document.getElementById("adminLoginBox").classList.contains("hidden"), logged: !document.getElementById("adminLoggedBox").classList.contains("hidden"), who: document.getElementById("adminIdentity").textContent, total: document.getElementById("adminTotalTitles").textContent, add: !document.getElementById("adminAddTitle").classList.contains("hidden"), items: document.querySelectorAll("#adminList .admin-item").length}));
  check("admin abre já autenticado", a.open && a.logged && a.login, JSON.stringify(a));
  check("totais e lista de títulos", Number(a.total) > 0 && a.items > 0, JSON.stringify(a));
  await page.screenshot({path: "shots/50-admin-desktop.png"});

  console.log("# Editar título preserva imagem larga e dados do TMDB (bug do original)");
  const before = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem("cinebase.catalog.v2") || "[]"); const it = c.find(x => x.id === "tmdb-movie-1001"); return it ? {backdrop: it.backdrop, mt: it.tmdbMediaType, desc: it.description} : null; });
  check("título TMDB tem backdrop salvo", before && before.backdrop && before.mt, JSON.stringify(before));
  await page.evaluate(() => document.querySelector('[data-edit="tmdb-movie-1001"]').click()); await sleep(500);
  await page.fill('#titleForm [name="description"]', "Sinopse editada pelo administrador."); 
  await page.click("#titleSubmit"); await sleep(1200);
  const after = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem("cinebase.catalog.v2") || "[]"); const it = c.find(x => x.id === "tmdb-movie-1001"); return it ? {backdrop: it.backdrop, mt: it.tmdbMediaType, desc: it.description} : null; });
  check("descrição foi alterada", after && after.desc === "Sinopse editada pelo administrador.", JSON.stringify(after));
  check("imagem larga (backdrop) preservada", after && after.backdrop === before.backdrop, JSON.stringify(after));
  check("tipo TMDB preservado", after && after.mt === before.mt, JSON.stringify(after));

  console.log("# Canais de TV: gravar antes de apagar");
  await page.evaluate(() => { window.__SB_LOG__ = []; });
  await page.click("#addTvChannel"); await sleep(500);
  await page.fill("#tvName", "Canal Novo"); await page.fill("#tvGenre", "Teste"); await page.fill("#tvUrl", "https://example.com/embed/3");
  await page.screenshot({path: "shots/50-admin-tvform.png"});
  await page.click('#tvChannelForm button[type="submit"]'); await sleep(900);
  let log = await page.evaluate(() => (window.__SB_LOG__ || []).filter(e => e.table === "tv_channels").map(e => e.calls.join(">")));
  console.log("     chamadas:", JSON.stringify(log));
  const up = log.findIndex(x => x.includes("upsert")), del = log.findIndex(x => x.includes("delete"));
  check("upsert acontece antes do delete", up >= 0 && del > up, JSON.stringify(log));
  check("delete só remove ausentes (usa not-in, não apaga tudo)", log[del] && /not/.test(log[del]), log[del]);
  const delArgs = await page.evaluate(() => { const e = (window.__SB_LOG__ || []).filter(x => x.table === "tv_channels").find(x => x.calls.includes("not")); return e ? e.args[e.calls.indexOf("not")] : null; });
  check("lista de IDs mantidos inclui os 3 canais", delArgs && /c1/.test(delArgs[2]) && /c2/.test(delArgs[2]), JSON.stringify(delArgs));

  console.log("# Se a gravação falhar, nada é apagado");
  await page.evaluate(() => { window.__SB_LOG__ = []; window.__SB__.errors = {tv_channels: {message: "falha simulada"}}; });
  await page.click("#addTvChannel"); await sleep(400);
  await page.fill("#tvName", "Canal Falho"); await page.fill("#tvUrl", "https://example.com/embed/4");
  await page.click('#tvChannelForm button[type="submit"]'); await sleep(900);
  log = await page.evaluate(() => (window.__SB_LOG__ || []).filter(e => e.table === "tv_channels").map(e => e.calls.join(">")));
  check("sem delete quando o upsert falha", !log.some(x => x.includes("delete")), JSON.stringify(log));
  check("usuário é avisado", /Falha ao sincronizar/.test(await page.evaluate(() => document.getElementById("toast").textContent)));
  await page.evaluate(() => { window.__SB__.errors = {}; });

  console.log("\nResultado:", pass, "ok,", fail, "falhas");
  console.log("Erros:", t.errors.length ? t.errors : "nenhum");
  await t.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FALHA NO TESTE:", e); process.exit(1); });
