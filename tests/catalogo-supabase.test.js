const {launch, BASE, sleep} = require("./harness");
const mock = require("./mock.js");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };
(async () => {
  // Catálogo vindo só do banco: capa + tmdb_id, sem imagem larga
  const rows = mock.ALL.slice(0, 8).concat(mock.ALL.slice(24, 30)).map((e, i) => ({id: i + 1, app_id: `${e.media_type === "tv" ? "tmdb-tv" : "tmdb-movie"}-${e.id}`, tipo: e.media_type === "tv" ? "serie" : "filme", titulo: mock.titleOf(e), genero: "Drama, Aventura", ano: 2020 + (i % 5), sinopse: e.overview, capa_url: `https://image.tmdb.org/t/p/w500/pst${e.id}.jpg`, video_url: "", tmdb_id: e.id, temporadas: [], criado_em: "2026-01-01"}));
  const t = await launch({supabase: true, sbConfig: {tables: {catalogo: rows}}, tmdbNoTrending: true, tmdbDelay: 1800, viewport: {width: 1440, height: 900}});
  const {page} = t;
  await page.goto(BASE, {waitUntil: "load"}); await sleep(900);
  const early = await page.evaluate(() => ({poster: document.getElementById("hero").classList.contains("is-poster"), src: document.getElementById("heroImage").getAttribute("src"), title: document.getElementById("heroTitle").textContent}));
  check("começa em modo capa (sem imagem larga)", early.poster && /pst/.test(early.src || ""), JSON.stringify(early));
  await page.screenshot({path: "shots/60-hero-poster-mode.png"});
  await sleep(4500);
  const late = await page.evaluate(() => ({poster: document.getElementById("hero").classList.contains("is-poster"), src: document.getElementById("heroImage").getAttribute("src")}));
  check("imagem larga chega do TMDB e o destaque muda", !late.poster && /bdp/.test(late.src || ""), JSON.stringify(late));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cinebase.catalog.v2") || "[]").filter(x => x.backdrop).length);
  check("imagem larga fica salva no cache local", saved >= 1, saved);
  await page.screenshot({path: "shots/60-hero-enriched.png"});
  console.log("     erros:", t.errors.length ? t.errors : "nenhum");
  console.log("\nResultado:", pass, "ok,", fail, "falhas");
  await t.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FALHA NO TESTE:", e); process.exit(1); });
