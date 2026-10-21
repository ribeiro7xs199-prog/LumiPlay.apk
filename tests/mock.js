// Dados simulados do TMDB, imagens SVG e stub do Supabase para os testes automatizados.
const MOVIES = ["Noite Sem Fim","O Último Farol","Horizonte Vermelho","Entre Dois Mundos","A Casa do Lago Escuro","Código Aurora","Rota de Fuga","O Voo da Coruja","Maré Alta","Cidade de Vidro","Velocidade Total","O Segredo do Vale","Fora de Órbita","A Última Estação","Sombras de Verão","Coração de Ferro","Terra Prometida","O Jardim Secreto","Linha do Tempo","A Grande Travessia","Duelo ao Pôr do Sol","Mar de Estrelas","O Mapa Perdido","A Herança"];
const SERIES = ["Os Guardiões da Colina","Plantão Noturno","A Família Lopes","Fronteira Norte","Detetives do Bairro","Código Vermelho","Ilha dos Esquecidos","Rainhas do Sertão","Laboratório 7","A Vila Encantada","Meia-Noite em Lisboa","Ondas de Choque"];
const GENRE_SETS = [[28,12],[18,10749],[35,10751],[53,80],[878,12],[27,9648],[16,10751],[14,12],[18,80],[28,53],[35,18],[9648,53]];
const CAST = ["Marina Duarte","Caio Fernandes","Lúcia Andrade","Rafael Monteiro","Beatriz Nogueira","Tiago Salles","Helena Prado","Otávio Ramos","Camila Veiga","Bruno Tavares"];
const OVERVIEW = ["Quando um segredo antigo vem à tona, uma família inteira precisa decidir entre a verdade e a segurança que construiu ao longo de décadas.","Em uma cidade que nunca dorme, dois desconhecidos descobrem que seus caminhos se cruzam desde o dia em que tudo mudou.","Uma jornada improvável leva um grupo de amigos até o fim do mapa, onde cada escolha tem um preço que ninguém imaginava pagar.","Depois de anos longe, ela volta para a pequena cidade onde cresceu e encontra mistérios que preferiria ter deixado enterrados.","Uma equipe de especialistas tem apenas 48 horas para impedir um desastre que já começou, mas quem está no comando não é quem parece."];
function rand(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

const ALL = [];
MOVIES.forEach((title, i) => { const r = rand(1001 + i); ALL.push({id: 1001 + i, media_type: "movie", title, overview: OVERVIEW[i % OVERVIEW.length], poster_path: `/pst${1001 + i}.jpg`, backdrop_path: `/bdp${1001 + i}.jpg`, genre_ids: GENRE_SETS[i % GENRE_SETS.length], release_date: `${2012 + (i * 7) % 14}-0${1 + i % 9}-1${i % 9}`, vote_average: 5.5 + r() * 3.5, popularity: 100 - i}); });
SERIES.forEach((name, i) => { const r = rand(2001 + i); ALL.push({id: 2001 + i, media_type: "tv", name, overview: OVERVIEW[(i + 2) % OVERVIEW.length], poster_path: `/pst${2001 + i}.jpg`, backdrop_path: `/bdp${2001 + i}.jpg`, genre_ids: i === 0 ? [10759, 18] : GENRE_SETS[(i + 3) % GENRE_SETS.length], first_air_date: `${2014 + (i * 5) % 12}-0${1 + i % 9}-0${1 + i % 8}`, vote_average: 6 + r() * 3, popularity: 90 - i}); });
const titleOf = e => e.title || e.name;
const byId = id => ALL.find(e => e.id === Number(id));
const mixed = () => { const out = []; for (let i = 0; i < Math.max(MOVIES.length, SERIES.length); i++) { if (ALL[i]) out.push(ALL[i]); if (ALL[MOVIES.length + i]) out.push(ALL[MOVIES.length + i]); } return out; };
const norm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function tmdbResponse(path, params) {
  const page = Number(params.get("page") || 1), per = 20;
  const paged = list => ({page, results: list.slice((page - 1) * per, page * per), total_pages: Math.ceil(list.length / per), total_results: list.length});
  let m;
  if (path === "trending/all/week") return paged(mixed());
  if (/^discover\/(movie|tv)$/.test(path)) return paged(ALL.filter(e => e.media_type === path.split("/")[1]).map(e => ({...e, media_type: undefined})));
  if (/^search\/(multi|tv)$/.test(path)) { const q = norm(params.get("query")); return paged(ALL.filter(e => norm(titleOf(e)).includes(q) && (path === "search/multi" || e.media_type === "tv"))); }
  if ((m = path.match(/^(movie|tv)\/(\d+)\/credits$/))) return {cast: CAST.map((name, i) => ({id: 9000 + i, name, character: `Personagem ${i + 1}`, profile_path: `/prf${i}.jpg`}))};
  if ((m = path.match(/^(movie|tv)\/(\d+)\/recommendations$/))) { const base = Number(m[2]); return {results: ALL.filter(e => e.id !== base && e.media_type === m[1]).slice(0, 10)}; }
  if ((m = path.match(/^(movie|tv)\/(\d+)\/videos$/))) return {results: [{site: "YouTube", key: "dQw4w9WgXcQ", type: "Trailer", official: true, iso_639_1: "pt"}]};
  if ((m = path.match(/^tv\/(\d+)\/season\/(\d+)$/))) { const n = Number(m[2]), count = n === 1 ? 8 : 6; return {season_number: n, episodes: Array.from({length: count}, (_, i) => ({id: Number(m[1]) * 100 + n * 10 + i, episode_number: i + 1, season_number: n, name: `Episódio ${i + 1}: ${["A chegada","O primeiro sinal","Segredos à mesa","A ponte","Sem volta","Dívidas antigas","O plano","Despedida"][i % 8]}`, overview: `${OVERVIEW[(i + n) % OVERVIEW.length]}`, still_path: `/stl${n}${i}.jpg`}))}; }
  if ((m = path.match(/^(movie|tv)\/(\d+)$/))) { const e = byId(m[2]); if (!e) return null; return {...e, genres: e.genre_ids.map(id => ({id})), ...(m[1] === "tv" ? {seasons: [{season_number: 1, name: "Temporada 1", episode_count: 8}, {season_number: 2, name: "Temporada 2", episode_count: 6}, {season_number: 3, name: "Temporada 3", episode_count: 6}]} : {})}; }
  return {results: []};
}

const esc = t => String(t).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
function wrap(text, max) { const words = text.split(" "), lines = []; let cur = ""; words.forEach(w => { if ((cur + " " + w).trim().length > max) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }); if (cur) lines.push(cur); return lines; }
function imageSVG(file) {
  const num = Number((file.match(/(\d+)/) || [0, 1])[1]);
  const hue = (num * 47) % 360, hue2 = (hue + 50) % 360;
  if (file.startsWith("pst")) {
    const e = byId(num); const lines = wrap(e ? titleOf(e) : "Título", 14);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},62%,40%)"/><stop offset="1" stop-color="hsl(${hue2},70%,14%)"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><circle cx="320" cy="140" r="150" fill="rgba(255,255,255,.07)"/><circle cx="90" cy="330" r="90" fill="rgba(0,0,0,.18)"/><g font-family="Arial,Helvetica,sans-serif" font-weight="800" fill="#fff" font-size="40">${lines.map((l, i) => `<text x="28" y="${470 - (lines.length - 1) * 46 + i * 46}">${esc(l)}</text>`).join("")}</g></svg>`;
  }
  if (file.startsWith("bdp")) {
    const e = byId(num);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},58%,32%)"/><stop offset=".6" stop-color="hsl(${hue2},60%,20%)"/><stop offset="1" stop-color="hsl(${(hue2 + 40) % 360},55%,10%)"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1180" cy="330" r="360" fill="rgba(255,255,255,.07)"/><circle cx="1350" cy="560" r="200" fill="rgba(255,255,255,.05)"/><path d="M0 700 L420 520 L760 640 L1100 470 L1600 650 L1600 900 L0 900Z" fill="rgba(0,0,0,.32)"/><text x="1000" y="470" font-family="Arial" font-weight="800" font-size="120" fill="rgba(255,255,255,.16)">${esc(e ? titleOf(e).split(" ")[0] : "")}</text></svg>`;
  }
  if (file.startsWith("stl")) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225"><defs><linearGradient id="g"><stop offset="0" stop-color="hsl(${hue},50%,34%)"/><stop offset="1" stop-color="hsl(${hue2},60%,16%)"/></linearGradient></defs><rect width="400" height="225" fill="url(#g)"/><circle cx="300" cy="80" r="90" fill="rgba(255,255,255,.08)"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="hsl(${hue},40%,35%)"/><circle cx="100" cy="78" r="38" fill="rgba(255,255,255,.55)"/><path d="M30 200 Q100 100 170 200Z" fill="rgba(255,255,255,.55)"/></svg>`;
}

