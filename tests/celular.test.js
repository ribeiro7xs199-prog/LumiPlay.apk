const {launch, BASE, sleep} = require("./harness");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };
(async () => {
  const t = await launch({supabase: true, viewport: {width: 390, height: 844}, mobile: true, dpr: 2, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36"});
  const {page} = t;
  await page.goto(BASE, {waitUntil: "load"}); await sleep(2200);

  console.log("# Detalhes (celular)");
  await page.tap('#catalogSection .card-main >> nth=0').catch(() => {});
  await page.evaluate(() => document.querySelector('[data-open="tmdb-movie-1002"]').click()); await sleep(1800);
  await page.screenshot({path: "shots/10-mobile-details.png"});
  await page.evaluate(() => document.querySelector("#detailsModal .details-panel").scrollTo(0, 560)); await sleep(400);
  await page.screenshot({path: "shots/10-mobile-details-scrolled.png"});
  await page.keyboard.press("Escape"); await sleep(500);

  console.log("# Série (celular)");
  await page.evaluate(() => document.querySelector('[data-open="tmdb-tv-2003"]').click()); await sleep(2000);
  await page.evaluate(() => document.querySelector("#episodeArea").scrollIntoView({block: "start"})); await sleep(400);
  await page.screenshot({path: "shots/10-mobile-series-episodes.png"});
  await page.evaluate(() => document.querySelector("#episodeList .episode-row").click()); await sleep(1600);
  await page.screenshot({path: "shots/11-mobile-player.png"});
  const pw = await page.evaluate(() => { const r = n => document.querySelector(n).getBoundingClientRect(); return {wrap: r("#videoWrap").width, info: r(".player-info").width, left: r(".player-info").left, vw: innerWidth}; });
  check("player: vídeo ocupa a largura toda e o texto tem margem", pw.wrap === pw.vw && pw.left > 8, JSON.stringify(pw));
  await page.keyboard.press("Escape"); await sleep(500);

  console.log("# Menu do perfil e Perfis");
  await page.tap("#userMenuButton"); await sleep(400);
  await page.screenshot({path: "shots/12-mobile-usermenu.png"});
  check("menu do perfil abre", await page.evaluate(() => !document.getElementById("userMenuPanel").classList.contains("hidden")));
  await page.tap("#profilesOpen"); await sleep(700);
  const prof = await page.evaluate(() => ({open: !document.getElementById("profilesModal").classList.contains("hidden"), rows: document.querySelectorAll("#profileList .profile-row").length, menuClosed: document.getElementById("userMenuPanel").classList.contains("hidden")}));
  check("modal de Perfis abre (no original nunca abria)", prof.open && prof.rows >= 1 && prof.menuClosed, JSON.stringify(prof));
  await page.screenshot({path: "shots/12-mobile-profiles.png"});
  await page.fill("#profileName", "Crianças"); await page.press("#profileName", "Enter"); await sleep(600);
  const prof2 = await page.evaluate(() => ({rows: document.querySelectorAll("#profileList .profile-row").length, status: document.getElementById("profileStatus").textContent}));
  check("cria um novo perfil", prof2.rows === 2, JSON.stringify(prof2));
  await page.screenshot({path: "shots/12-mobile-profiles-2.png"});
  await page.keyboard.press("Escape"); await sleep(400);

  console.log("# Barra inferior");
  for (const [nav, view] of [["list", "list"], ["history", "history"], ["tv", "tv"], ["movies", "movies"], ["home", "home"]]) {
    await page.tap(`.tabbar [data-nav="${nav === "history" ? "list" : nav}"]`); await sleep(500);
    if (nav === "history") { await page.tap('#myListSection [data-nav="history"]'); await sleep(400); }
    const v = await page.evaluate(() => document.body.dataset.view);
    check(`aba ${nav} -> ${view}`, v === view, v);
    if (nav === "list") await page.screenshot({path: "shots/13-mobile-list.png"});
    if (nav === "tv") await page.screenshot({path: "shots/13-mobile-tv.png"});
  }
  const active = await page.evaluate(() => [...document.querySelectorAll(".tabbar .tab.active")].map(e => e.textContent.trim()));
  check("aba ativa correta", active.length === 1 && active[0] === "Início", active.join());
  console.log("\nResultado:", pass, "ok,", fail, "falhas");
  console.log("Erros:", t.errors.length ? t.errors : "nenhum");
  await t.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FALHA NO TESTE:", e); process.exit(1); });
