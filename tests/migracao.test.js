// Quem já usa o site tem dados salvos pela versão anterior no navegador: lista, progresso, histórico e perfis devem continuar valendo.
const {launch, BASE, sleep} = require("./harness");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };
(async () => {
  const tmdb = (id, title, type, genre) => ({id: `tmdb-${type === "Série" ? "tv" : "movie"}-${id}`, title, type, genre, year: "2019", description: "Sinopse de teste para o catálogo salvo.", poster: `https://image.tmdb.org/t/p/w500/pst${id}.jpg`, backdrop: `https://image.tmdb.org/t/p/w1280/bdp${id}.jpg`, tmdbId: String(id), tmdbMediaType: type === "Série" ? "tv" : "movie", color: "#4a3fb0"});
  const oldState = {
    "cinebase.catalog.v2": JSON.stringify([
      {id: "demo-1", title: "Horizonte Oculto", type: "Filme", genre: "Ficção científica", year: "2024", poster: "assets/posters/horizonte-oculto.svg", description: "Exemplo antigo", color: "#6d5dfc"},
      tmdb(1001, "Noite Sem Fim", "Filme", "Ação • Aventura"), tmdb(1002, "O Último Farol", "Filme", "Drama"), tmdb(1003, "Horizonte Vermelho", "Filme", "Ação"),
      tmdb(1004, "Entre Dois Mundos", "Filme", "Drama"), tmdb(2001, "Os Guardiões da Colina", "Série", "Ação • Aventura"), tmdb(2002, "Plantão Noturno", "Série", "Drama")]),
    "cinebase.favorites.v1": JSON.stringify(["tmdb-movie-1002", "id-que-nao-existe-mais"]),
    "cinebase.progress.v1": JSON.stringify({"tmdb-movie-1001": {time: 1800, duration: 7200, updated: Date.now()}}),
    "lumiplay.watch-history.v1": JSON.stringify([{key: "tmdb-movie-1001", id: "tmdb-movie-1001", title: "Noite Sem Fim", type: "Filme", poster: "", episode: "", season: null, episodeNumber: null, watchedAt: Date.now()}]),
    "lumiplay.local.profiles.v1": JSON.stringify([{id: "main", name: "Principal"}, {id: "kids", name: "Crianças"}]),
    "lumiplay.local.profile.active.v1": "main",
    "lumiplay.catalog.examples.cleaned.v2": "no",
  };
  const t = await launch({supabase: false, tmdbStatus: 500});
  await t.context.addInitScript(state => { if (!sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); Object.entries(state).forEach(([k, v]) => localStorage.setItem(k, v)); } }, oldState);
  const {page} = t;
  await page.goto(BASE, {waitUntil: "load"}); await sleep(1500);
  const r = await page.evaluate(() => ({
    demo: !!document.querySelector('[data-open="demo-1"]'),
    cards: document.querySelectorAll("#catalogGrid .card").length,
    continueVisible: !document.getElementById("continueSection").classList.contains("hidden"),
    continueCards: document.querySelectorAll("#continueGrid .card").length,
    progressBar: document.querySelector("#continueGrid .poster-progress span")?.style.width,
    hearts: [...document.querySelectorAll('.card-fav[aria-pressed="true"]')].map(b => b.dataset.fav),
    avatar: document.getElementById("avatarInitial").textContent,
  }));
  check("item de demonstração antigo foi removido", !r.demo);
  check("catálogo salvo foi carregado", r.cards === 6, r.cards);
  check("“Continue assistindo” aparece já na carga inicial (no original só depois de clicar em Início)", r.continueVisible && r.continueCards === 1, JSON.stringify(r));
  check("barra de progresso correta (1800/7200 = 25%)", parseFloat(r.progressBar) === 25, r.progressBar);
  check("favorito antigo continua marcado", r.hearts.includes("tmdb-movie-1002"), JSON.stringify(r.hearts));
  await page.click('.desktop-nav [data-nav="list"]'); await sleep(400);
  const list = await page.evaluate(() => document.querySelectorAll("#myListGrid .card").length);
  check("minha lista ignora IDs que não existem mais", list === 1, list);
  await page.click('.desktop-nav [data-nav="history"]'); await sleep(400);
  const hist = await page.evaluate(() => document.querySelectorAll("#watchHistoryGrid .card").length);
  check("histórico antigo aparece", hist === 1, hist);
  await page.click("#userMenuButton"); await page.click("#profilesOpen"); await sleep(500);
  const profiles = await page.evaluate(() => [...document.querySelectorAll("#profileList .profile-row strong")].map(e => e.textContent));
  check("perfis antigos preservados", profiles.join() === "Principal,Crianças", profiles.join());
  console.log("     erros:", t.errors.length ? t.errors : "nenhum");
  check("sem erros de console", t.errors.length === 0, t.errors.join(" | "));
  console.log("\nResultado:", pass, "ok,", fail, "falhas");
  await t.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FALHA NO TESTE:", e); process.exit(1); });