// Stub do supabase-js: qualquer encadeamento de métodos devolve a mesma "promessa" com os dados configurados em window.__SB__.
const SUPABASE_STUB = `(function(){
  var ADMIN = "f6144686-40dd-4e8e-8e4d-e49febce94ec";
  function cfg(){ return window.__SB__ || {}; }
  function log(entry){ (window.__SB_LOG__ = window.__SB_LOG__ || []).push(entry); }
  function builder(table){
    var calls = [];
    var proxy = new Proxy({}, { get: function(_, prop){
      if (prop === "then") return function(resolve, reject){
        var data = (cfg().tables || {})[table];
        log({table: table, calls: calls.map(function(c){ return c[0]; }), args: calls.map(function(c){ return c[1]; })});
        var single = calls.some(function(c){ return c[0] === "maybeSingle" || c[0] === "single"; });
        var out = data === undefined ? [] : data;
        if (single) out = Array.isArray(out) ? (out[0] === undefined ? null : out[0]) : out;
        return Promise.resolve({data: out, error: (cfg().errors || {})[table] || null}).then(resolve, reject);
      };
      return function(){ calls.push([prop, Array.prototype.slice.call(arguments)]); return proxy; };
    }});
    return proxy;
  }
  function client(key){
    return {
      from: builder,
      auth: {
        getSession: function(){ var s = key === "admin" ? cfg().adminSession : cfg().userSession; return Promise.resolve({data: {session: s || null}}); },
        onAuthStateChange: function(){ return {data: {subscription: {unsubscribe: function(){}}}}; },
        signInWithPassword: function(o){ return Promise.resolve({data: {user: {id: ADMIN, email: o.email}, session: {user: {id: ADMIN, email: o.email}}}, error: null}); },
        signOut: function(){ return Promise.resolve({error: null}); },
        signUp: function(){ return Promise.resolve({data: {}, error: null}); }
      },
      rpc: function(){ return Promise.resolve({data: null, error: null}); }
    };
  }
  var n = 0;
  window.supabase = { createClient: function(){ n++; return client(n === 1 ? "admin" : "user"); } };
})();`;

module.exports = {ALL, tmdbResponse, imageSVG, SUPABASE_STUB, titleOf};
