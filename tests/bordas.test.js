const {launch, BASE, sleep} = require("./harness");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };
(async () => {
  console.log("# Sem internet (TMDB com erro, sem Supabase): usa o catálogo local de contingência");
  let t = await launch({supabase: false, tmdbStatus: 500});
  await t.page.goto(BASE, {waitUntil: "load"}); await sleep(3500);
  let r = await t.page.evaluate(() => ({cards: document.querySelectorAll("#catalogGrid .card").length, skeleton: document.querySelectorAll(".skeleton").length, hero: document.getElementById("heroTitle").textContent, status: document.getElementById("backendStatus").textContent.slice(0, 80), compat: !!document.getElementById("lumiCompatNotice")}));
  check("catálogo local aparece", r.cards >= 5 && r.skeleton === 0, JSON.stringify(r));
  check("destaque funciona com o catálogo local", r.hero !== "Histórias que ficam com você.", r.hero);
  check("sem aviso de navegador antigo", !r.compat);
  console.log("     erros:", t.errors.length ? t.errors : "nenhum");
  await t.page.screenshot({path: "shots/30-offline.png"});
  await t.close();

  console.log("# Catálogo vazio (nada carrega)");
  t = await launch({supabase: false, tmdbStatus: 500, blockCatalogJson: true});
  await t.page.goto(BASE, {waitUntil: "load"}); await sleep(600);
  const sk = await t.page.evaluate(() => document.querySelectorAll(".skeleton").length);
  check("mostra esqueletos enquanto carrega", sk > 0, sk);
  await sleep(4500);
  r = await t.page.evaluate(() => ({skeleton: document.querySelectorAll(".skeleton").length, empty: !document.getElementById("emptyState").classList.contains("hidden"), heroEmpty: document.getElementById("hero").classList.contains("is-empty"), count: document.getElementById("catalogResultCount").textContent}));
  check("troca esqueletos por estado vazio", r.skeleton === 0 && r.empty, JSON.stringify(r));
  check("destaque padrão da marca", r.heroEmpty);
  await t.page.screenshot({path: "shots/30-empty.png"});
  console.log("     erros:", t.errors.length ? t.errors : "nenhum");
  await t.close();

  console.log("# Movimento reduzido");
  t = await launch({supabase: true, reducedMotion: true});
  await t.page.goto(BASE, {waitUntil: "load"}); await sleep(2500);
  r = await t.page.evaluate(() => ({running: document.getElementById("heroProgress").classList.contains("running"), anim: getComputedStyle(document.getElementById("heroContent")).animationDuration}));
  check("destaque não gira sozinho", r.running === false, JSON.stringify(r));
  await t.close();

  console.log("# Destaque gira sozinho em desktop comum");
  t = await launch({supabase: true});
  await t.page.goto(BASE, {waitUntil: "load"}); await sleep(2200);
  const first = await t.page.evaluate(() => document.getElementById("heroTitle").textContent);
  check("barra de progresso ativa", await t.page.evaluate(() => document.getElementById("heroProgress").classList.contains("running")));
  await t.page.click("#heroNext"); await sleep(500);
  const second = await t.page.evaluate(() => document.getElementById("heroTitle").textContent);
  check("próximo destaque", first !== second, first + " -> " + second);
  await t.page.click('.hero-thumb >> nth=3'); await sleep(400);
  const third = await t.page.evaluate(() => ({t: document.getElementById("heroTitle").textContent, active: [...document.querySelectorAll(".hero-thumb")].findIndex(e => e.classList.contains("active"))}));
  check("miniatura escolhe o destaque", third.active === 3, JSON.stringify(third));
  await t.page.hover("#hero"); await sleep(300);
  check("pausa ao apontar", !(await t.page.evaluate(() => document.getElementById("heroProgress").classList.contains("running"))));
  await t.close();

  console.log("# Teclado: Tab, link de pular e janela com foco preso");
  t = await launch({supabase: true});
  await t.page.goto(BASE, {waitUntil: "load"}); await sleep(2000);
  await t.page.keyboard.press("Tab");
  check("primeiro Tab foca o link 'Pular para o conteúdo'", await t.page.evaluate(() => document.activeElement.className === "skip-link"));
  await t.page.keyboard.press("Enter"); await sleep(200);
  await t.page.evaluate(() => document.querySelector('[data-open]').focus());
  await t.page.keyboard.press("Enter"); await sleep(1200);
  const seen = new Set();
  for (let i = 0; i < 40; i++) { await t.page.keyboard.press("Tab"); const where = await t.page.evaluate(() => ({inside: !!document.activeElement.closest("#detailsModal"), id: document.activeElement.id || document.activeElement.className.toString().slice(0, 20)})); seen.add(where.inside); if (!where.inside) break; }
  check("Tab não escapa da janela de detalhes", seen.size === 1 && seen.has(true), [...seen].join());
  const hidden = await t.page.evaluate(() => document.querySelector("main").getAttribute("aria-hidden"));
  check("conteúdo atrás da janela fica oculto a leitores de tela", hidden === "true", hidden);
  await t.page.keyboard.press("Escape"); await sleep(500);
  check("aria-hidden removido ao fechar", await t.page.evaluate(() => !document.querySelector("main").hasAttribute("aria-hidden")));
  check("foco devolvido ao cartão", await t.page.evaluate(() => document.activeElement.classList.contains("card-main")));
  console.log("     erros:", t.errors.length ? t.errors : "nenhum");
  await t.close();

  console.log("\nResultado:", pass, "ok,", fail, "falhas");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FALHA NO TESTE:", e); process.exit(1); });
