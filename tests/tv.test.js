const {launch, BASE, sleep} = require("./harness");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };
(async () => {
  const t = await launch({supabase: true, viewport: {width: 1920, height: 1080}, userAgent: "Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36"});
  const {page} = t;
  await page.goto(BASE, {waitUntil: "load"}); await sleep(3200);
  const env = await page.evaluate(() => ({cls: document.documentElement.className, fs: getComputedStyle(document.documentElement).fontSize, cards: document.querySelectorAll("#catalogGrid .card").length, rotation: document.getElementById("heroProgress").classList.contains("running"), suggestions: !!document.querySelector(".search-suggestions:not(.hidden)")}));
  check("detecta TV por user-agent", /tv-mode/.test(env.cls) && /low-power-device/.test(env.cls), env.cls);
  check("fonte maior na TV", parseFloat(env.fs) >= 20, env.fs);
  check("lote de 18 cartões", env.cards === 18, env.cards);
  check("sem rotação automática do destaque na TV", env.rotation === false);
  await page.screenshot({path: "shots/20-tv-home.png"});

  const focusInfo = () => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const r = a.getBoundingClientRect(); return {tag: a.tagName, id: a.id, cls: a.className.toString().slice(0, 40), open: a.dataset.open || a.dataset.nav || a.dataset.heroIndex || "", x: Math.round(r.left), y: Math.round(r.top)}; });
  console.log("# Navegação por setas");
  await page.keyboard.press("ArrowDown"); await sleep(250);
  let f = await focusInfo(); check("1ª seta foca algo visível", !!f, JSON.stringify(f)); console.log("     foco:", JSON.stringify(f));
  const trail = [];
  for (const key of ["ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown"]) { await page.keyboard.press(key); await sleep(220); trail.push(key.replace("Arrow", "") + "→" + JSON.stringify(await focusInfo())); }
  trail.forEach(x => console.log("    ", x));
  f = await focusInfo();
  check("foco se move com as setas", !!f);
  // leva o foco a um cartão da primeira fileira
  await page.evaluate(() => document.querySelector("#trendingGrid .card-main").focus());
  await sleep(300);
  await page.screenshot({path: "shots/20-tv-focus-card.png"});
  const ring = await page.evaluate(() => { const el = document.querySelector("#trendingGrid .card-main"); const frame = el.querySelector(".poster-frame"); return {transform: getComputedStyle(frame).transform, rim: getComputedStyle(frame, "::before").opacity}; });
  check("cartão em foco sobe e acende o aro", ring.transform !== "none" && ring.rim === "1", JSON.stringify(ring));

  console.log("# Abrir título e voltar com a tecla Voltar do controle");
  await page.keyboard.press("Enter"); await sleep(1200);
  const open = await page.evaluate(() => ({open: [...document.querySelectorAll(".modal:not(.hidden)")].map(m => m.id), focus: document.activeElement.id}));
  check("Enter abre detalhes e foca o botão Assistir", open.open.join() === "detailsModal" && open.focus === "detailsPlay", JSON.stringify(open));
  await page.screenshot({path: "shots/20-tv-details.png"});
  await page.keyboard.press("ArrowRight"); await sleep(200);
  const f2 = await focusInfo(); check("setas navegam entre os botões dos detalhes", f2 && f2.id === "detailsFavorite", JSON.stringify(f2));
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", {keyCode: 10009, bubbles: true})));
  await sleep(700);
  const closed = await page.evaluate(() => ({open: document.querySelectorAll(".modal:not(.hidden)").length, hash: location.hash}));
  check("tecla Voltar (10009) fecha a janela", closed.open === 0, JSON.stringify(closed));
  const back = await focusInfo(); check("foco volta para o cartão de origem", back && back.cls.includes("card-main"), JSON.stringify(back));
  console.log("\nResultado:", pass, "ok,", fail, "falhas"); console.log("Erros:", t.errors.length ? t.errors : "nenhum");
  await t.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FALHA NO TESTE:", e); process.exit(1); });
