/* LumiPlay — comportamentos genéricos de interface.
   Não conhece dados nem regras de negócio (isso é do app.js): cuida de menu, busca no
   celular, setas das fileiras, foco dentro das janelas, gestos e controle remoto de TV. */
(function () {
  "use strict";
  var root = document.documentElement;
  var IS_TV = root.classList.contains("tv-mode");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (selector, scope) { return (scope || document).querySelector(selector); };
  var $$ = function (selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); };
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

  function isVisible(el) {
    if (!el || el.disabled) return false;
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (n.classList && n.classList.contains("hidden")) return false;
    }
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function focusables(scope) { return $$(FOCUSABLE, scope).filter(isVisible); }
  function openModals() { return $$(".modal").filter(function (m) { return !m.classList.contains("hidden"); }); }
  function topModal() { var open = openModals(); return open.length ? open[open.length - 1] : null; }

  /* ---------- Link "Pular para o conteúdo" (sem alterar a URL) ---------- */
  var skipLink = $(".skip-link");
  if (skipLink) skipLink.addEventListener("click", function (event) {
    var main = $("#main");
    if (!main) return;
    event.preventDefault();
    main.focus({ preventScroll: true });
    main.scrollIntoView();
  });

  /* ---------- Cabeçalho: sombra ao rolar ---------- */
  var topbar = $("#topbar");
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () { ticking = false; if (topbar) topbar.classList.toggle("is-scrolled", window.scrollY > 24); });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Busca: ícone que expande em telas pequenas ---------- */
  var searchInput = $("#searchInput");
  var searchToggle = $("#searchToggle");
  var searchWrap = $("#searchWrap");
  var compactSearch = function () { return window.matchMedia("(max-width: 1023px)").matches; };
  function setSearchOpen(open) {
    if (!topbar || !searchToggle) return;
    topbar.classList.toggle("search-open", open);
    searchToggle.setAttribute("aria-expanded", String(open));
    if (open && searchInput) searchInput.focus();
  }
  if (searchToggle) searchToggle.addEventListener("click", function () { if (compactSearch()) setSearchOpen(!topbar.classList.contains("search-open")); else if (searchInput) searchInput.focus(); });
  var searchClear = $("#searchClear");
  if (searchClear) searchClear.addEventListener("click", function () {
    // Se já estava vazio, o segundo toque fecha a busca (o app.js limpa o texto no primeiro).
    if (compactSearch() && searchInput && !searchInput.value) setSearchOpen(false);
  });
  if (searchWrap) searchWrap.addEventListener("focusout", function (event) {
    if (!compactSearch() || !topbar.classList.contains("search-open")) return;
    var next = event.relatedTarget;
    if (next && searchWrap.contains(next)) return;
    window.setTimeout(function () { if (searchInput && !searchInput.value && !searchWrap.contains(document.activeElement)) setSearchOpen(false); }, 120);
  });
  document.addEventListener("keydown", function (event) {
    var tag = (event.target && event.target.tagName) || "";
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (event.target && event.target.isContentEditable);
    if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey && !topModal()) {
      event.preventDefault();
      if (compactSearch()) setSearchOpen(true); else if (searchInput) searchInput.focus();
    }
  });

  /* ---------- Menu do perfil ---------- */
  var menuButton = $("#userMenuButton");
  var menuPanel = $("#userMenuPanel");
  function setMenu(open, returnFocus) {
    if (!menuButton || !menuPanel) return;
    menuPanel.classList.toggle("hidden", !open);
    menuButton.setAttribute("aria-expanded", String(open));
    if (open) { var first = focusables(menuPanel)[0]; if (first) first.focus(); }
    else if (returnFocus) menuButton.focus();
  }
  if (menuButton) menuButton.addEventListener("click", function () { setMenu(menuPanel.classList.contains("hidden")); });
  document.addEventListener("click", function (event) {
    if (!menuPanel || menuPanel.classList.contains("hidden")) return;
    var item = event.target.closest && event.target.closest(".menu-item");
    if (item) { setMenu(false); return; }
    if (!event.target.closest("#userMenu")) setMenu(false);
  });
  document.addEventListener("keydown", function (event) {
    if (!menuPanel || menuPanel.classList.contains("hidden")) return;
    if (event.key === "Escape") { event.stopImmediatePropagation(); setMenu(false, true); return; }
    if (menuPanel.contains(document.activeElement) && /^(ArrowDown|ArrowUp|Home|End)$/.test(event.key)) {
      event.preventDefault();
      var items = focusables(menuPanel), index = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown") index = (index + 1) % items.length;
      else if (event.key === "ArrowUp") index = (index - 1 + items.length) % items.length;
      else index = event.key === "Home" ? 0 : items.length - 1;
      items[index].focus();
    }
  }, true);

  /* ---------- Fileiras: setas e estado dos botões ---------- */
  function updateRow(track) {
    var section = track.closest(".row-section");
    if (!section) return;
    var prev = $('[data-row="prev"]', section), next = $('[data-row="next"]', section);
    if (!prev || !next) return;
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  }
  function updateAllRows() { $$(".row-section .row-track").forEach(updateRow); }
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-row]");
    if (!button) return;
    var section = button.closest(".row-section");
    var track = section && $(".row-track", section);
    if (!track) return;
    var direction = button.getAttribute("data-row") === "next" ? 1 : -1;
    track.scrollBy({ left: direction * Math.max(240, track.clientWidth * 0.85), behavior: reduceMotion ? "auto" : "smooth" });
  });
  var rowFrame = 0;
  document.addEventListener("scroll", function (event) {
    var t = event.target;
    if (!t || !t.classList || !t.classList.contains("row-track")) return;
    if (rowFrame) return;
    rowFrame = window.requestAnimationFrame(function () { rowFrame = 0; updateRow(t); });
  }, true);
  window.addEventListener("resize", function () { window.requestAnimationFrame(updateAllRows); });
  var homeRows = $("#homeRows");
  if (homeRows && window.MutationObserver) new MutationObserver(function () { window.requestAnimationFrame(updateAllRows); }).observe(homeRows, { childList: true, subtree: true });

  /* ---------- Imagens com entrada suave (hero e detalhes) ---------- */
  document.addEventListener("load", function (event) {
    var img = event.target;
    if (img && img.tagName === "IMG" && img.hasAttribute("data-keep")) { img.classList.add("is-loaded"); img.classList.remove("is-empty"); }
  }, true);

  /* ---------- Gesto de deslizar no destaque (celular) ---------- */
  var hero = $("#hero");
  if (hero) {
    var startX = 0, startY = 0, tracking = false;
    hero.addEventListener("touchstart", function (e) { if (e.touches.length !== 1) return; tracking = true; startX = e.touches[0].clientX; startY = e.touches[0].clientY; }, { passive: true });
    hero.addEventListener("touchend", function (e) {
      if (!tracking) return; tracking = false;
      var t = e.changedTouches[0], dx = t.clientX - startX, dy = t.clientY - startY;
      if (Math.abs(dx) < 56 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      var button = $(dx < 0 ? "#heroNext" : "#heroPrevious");
      if (button) button.click();
    }, { passive: true });
  }

  /* ---------- Janelas: foco, retorno de foco e leitores de tela ---------- */
  var chrome = ["header.topbar", "main", "footer.footer", "nav.tabbar"];
  function syncModalState() {
    var anyOpen = openModals().length > 0;
    chrome.forEach(function (selector) {
      var el = $(selector);
      if (!el) return;
      if (anyOpen) el.setAttribute("aria-hidden", "true"); else el.removeAttribute("aria-hidden");
    });
  }
  // Se a lista for redesenhada enquanto a janela está aberta, o botão de origem deixa de existir:
  // guardamos um seletor estável (id ou data-*) para reencontrá-lo ao fechar.
  var STABLE_ATTRS = ["data-open", "data-related-id", "data-hero-index", "data-nav", "data-tv-play", "data-suggest", "data-genre-jump", "data-fav", "data-recent-search"];
  function selectorFor(el) {
    if (!el || el === document.body || !el.getAttribute) return "";
    if (el.id) return "#" + el.id;
    for (var i = 0; i < STABLE_ATTRS.length; i++) {
      var value = el.getAttribute(STABLE_ATTRS[i]);
      if (value !== null) return "[" + STABLE_ATTRS[i] + '="' + String(value).replace(/["\\]/g, "\\$&") + '"]';
    }
    return "";
  }
  function restoreFocus(node, selector) {
    var target = node && node !== document.body && document.contains(node) && isVisible(node) ? node : null;
    if (!target && selector) target = $$(selector).filter(isVisible)[0] || null;
    if (target) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignora */ } }
  }
  $$(".modal").forEach(function (modal) {
    var wasOpen = !modal.classList.contains("hidden");
    var panel = $(".modal-panel", modal);
    if (panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
    if (!window.MutationObserver) return;
    new MutationObserver(function () {
      var open = !modal.classList.contains("hidden");
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) {
        modal._returnFocus = document.activeElement;
        modal._returnSelector = selectorFor(document.activeElement);
        syncModalState();
        window.setTimeout(function () {
          if (!panel || modal.classList.contains("hidden")) return;
          var target = IS_TV ? ($(".button-primary", panel) || $(".modal-close", panel)) : null;
          (target && isVisible(target) ? target : panel).focus({ preventScroll: true });
        }, 30);
      } else {
        syncModalState();
        var back = modal._returnFocus, selector = modal._returnSelector;
        modal._returnFocus = null; modal._returnSelector = "";
        if (!topModal()) restoreFocus(back, selector);
      }
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Tab") return;
    var modal = topModal();
    if (!modal) return;
    var items = focusables($(".modal-panel", modal) || modal);
    if (!items.length) { event.preventDefault(); return; }
    var first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (!modal.contains(active) || active === $(".modal-panel", modal)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  });

  /* ---------- Controle remoto (modo TV): navegação espacial pelas setas ---------- */
  var DIRECTIONS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  var BACK_KEYS = { 10009: 1, 461: 1 };
  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function pickNext(current, direction, scope) {
    var cr = current.getBoundingClientRect(), cc = center(cr), best = null, bestScore = Infinity;
    focusables(scope).forEach(function (el) {
      if (el === current || (current.contains && current.contains(el)) || el.tagName === "VIDEO") return;
      var r = el.getBoundingClientRect(), c = center(r), primary, secondary;
      if (direction === "right") { if (c.x <= cc.x + 2 || r.left < cr.left) return; primary = Math.max(0, r.left - cr.right); secondary = Math.abs(c.y - cc.y); }
      else if (direction === "left") { if (c.x >= cc.x - 2 || r.right > cr.right) return; primary = Math.max(0, cr.left - r.right); secondary = Math.abs(c.y - cc.y); }
      else if (direction === "down") { if (c.y <= cc.y + 2 || r.top < cr.top) return; primary = Math.max(0, r.top - cr.bottom); secondary = Math.abs(c.x - cc.x); }
      else { if (c.y >= cc.y - 2 || r.bottom > cr.bottom) return; primary = Math.max(0, cr.top - r.bottom); secondary = Math.abs(c.x - cc.x); }
      var score = primary + secondary * 2.4;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }
  function focusEl(el) {
    el.focus({ preventScroll: true });
    try { el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" }); } catch (e) { el.scrollIntoView(); }
  }
  if (IS_TV) {
    document.addEventListener("keydown", function (event) {
      if (event.defaultPrevented) return;
      if (BACK_KEYS[event.keyCode]) {
        if (topModal() || window.location.hash.length > 2) { event.preventDefault(); window.history.back(); }
        return;
      }
      var direction = DIRECTIONS[event.key];
      if (!direction) return;
      var target = event.target;
      var tag = (target && target.tagName) || "";
      if (tag === "SELECT" || tag === "VIDEO" || (target && target.closest && target.closest("iframe"))) return;
      var textual = tag === "TEXTAREA" || (tag === "INPUT" && /^(text|search|email|password|url|tel|number)$/.test(target.type));
      if (textual && (direction === "left" || direction === "right")) return;
      var scope = topModal() || document.body;
      var current = (target && target !== document.body && scope.contains(target) && isVisible(target)) ? target : null;
      event.preventDefault();
      if (!current) {
        var starts = focusables(topModal() ? ($(".modal-panel", topModal()) || scope) : $("#main") || scope);
        var firstVisible = starts.filter(function (el) { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; })[0] || starts[0];
        if (firstVisible) focusEl(firstVisible);
        return;
      }
      var next = pickNext(current, direction, scope);
      if (next) focusEl(next);
    });
  }

  window.LumiUI = { updateAllRows: updateAllRows, isVisible: isVisible, focusables: focusables, topModal: topModal };
})();
