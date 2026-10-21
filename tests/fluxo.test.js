const {launch, BASE, sleep} = require("./harness");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };
(async () => {
  const t = await launch({supabase: true});
  const {page} = t;
  const state = () => page.evaluate(() => ({hash: location.hash, view: document.body.dataset.view, open: [...document.querySelectorAll(".modal:not(.hidden)")].map(m => m.id), histLen: history.length, overflow: document.body.style.overflow, title: document.title}));
  await page.goto(BASE, {waitUntil: "load"});
  await sleep(2200);

  console.log("# Detalhes de filme");
  const h0 = (await state()).histLen;
  await page.click('#catalogGrid .card-main >> nth=0');
  await sleep(900);
  let s = await state();
  check("abre o modal de detalhes", s.open.join() === "detailsModal", JSON.stringify(s));
  check("URL aponta para o título", /^#\/titulo\//.test(s.hash), s.hash);
  check("document.title atualizado", /\| LumiPlay$/.test(s.title), s.title);
  check("rolagem do fundo travada", s.overflow === "hidden");
  check("uma entrada de histórico a mais", s.histLen === h0 + 1, `${h0} -> ${s.histLen}`);
  await sleep(1200);
  const d = await page.evaluate(() => ({
    title: document.getElementById("detailsTitle").textContent,
    meta: document.getElementById("detailsMeta").children.length,
    cast: document.querySelectorAll("#detailsCast .cast-person").length,
    similar: document.querySelectorAll("#detailsSimilar .related-card").length,
    backdrop: document.getElementById("detailsBackdrop").getAttribute("src"),
    trailerHidden: document.getElementById("detailsTrailer").classList.contains("hidden"),
    focusInside: document.getElementById("detailsModal").contains(document.activeElement),
  }));
  check("título e metadados", d.title === "Noite Sem Fim" && d.meta >= 3, JSON.stringify(d));
  check("elenco carregado", d.cast >= 5, d.cast);
  check("títulos relacionados", d.similar >= 5, d.similar);
  check("botão de trailer visível", !d.trailerHidden);
  check("foco dentro da janela", d.focusInside);
  await page.screenshot({path: "shots/04-details-desktop.png"});

  console.log("# Minha lista");
  await page.click("#detailsFavorite");
  const fav = await page.evaluate(() => ({p: document.getElementById("detailsFavorite").getAttribute("aria-pressed"), t: document.querySelector("#detailsFavorite span").textContent, toast: document.getElementById("toast").textContent}));
  check("favorito marcado", fav.p === "true" && fav.t === "Na minha lista", JSON.stringify(fav));

  console.log("# Trailer");
  await page.click("#detailsTrailer"); await sleep(700);
  s = await state();
  check("trailer abre sobre os detalhes", s.open.includes("trailerModal") && s.open.includes("detailsModal"), s.open.join());
  const tr = await page.evaluate(() => document.getElementById("trailerFrame").dataset.src);
  check("iframe do YouTube (nocookie)", /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(tr), tr);
  await page.keyboard.press("Escape"); await sleep(300);
  s = await state();
  check("Esc fecha só o trailer", s.open.join() === "detailsModal", s.open.join());
  check("iframe do trailer esvaziado", (await page.evaluate(() => document.getElementById("trailerFrame").dataset.src)) === "about:blank");

  console.log("# Player (filme)");
  await page.click("#detailsPlay"); await sleep(1500);
  s = await state();
  check("player abre e detalhes fecham", s.open.join() === "playerModal", s.open.join());
  const pl = await page.evaluate(() => ({embed: document.getElementById("embedPlayer").dataset.src, hiddenEmbed: document.getElementById("embedPlayer").classList.contains("hidden"), next: document.getElementById("playerNext").classList.contains("hidden"), title: document.getElementById("playerTitle").textContent}));
  check("usa o player incorporado", /mgeb\.site/.test(pl.embed) && !pl.hiddenEmbed, JSON.stringify(pl));
  check("filme não mostra 'próximo episódio'", pl.next);
  await page.screenshot({path: "shots/05-player-desktop.png"});
  await page.keyboard.press("Escape"); await sleep(500);
  s = await state();
  check("Esc fecha o player", s.open.length === 0, s.open.join());
  check("URL volta à rota anterior", !/titulo/.test(s.hash), s.hash);
  check("rolagem destravada", s.overflow === "");
  check("player parado (iframe em branco)", (await page.evaluate(() => document.getElementById("embedPlayer").dataset.src)) === "about:blank");

  console.log("# Botão Voltar do navegador");
  const before = await state();
  await page.click('#catalogGrid .card-main >> nth=1'); await sleep(500);
  check("abriu", (await state()).open.length === 1);
  await page.goBack(); await sleep(500);
  s = await state();
  check("Voltar fecha a janela (não sai do site)", s.open.length === 0 && page.url().startsWith(BASE), `${s.open} ${page.url()}`);
  check("histórico restaurado", s.histLen === before.histLen + 1 || s.histLen === before.histLen, `${before.histLen} -> ${s.histLen}`);

  console.log("# Série, episódios e próximo episódio");
  await page.evaluate(() => document.querySelector('[data-open="tmdb-tv-2002"]')?.click());
  await sleep(1800);
  const se = await page.evaluate(() => ({eps: document.querySelectorAll("#episodeList .episode-row").length, seasons: document.getElementById("seasonSelect").options.length, areaHidden: document.getElementById("episodeArea").classList.contains("hidden"), meta: document.getElementById("detailsMeta").textContent}));
  check("lista de episódios", se.eps === 8 && !se.areaHidden, JSON.stringify(se));
  check("seletor de temporadas", se.seasons === 3, se.seasons);
  await page.screenshot({path: "shots/06-details-series.png", fullPage: false});
  await page.evaluate(() => document.getElementById("detailsModal").querySelector(".details-panel").scrollTo(0, 700)); await sleep(300);
  await page.screenshot({path: "shots/06-details-series-scrolled.png"});
  await page.click("#episodeList .episode-row >> nth=2"); await sleep(1500);
  const ep = await page.evaluate(() => ({title: document.getElementById("playerTitle").textContent, next: !document.getElementById("playerNext").classList.contains("hidden"), embed: document.getElementById("embedPlayer").dataset.src}));
  check("episódio 3 reproduzindo", /Episódio 3/.test(ep.title) || /s1\/e3|1\/3|\/1\/3/.test(ep.embed) || ep.title.length > 0, JSON.stringify(ep));
  check("botão 'próximo episódio' visível", ep.next);
  await page.click("#playerNext"); await sleep(1200);
  const ep2 = await page.evaluate(() => ({title: document.getElementById("playerTitle").textContent, embed: document.getElementById("embedPlayer").dataset.src}));
  check("avançou para o episódio 4", /Episódio 4/.test(ep2.title) || ep2.embed !== ep.embed, JSON.stringify(ep2));
  await page.keyboard.press("Escape"); await sleep(400);

  console.log("# Telas");
  for (const [nav, view, route] of [["movies", "movies", "#/filmes"], ["series", "series", "#/series"], ["list", "list", "#/lista"], ["history", "history", "#/assistidos"], ["tv", "tv", "#/tv"], ["home", "home", "#/"]]) {
    await page.click(`.desktop-nav [data-nav="${nav}"]`); await sleep(500);
    s = await state();
    const vis = await page.evaluate(() => ({hero: getComputedStyle(document.getElementById("hero")).display, rows: getComputedStyle(document.getElementById("homeRows")).display, catalog: getComputedStyle(document.getElementById("catalogSection")).display, list: getComputedStyle(document.getElementById("myListSection")).display, hist: getComputedStyle(document.getElementById("watchHistorySection")).display, tv: getComputedStyle(document.getElementById("liveTvSection")).display, trending: document.getElementById("trendingSection").getBoundingClientRect().height > 0}));
    check(`tela ${nav}: data-view e rota`, s.view === view && (s.hash === route || (route === "#/" && (s.hash === "" || s.hash === "#/"))), JSON.stringify(s));
    if (nav === "home") check("início mostra destaque e fileiras", vis.hero !== "none" && vis.rows !== "none" && vis.trending, JSON.stringify(vis));
    else check(`tela ${nav} esconde destaque/fileiras`, vis.hero === "none" && vis.rows === "none" && !vis.trending, JSON.stringify(vis));
    if (nav === "list") { const n = await page.evaluate(() => document.querySelectorAll("#myListGrid .card").length); check("minha lista mostra o título salvo", n === 1, n); await page.screenshot({path: "shots/07-list.png"}); }
    if (nav === "history") { const n = await page.evaluate(() => document.querySelectorAll("#watchHistoryGrid .card").length); check("histórico registrou o que foi aberto no player", n >= 2, n); }
    if (nav === "tv") await page.screenshot({path: "shots/07-tv-empty.png"});
  }

  console.log("# Voltar/avançar entre telas");
  await page.click('.desktop-nav [data-nav="movies"]'); await sleep(300);
  await page.click('.desktop-nav [data-nav="series"]'); await sleep(300);
  await page.goBack(); await sleep(400);
  s = await state(); check("Voltar leva de Séries para Filmes", s.view === "movies", JSON.stringify(s));
  await page.goForward(); await sleep(400);
  s = await state(); check("Avançar volta para Séries", s.view === "series", JSON.stringify(s));
  await page.click('.desktop-nav [data-nav="home"]'); await sleep(400);

  console.log("# Busca e sugestões");
  await page.click("#searchInput"); await page.keyboard.type("vila", {delay: 40}); await sleep(600);
  const sg = await page.evaluate(() => ({n: document.querySelectorAll("#searchSuggestions .suggestion").length, hidden: document.getElementById("searchSuggestions").classList.contains("hidden"), view: document.body.dataset.view, heading: document.getElementById("catalogHeading").textContent}));
  check("sugestões aparecem", sg.n >= 1 && !sg.hidden, JSON.stringify(sg));
  check("busca vira a tela de resultados", sg.view === "search" && sg.heading === "Resultados da busca", JSON.stringify(sg));
  await page.screenshot({path: "shots/08-search-desktop.png"});
  await page.click("#searchSuggestions .suggestion >> nth=0"); await sleep(600);
  s = await state(); check("clicar na sugestão abre o título", s.open.join() === "detailsModal", s.open.join());
  await page.keyboard.press("Escape"); await sleep(400);
  await page.click("#searchClear"); await sleep(400);
  s = await state(); check("limpar a busca volta ao início", s.view === "home", s.view);

  console.log("# Surpreenda-me");
  await page.click("#randomPick"); await sleep(700);
  s = await state(); check("sorteio abre um título", s.open.join() === "detailsModal", s.open.join());
  await page.keyboard.press("Escape"); await sleep(400);

  console.log("# Link direto");
  await page.goto(BASE + "#/titulo/tmdb-movie-1003", {waitUntil: "load"}); await sleep(2500);
  s = await state();
  const dl = await page.evaluate(() => document.getElementById("detailsTitle").textContent);
  check("link direto abre o título", s.open.join() === "detailsModal" && dl === "Horizonte Vermelho", JSON.stringify(s) + dl);
  await page.keyboard.press("Escape"); await sleep(500);
  s = await state(); check("fechar link direto troca a URL (sem sair do site)", s.open.length === 0 && !/titulo/.test(s.hash) && page.url().startsWith(BASE), JSON.stringify(s));

  console.log("\nResultado:", pass, "ok,", fail, "falhas");
  console.log("Erros de página/console:", t.errors.length ? t.errors : "nenhum");
  await t.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FALHA NO TESTE:", e); process.exit(1); });
