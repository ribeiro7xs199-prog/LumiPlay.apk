/* LumiPlay — detecção de ambiente e rede de segurança.
   Carrega antes de tudo e é ES5 puro de propósito: se o navegador (ou a TV) for
   antigo demais para o restante do site, esta é a parte que avisa a pessoa em
   vez de deixar uma tela vazia. */
(function () {
  "use strict";
  var ua = navigator.userAgent || "";
  var root = document.documentElement;

  // Modo TV: automático por user-agent, ou forçado com ?tv=1 / ?tv=0 (fica salvo no aparelho).
  var forced = null;
  try {
    var m = /[?&]tv=([01])\b/.exec(location.search);
    if (m) { forced = m[1] === "1"; localStorage.setItem("lumiplay.tv-mode", m[1]); }
    else { var saved = localStorage.getItem("lumiplay.tv-mode"); if (saved === "1") forced = true; else if (saved === "0") forced = false; }
  } catch (e) { /* armazenamento indisponível: segue com a detecção automática */ }

  var isTv = forced !== null ? forced
    : /smart[- ]?tv|tizen|web0s|webos|hbbtv|netcast|vidaa|roku|crkey|bravia|viera|philipstv|googletv|google tv|android tv|aft[a-z]\b|mibox|hisense|toshiba-tv/i.test(ua);

  // "Aparelho modesto" = TV ou hardware realmente limitado (2 núcleos / 2 GB ou menos).
  var cores = Number(navigator.hardwareConcurrency) || 8;
  var memory = Number(navigator.deviceMemory) || 8;
  var lowPower = isTv || cores <= 2 || memory <= 2;

  if (isTv) root.className += " tv-mode";
  if (lowPower) root.className += " low-power-device";
  window.LUMI_ENV = { isTv: isTv, lowPower: lowPower, cores: cores, memory: memory };

  function notice(message) {
    function add() {
      if (document.getElementById("lumiCompatNotice")) return;
      var box = document.createElement("div");
      box.id = "lumiCompatNotice";
      box.setAttribute("role", "alert");
      box.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:18px 22px;background:#1e2748;color:#f0f3ff;font:17px/1.5 system-ui,sans-serif;text-align:center;border-top:3px solid #8d38f8";
      box.textContent = message;
      document.body.appendChild(box);
    }
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
  }

  // Erro de sintaxe nos scripts = navegador sem suporte à linguagem moderna usada pelo site.
  window.addEventListener("error", function (event) {
    var file = String((event && event.filename) || "");
    if (/assets\/js\/(app|ui)\.js/.test(file) && /syntax|unexpected|invalid|missing/i.test(String(event.message))) {
      notice("Este navegador é antigo demais para o LumiPlay. Atualize o navegador ou o sistema da TV, ou abra o site em outro aparelho.");
    }
  }, true);

  // Sem aspect-ratio o layout das capas sai desalinhado: avisa, mas deixa tentar.
  try {
    if (!(window.CSS && CSS.supports && CSS.supports("aspect-ratio", "1 / 1"))) {
      notice("Seu navegador está desatualizado e algumas partes do LumiPlay podem aparecer desalinhadas. Atualize-o para a melhor experiência.");
    }
  } catch (e) { /* ignora */ }
})();
