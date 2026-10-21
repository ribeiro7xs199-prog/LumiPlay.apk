#!/usr/bin/env python3
"""Verificação estática do LumiPlay. Rode antes de publicar:  python3 scripts/verify-release.py

Confere estrutura, referências entre HTML/CSS/JS, sintaxe do JavaScript, regras de
compatibilidade com TVs, cabeçalhos de segurança, ausência de segredos e a presença
das funcionalidades principais. Não substitui testar o site no navegador.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
failures = []


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def section(title):
    print(f"\n# {title}")


def check(name, ok, detail=""):
    if ok:
        print(f"  ok    {name}")
    else:
        print(f"  FALHA {name}" + (f" -> {detail}" if detail else ""))
        failures.append(name)


def strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


# ---------------------------------------------------------------- arquivos
section("Arquivos obrigatórios")
required = [
    "index.html", "404.html", "manifest.webmanifest", "robots.txt", "_headers",
    "assets/css/styles.css", "assets/js/compat.js", "assets/js/ui.js", "assets/js/app.js",
    "assets/images/icon.svg", "assets/images/icon-192.png", "assets/images/icon-512.png",
    "assets/images/icon-maskable-512.png", "assets/images/apple-touch-icon.png",
    "assets/images/favicon-32.png", "assets/images/lumiplay-logo.png", "assets/images/lumiplay-logo.webp",
    "assets/images/og-cover.png", "data/catalog.json",
    "database/supabase-migration.sql", "database/supabase-tv-channels.sql", "database/supabase-user-sync.sql",
    "database/supabase-social-features.sql", "database/supabase-security-hardening.sql", "database/supabase-player-enhancements.sql",
    "docs/CHANGELOG.md", "docs/SECURITY.md", "README.md",
]
for rel in required:
    check(f"existe {rel}", (ROOT / rel).is_file())
leftovers = ["assets/posters", "ETAPA-24-CORRECAO-TEMPORADAS.md", "assets/images/lumiplay-icon.png"]
for rel in leftovers:
    check(f"removido {rel}", not (ROOT / rel).exists())
for bad in list(ROOT.rglob(".DS_Store")) + list(ROOT.rglob("__MACOSX")) + list(ROOT.rglob("Thumbs.db")):
    check(f"sem lixo de sistema ({bad.name})", False, str(bad))

html = read("index.html")
js = read("assets/js/app.js")
ui = read("assets/js/ui.js")
compat = read("assets/js/compat.js")
css = read("assets/css/styles.css")
css_code = strip_css_comments(css)

# -------------------------------------------------------------------- HTML
section("HTML")
ids = re.findall(r'\bid="([^"]+)"', html)
dups = sorted({i for i in ids if ids.count(i) > 1})
check("IDs únicos", not dups, ", ".join(dups))
check("idioma pt-BR", '<html lang="pt-BR"' in html)
check("viewport com viewport-fit=cover", "viewport-fit=cover" in html)
check("manifesto, theme-color e ícone iOS", all(x in html for x in ['rel="manifest"', 'name="theme-color"', 'rel="apple-touch-icon"']))
check("sem scripts inline (a CSP não permite)", not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html))
check("sem fontes remotas", "fonts.googleapis.com" not in html and "fonts.googleapis.com" not in css)
check("ordem dos scripts: compat, ui, app", html.find("compat.js") < html.find("ui.js") < html.find("app.js"))
check("ui.js e app.js com defer", 'defer src="assets/js/ui.js' in html and 'defer src="assets/js/app.js' in html)
versions = set(re.findall(r"\?v=([0-9.]+)", html + read("404.html")))
check("mesma versão (?v=) em todos os arquivos", len(versions) == 1, ", ".join(sorted(versions)))
check("há um único <h1>", len(re.findall(r"<h1[ >]", html)) == 1)
local_refs = set()
for attr in re.findall(r'(?:href|src|srcset)="([^"#]+)"', html):
    if re.match(r"^(https?:|data:|mailto:|tel:|#)", attr):
        continue
    local_refs.add(attr.split("?", 1)[0])
missing = sorted(r for r in local_refs if not (ROOT / r).exists())
check("todos os arquivos referenciados existem", not missing, ", ".join(missing))

# ----------------------------------------------------------------- contrato
section("Contrato entre HTML, JS e ícones")
used_ids = set(re.findall(r'\$\("#([A-Za-z0-9_-]+)', js + ui)) | set(re.findall(r'getElementById\("([^"]+)"', js + ui))
absent = sorted(i for i in used_ids if i not in set(ids))
check("todo ID usado pelo JavaScript existe no HTML", not absent, ", ".join(absent))
symbols = set(re.findall(r'<symbol id="i-([^"]+)"', html))
icon_uses = set(re.findall(r'<use href="#i-([^"]+)"', html)) | set(re.findall(r'ICON\("([a-z0-9-]+)"', js)) | set(re.findall(r'#i-([a-z0-9-]+)', js))
icon_uses |= set(re.findall(r'setButton\([^,]+,\s*"([a-z0-9-]+)"', js))
check("todo ícone usado existe no sprite", not (icon_uses - symbols), ", ".join(sorted(icon_uses - symbols)))
check("sem ícones sobrando no sprite", not (symbols - icon_uses), ", ".join(sorted(symbols - icon_uses)))
modal_map = dict(re.findall(r'(\w+):"(\w+Modal)"', re.search(r"const modalIds = \{(.*?)\};", js, re.S).group(1)))
check("mapa de janelas aponta para IDs existentes", all(v in ids for v in modal_map.values()), str([v for v in modal_map.values() if v not in ids]))
closers = set(re.findall(r'data-close="(\w+)"', html))
check("todo data-close tem janela correspondente", closers <= set(modal_map), str(closers - set(modal_map)))
check("toda janela do HTML está no mapa (inclui Perfis)", {m for m in ids if m.endswith("Modal")} <= set(modal_map.values()), str({m for m in ids if m.endswith("Modal")} - set(modal_map.values())))
views = set(re.findall(r'data-nav="(\w+)"', html))
check("data-nav usa só telas conhecidas", views <= {"home", "movies", "series", "tv", "list", "history"}, str(views))
check("todos os modais têm role=dialog, aria-modal e título", all(re.search(rf'id="{m}"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="\w+"', html) for m in modal_map.values()))

# ---------------------------------------------------------------------- JS
section("JavaScript")
node = shutil.which("node")
if node:
    for rel in ["assets/js/compat.js", "assets/js/ui.js", "assets/js/app.js"]:
        result = subprocess.run([node, "--check", str(ROOT / rel)], capture_output=True, text=True)
        check(f"sintaxe válida: {rel}", result.returncode == 0, result.stderr.strip().splitlines()[-1] if result.stderr else "")
else:
    print("  (node não encontrado: sintaxe do JavaScript não verificada)")
check("compat.js é ES5 (sem ?., ??, =>, let/const)", not re.search(r"\?\.|\?\?|=>|\blet\b|\bconst\b", compat))
for token in ["eval(", "new Function(", "document.write(", "innerHTML +="]:
    check(f"sem {token}", token not in js + ui + compat)
check("nenhuma chamada às APIs novas demais para TVs (at(), hasOwn, structuredClone, replaceChildren só com guarda)", not re.search(r"\.at\(|Object\.hasOwn|structuredClone|AbortSignal\.timeout", js + ui))
check("sem chave secreta ou service_role", not re.search(r"service_role|sb_secret_|BEGIN (RSA|PRIVATE)", js + ui + compat + html))
jwts = re.findall(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", js + html)
check("nenhum JWT embutido com papel de serviço", not any("service_role" in __import__("base64").urlsafe_b64decode(j.split(".")[1] + "==").decode("utf-8", "ignore") for j in jwts))
uid = re.search(r'ADMIN_UID = "([0-9a-f-]{36})"', js)
check("ADMIN_UID definido", bool(uid))
for rel in ["database/supabase-migration.sql", "database/supabase-tv-channels.sql", "database/supabase-social-features.sql"]:
    check(f"mesmo UID administrador em {rel}", bool(uid) and uid.group(1) in read(rel))

# --------------------------------------------------------------------- CSS
section("CSS e compatibilidade com TV")
check("chaves balanceadas", css_code.count("{") == css_code.count("}"))
check("parênteses balanceados", css_code.count("(") == css_code.count(")"))
for needle, why in [(":has(", ":has()"), ("@container", "container queries"), ("color-mix(", "color-mix()"), ("@layer", "@layer"), ("@property", "@property")]:
    check(f"sem {why} (TVs com Chromium 94)", needle not in css_code)
bad_dvh = []
for block in re.findall(r"\{([^{}]*)\}", css_code):
    decls = [d.strip() for d in block.split(";") if ":" in d]
    for i, decl in enumerate(decls):
        prop, value = decl.split(":", 1)
        if "dvh" in value and not any(d.split(":", 1)[0].strip() == prop.strip() and "dvh" not in d and "vh" in d for d in decls[:i]):
            bad_dvh.append(decl[:60])
check("toda unidade dvh tem alternativa em vh logo antes", not bad_dvh, "; ".join(bad_dvh))
check("poucos !important (evita voltar à guerra de sobreposições)", css_code.count("!important") <= 40, str(css_code.count("!important")))
check("respeita prefers-reduced-motion", "prefers-reduced-motion" in css_code)
check("usa áreas seguras (env(safe-area-inset-*))", "safe-area-inset" in css_code)
check("modo TV e aparelho modesto no CSS", ".tv-mode" in css_code and ".low-power-device" in css_code)
check("barra inferior no celular", ".tabbar" in css_code and "@media (max-width: 719px)" in css_code)
check("tamanho do arquivo CSS razoável (< 90 KB)", len(css.encode()) < 90_000, f"{len(css.encode())} bytes")

# ---------------------------------------------------------------- cabeçalhos
section("Cabeçalhos de segurança e cache")
headers = read("_headers")
csp = re.search(r"Content-Security-Policy:\s*(.+)", headers)
check("Content-Security-Policy presente", bool(csp))
if csp:
    for directive in ["default-src 'self'", "script-src 'self' https://cdn.jsdelivr.net", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "connect-src 'self' https://api.themoviedb.org https://*.supabase.co"]:
        check(f"CSP: {directive}", directive in csp.group(1))
    check("CSP não libera script inline nem eval", "unsafe-eval" not in csp.group(1) and not re.search(r"script-src[^;]*unsafe-inline", csp.group(1)))
for header in ["X-Content-Type-Options: nosniff", "Referrer-Policy:", "X-Frame-Options:", "Permissions-Policy:"]:
    check(f"cabeçalho {header.split(':')[0]}", header in headers)
check("_headers sem linha em branco dentro do bloco /*", "\n\n" not in headers.split("\n/\n")[0])
check("cache definido para css/js/imagens", all(p in headers for p in ["/assets/css/*", "/assets/js/*", "/assets/images/*"]))

# ---------------------------------------------------------------- manifesto
section("Instalação como app (PWA)")
manifest = json.loads(read("manifest.webmanifest"))
check("manifesto com nome, start_url e display", all(k in manifest for k in ["name", "start_url", "display"]))
check("ícones do manifesto existem", all((ROOT / i["src"]).exists() for i in manifest["icons"]))
check("tem ícone maskable e 512 px", any(i.get("purpose") == "maskable" for i in manifest["icons"]) and any(i["sizes"] == "512x512" for i in manifest["icons"]))
catalog = json.loads(read("data/catalog.json"))
check("data/catalog.json é uma lista não vazia", isinstance(catalog, list) and len(catalog) > 0)

# ---------------------------------------------------- funcionalidades (regressão)
section("Funcionalidades principais")
markers = [
    ("busca sem acento e com sinônimos", js, ["function normalizeSearch", "SEARCH_SYNONYMS", "levenshtein"]),
    ("busca com sugestões e capas", js, ["function renderSearchSuggestions", "data-suggest"]),
    ("perfis locais (e janela de Perfis mapeada)", js, ["PROFILES_KEY", 'profiles:"profilesModal"']),
    ("player: velocidade, mini player e legendas", js, ["playbackRate", "requestPictureInPicture", "subtitlesUrl"]),
    ("próximo episódio, tela cheia e trailer", js, ["function playNextEpisode", "togglePlayerFullscreen", "function playTrailer", "youtube-nocookie.com"]),
    ("compartilhar com link direto", js, ["navigator.share", "detailsRoute(item)"]),
    ("rotas e botão Voltar", js, ["VIEW_ROUTES", "popstate", "function releaseModalHistory"]),
    ("iframes sem poluir o histórico", js, ["function setFrame", "location.replace(url)"]),
    ("destaque: rotação, pausa e imagem larga", js, ["function setFeaturedIndex", "heroPaused", "function enrichFeaturedBackdrops"]),
    ("fileiras: continuar, em alta, recomendados e gêneros", js, ["function renderContinue", "function renderTrending", "function renderRecommendations", "function renderGenreRows"]),
    ("esqueletos e catálogo de contingência", js, ["function skeletonMarkup", "loadBundledCatalogFallback", 'fetch("data/catalog.json"']),
    ("imagens responsivas do TMDB", js, ["function tmdbSize", "srcset="]),
    ("gravação do catálogo agrupada", js, ["function scheduleSaveCatalog"]),
    ("canais de TV: confirmar nuvem e gravar antes de apagar", js, ["tvCloudReady", '.not("id", "in"']),
    ("progresso salvo ao sair da página", js, ["pagehide"]),
    ("Supabase carregado em segundo plano", js, ["function loadSupabaseInBackground", "script.async = true"]),
    ("proteções de texto e URL", js, ["function escapeHTML", "function safeURL", "function validHttpsUrl"]),
    ("comunidade: denúncia e identificação por navegador", js, ["reportCommunityComment", "visitor_id"]),
    ("modo TV e aparelho modesto (fonte única em compat.js)", js + compat, ["LUMI_ENV", "IS_TV", "LOW_POWER_DEVICE", "tizen"]),
    ("controle remoto: setas e tecla Voltar", ui, ["function pickNext", "BACK_KEYS", "10009"]),
    ("janelas acessíveis: foco preso e retorno de foco", ui, ["FOCUSABLE", "MutationObserver", "function restoreFocus"]),
    ("aviso para navegadores antigos", compat, ["Este navegador é antigo demais"]),
]
for name, source, needles in markers:
    missing = [n for n in needles if n not in source]
    check(name, not missing, ", ".join(missing))

# ------------------------------------------------------------ banco de dados
section("Banco de dados")
sql = {p.name: p.read_text(encoding="utf-8") for p in (ROOT / "database").glob("*.sql")}
check("RLS ativo na biblioteca do usuário", "enable row level security" in sql.get("supabase-user-sync.sql", "").lower())
check("RLS ativo nos canais de TV", "enable row level security" in sql.get("supabase-tv-channels.sql", "").lower())
check("legendas limitadas a HTTPS", "https" in sql.get("supabase-player-enhancements.sql", "").lower())
readme = read("README.md")
check("README cita todos os SQL na ordem", all(name in readme for name in sql))

print()
if failures:
    print(f"{len(failures)} verificação(ões) falharam.")
    sys.exit(1)
print("Todas as verificações passaram.")
