const {launch, BASE, sleep} = require("./harness");
function lum(hex) { const c = hex.replace("#", "").match(/../g).map(h => parseInt(h, 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
(async () => {
  console.log("# Contraste (WCAG: texto normal >= 4.5, texto grande/ícones >= 3)");
  const pairs = [["texto / fundo", "#f0f3ff", "#070a15", 4.5], ["texto atenuado / fundo", "#a3acd0", "#070a15", 4.5], ["texto atenuado / cartão", "#a3acd0", "#151b36", 4.5], ["texto fraco / fundo", "#7d87b0", "#070a15", 4.5], ["texto fraco / cartão", "#7d87b0", "#0d1226", 4.5], ["link azul / fundo", "#3b94fa", "#070a15", 4.5], ["branco / botão (início)", "#ffffff", "#4a4cf8", 4.5], ["branco / botão (fim)", "#ffffff", "#8a38f6", 4.5], ["âmbar / fundo (nota)", "#ffc65c", "#070a15", 4.5], ["estrela inativa / cartão", "#6370a6", "#0d1226", 3]];
  let bad = 0;
  for (const [name, fg, bg, min] of pairs) { const r = ratio(fg, bg); const okc = r >= min; if (!okc) bad++; console.log(`  ${okc ? "ok  " : "ATENÇÃO"} ${name.padEnd(28)} ${r.toFixed(2)}:1 (mín ${min})`); }

  const t = await launch({supabase: true});
  const {page} = t;
  await page.goto(BASE, {waitUntil: "load"}); await sleep(2400);
  await page.evaluate(() => document.querySelector("[data-open]").click()); await sleep(1600);
  const audit = await page.evaluate(() => {
    const name = el => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") && [...el.getAttribute("aria-labelledby").split(" ")].map(i => document.getElementById(i)?.textContent).join(" ") || el.textContent || el.getAttribute("title") || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest("label")?.textContent || el.getAttribute("placeholder") || "").trim();
    const unnamed = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=menuitem], [role=radio]")].filter(el => !name(el)).map(el => el.tagName + "#" + (el.id || "") + "." + el.className.toString().slice(0, 30));
    const noAlt = [...document.querySelectorAll("img")].filter(i => !i.hasAttribute("alt")).map(i => i.src.slice(-30));
    const badRef = [...document.querySelectorAll("[aria-controls]")].filter(e => !document.getElementById(e.getAttribute("aria-controls"))).map(e => e.id + "->" + e.getAttribute("aria-controls"));
    const badLabelledby = [...document.querySelectorAll("[aria-labelledby]")].filter(e => e.getAttribute("aria-labelledby").split(" ").some(i => !document.getElementById(i))).map(e => e.id || e.className);
    const h1 = document.querySelectorAll("h1").length;
    const modalsOk = [...document.querySelectorAll(".modal")].every(m => m.getAttribute("role") === "dialog" && m.getAttribute("aria-modal") === "true" && (m.getAttribute("aria-labelledby") && document.getElementById(m.getAttribute("aria-labelledby"))));
    const small = [...document.querySelectorAll("button, a[href], .chip, .seg")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32) && !e.closest(".hidden") && getComputedStyle(e).visibility !== "hidden"; }).map(e => (e.id || e.className.toString().slice(0, 24)) + ":" + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height));
    return {unnamed, noAlt, badRef, badLabelledby, h1, modalsOk, lang: document.documentElement.lang, small: [...new Set(small)].slice(0, 12)};
  });
  console.log("\n# Estrutura");
  console.log("  controles sem nome acessível:", audit.unnamed.length ? audit.unnamed : "nenhum");
  console.log("  imagens sem atributo alt:", audit.noAlt.length ? audit.noAlt : "nenhuma");
  console.log("  aria-controls quebrados:", audit.badRef.length ? audit.badRef : "nenhum", "| aria-labelledby quebrados:", audit.badLabelledby.length ? audit.badLabelledby : "nenhum");
  console.log("  <h1>:", audit.h1, "| lang:", audit.lang, "| janelas com role/aria-modal/nome:", audit.modalsOk);
  console.log("  alvos de toque < 32px:", audit.small.length ? audit.small : "nenhum");
  console.log("  erros de console:", t.errors.length ? t.errors : "nenhum");
  await t.close();
  process.exit(bad || audit.unnamed.length || audit.badRef.length || !audit.modalsOk ? 1 : 0);
})().catch(e => { console.error("FALHA:", e); process.exit(1); });
