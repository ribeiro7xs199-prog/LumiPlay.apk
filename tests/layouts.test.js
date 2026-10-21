// Sem rolagem horizontal, menu sem quebra de linha e ordem das seções dos detalhes em vários tamanhos de tela.
const {launch, BASE, sleep} = require("./harness");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };
const SIZES = [["celular 390", {width: 390, height: 844}, true], ["celular pequeno 320", {width: 320, height: 640}, true], ["tablet retrato 820", {width: 820, height: 1180}, true], ["tablet paisagem 1180", {width: 1180, height: 820}, true], ["notebook 1280", {width: 1280, height: 720}, false], ["desktop 1440", {width: 1440, height: 900}, false], ["TV 1920", {width: 1920, height: 1080}, false]];
(async () => {
  for (const [label, viewport, mobile] of SIZES) {
    console.log("#", label);
    const t = await launch({supabase: true, viewport, mobile, userAgent: viewport.width === 1920 ? "Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36" : undefined});
    const {page} = t;
    await page.goto(BASE, {waitUntil: "load"}); await sleep(2300);
    const m = await page.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, navWrap: (() => { const links = [...document.querySelectorAll(".desktop-nav .nav-link")].filter(e => e.getBoundingClientRect().width > 0); const rows = new Set(links.map(e => Math.round(e.getBoundingClientRect().top))); return links.length && (rows.size > 1 || links.some(e => getComputedStyle(e).whiteSpace !== "nowrap")) ? links.map(e => e.textContent) : []; })()}));
    check("sem rolagem horizontal", m.sw <= m.cw, `${m.sw} > ${m.cw}`);
    check("menu superior sem quebra de linha", m.navWrap.length === 0, m.navWrap.join());
    await page.evaluate(() => document.querySelector('[data-open="tmdb-tv-2004"]').click()); await sleep(2000);
    const order = await page.evaluate(() => { const p = document.querySelector("#detailsModal .details-panel"); const top = el => el.getBoundingClientRect().top + p.scrollTop; return [["descricao", top(document.getElementById("detailsDescription"))], ["episodios", top(document.getElementById("episodeArea"))], ["comunidade", top(document.querySelector(".community-panel"))], ["elenco", top(document.getElementById("detailsCastSection"))], ["relacionados", top(document.getElementById("detailsSimilarSection"))]].sort((a, b) => a[1] - b[1]).map(x => x[0]).join(">"); });
    const narrow = viewport.width <= 1023;
    check(narrow ? "ordem em coluna única: sinopse, episódios, comunidade, elenco, relacionados" : "ordem em duas colunas: coluna principal termina em elenco e relacionados", narrow ? order === "descricao>episodios>comunidade>elenco>relacionados" : order.endsWith("elenco>relacionados"), order);
    check("sem erros de console", t.errors.length === 0, t.errors.join(" | "));
    await t.close();
  }
  console.log("\nResultado:", pass, "ok,", fail, "falhas");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FALHA NO TESTE:", e); process.exit(1); });
