(() => {
  "use strict";
  // Ambiente detectado em compat.js (TV, aparelho modesto).
  const ENV = window.LUMI_ENV || {isTv:false, lowPower:false};
  const IS_TV = Boolean(ENV.isTv);
  // Imagens remotas que falham (a CSP não permite onerror inline): marca o contêiner e remove a imagem.
  document.addEventListener("error", event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.hasAttribute("data-keep")) { img.removeAttribute("src"); img.classList.add("is-empty"); img.classList.remove("is-loaded"); return; }
    const holder = img.closest(".poster, .cast-photo, .tv-card-logo, .episode-thumb, .suggestion-thumb");
    if (holder) holder.classList.add("is-broken");
    img.remove();
  }, true);
  const STORAGE_KEY = "cinebase.catalog.v2";
  const OLD_STORAGE_KEY = "cinebase.catalog.v1";
  const FAVORITES_KEY = "cinebase.favorites.v1";
  const PROGRESS_KEY = "cinebase.progress.v1";
  const WATCH_HISTORY_KEY = "lumiplay.watch-history.v1";
  const USER_ACCOUNT_KEY = "lumiplay.user.account.v1";
  const RECENT_SEARCHES_KEY = "lumiplay.recent-searches.v1";
  const TMDB_CACHE_KEY = "lumiplay.tmdb.cache.v1";
  const COMMUNITY_RATINGS_KEY = "lumiplay.community.ratings.v1";
  const TMDB_CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 dias
  const DISCOVERY_CACHE_TTL = 1000 * 60 * 10; // 10 minutos
  const TMDB_KEY = "cinebase.tmdb.credential.v1";
  // Chave pública de API do TMDB configurada pelo responsável do site.
  // Qualquer chave usada no frontend pode ser vista por visitantes; nunca use aqui um segredo privado.
  const TMDB_DEFAULT_API_KEY = "8ced9e0237b3d632101272af66ec69b5";
  const TMDB_AUTO_KEY = "cinebase.tmdb.autoload.v1";
  let searchTimer = null;
  let localSearchTimer = null;
  let discoveryPage = 1;
  let discoveryLoading = false;
  let discoveryHasMore = true;
  let bulkImportRunning = false;
  let bulkImportPause = false;
  const BULK_STATE_KEY = "lumiplay.tmdb.bulk.v1";
  // A chave padrão permite que o catálogo online funcione em novos aparelhos sem configuração manual.
  let tmdbCredential = localStorage.getItem(TMDB_KEY) || TMDB_DEFAULT_API_KEY;
  const $ = (selector) => document.querySelector(selector);
  // LumiPlay Supabase config: publishable key is intended for browser use; RLS protects writes.
  const SUPABASE_URL = "https://oogbmikjxargdsizrgom.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_F3ZlMBNtbsGz_s_hhyWFng_OCl2wJdt";
  const ADMIN_UID = "f6144686-40dd-4e8e-8e4d-e49febce94ec";
  const SUPABASE_SESSION_KEY = "lumiplay.supabase.session.v1";
  let supabaseClient = null;
  let userSupabaseClient = null;
  let userSession = null;
  let userSyncTimer = null;
  let adminSession = null;
  let backendReady = false;
  // O Supabase é carregado depois da primeira renderização para que uma CDN lenta
  // não atrase a abertura do catálogo na Samsung Tizen.
  let supabaseLoadStarted = false;
  let cloudFeaturesStarted = false;
  function initializeSupabaseClients() {
    if (!window.supabase?.createClient) return false;
    try {
      if (!supabaseClient) supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:SUPABASE_SESSION_KEY}});
      if (!userSupabaseClient) userSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:"lumiplay.user.session.v1"}});
      return true;
    } catch (error) { console.warn("Supabase indisponível", error); return false; }
  }
  function startCloudFeatures() {
    if (cloudFeaturesStarted) return;
    cloudFeaturesStarted = true;
    Promise.allSettled([loadSharedCatalog(), loadCommunityRatings(), refreshAdminState(), refreshAccountState()]);
  }
  function loadSupabaseInBackground() {
    if (initializeSupabaseClients()) { startCloudFeatures(); return; }
    if (supabaseLoadStarted) return;
    supabaseLoadStarted = true;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.async = true;
    script.onload = () => { if (initializeSupabaseClients()) startCloudFeatures(); };
    script.onerror = () => setBackendStatus("Serviços online indisponíveis. O catálogo local continua funcionando.", true);
    document.head.appendChild(script);
  }
  let activeFilter = "Tudo";
  let favoritesOnly = false;
  // TVs e aparelhos realmente limitados recebem lotes menores e menos efeitos (detecção em compat.js).
  const LOW_POWER_DEVICE = Boolean(ENV.lowPower);
  const DEFAULT_TITLE = document.title;
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CATALOG_BATCH_SIZE = LOW_POWER_DEVICE ? 18 : 30;
  // Estado da navegação e da interface (declarado cedo para evitar acesso antes da inicialização).
  let currentView = "home";
  let catalogLoading = true;
  let lastGridIds = [];
  let pendingDeepLink = "";
  let modalHistoryPushed = false;
  let suppressPopstate = false;
  let skipModalPush = false;
  let heroPaused = false;
  let heroRenderedId = "";
  let backdropEnriching = false;
  let backdropFailures = 0;
  let saveCatalogTimer = null;
  let genreOptionsKey = "";
  let catalogVisibleLimit = CATALOG_BATCH_SIZE;
  let selectedItemId = null;
  let detailsOpenToken = 0;
  let featuredItem = null;
  let featuredItems = [];
  let featuredIndex = 0;
  let featuredRotationTimer = null;
  let lastPlayback = null;
  let playbackRequestToken = 0;
  let playbackLoadTimer = null;
  let toastTimer = null;
  let progressTimer = null;
  const VISITOR_KEY = "lumiplay.visitor.v1";
  let visitorId = localStorage.getItem(VISITOR_KEY);
  if (!visitorId) { visitorId = (crypto.randomUUID ? crypto.randomUUID() : "v-" + Date.now().toString(36) + Math.random().toString(36).slice(2)); localStorage.setItem(VISITOR_KEY, visitorId); }
  let currentRating = 0;
  const preservedIds = new Set();
  let eventCounts = {clicks:0, completions:0};

  // Catálogo inicial vazio; nenhum título de demonstração.
  const starterCatalog = [];

  function safeParse(value, fallback) { try { const result = JSON.parse(value); return result ?? fallback; } catch (_) { return fallback; } }
  const PROFILES_KEY = "lumiplay.local.profiles.v1";
  const ACTIVE_PROFILE_KEY = "lumiplay.local.profile.active.v1";
  let profiles = safeParse(localStorage.getItem(PROFILES_KEY) || "[]", []).filter(p => p && typeof p.id === "string" && typeof p.name === "string").slice(0,5);
  if (!profiles.some(p => p.id === "main")) profiles.unshift({id:"main",name:"Principal",createdAt:Date.now()});
  profiles = profiles.slice(0,5);
  let activeProfileId = profiles.some(p => p.id === localStorage.getItem(ACTIVE_PROFILE_KEY)) ? localStorage.getItem(ACTIVE_PROFILE_KEY) : "main";
  // Initialize profile-scoped search history only after activeProfileId leaves the temporal dead zone.
  let recentSearches = safeParse(localStorage.getItem(profileStorageKey(RECENT_SEARCHES_KEY)) || localStorage.getItem(RECENT_SEARCHES_KEY) || "[]", []).filter(value => typeof value === "string").slice(0,8);
  function profileStorageKey(base, profileId=activeProfileId) { return profileId === "main" ? base : `${base}.${profileId}`; }
  function activeProfile() { return profiles.find(p => p.id === activeProfileId) || profiles[0] || {id:"main",name:"Principal"}; }
  function persistProfiles() { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId); } catch (_) {} }
  function profileStats(profileId) {
    const read = (key, fallback) => safeParse(localStorage.getItem(profileStorageKey(key, profileId)) || "", fallback);
    const favs = read(FAVORITES_KEY, []);
    const history = read(WATCH_HISTORY_KEY, []);
    const savedProgress = read(PROGRESS_KEY, {});
    return {
      favorites: Array.isArray(favs) ? favs.length : 0,
      watched: Array.isArray(history) ? history.length : 0,
      inProgress: savedProgress && typeof savedProgress === "object" ? Object.keys(savedProgress).length : 0
    };
  }
  function renderProfiles() {
    const list=$("#profileList"); if(!list) return;
    list.innerHTML=profiles.map(p=>{
      const stats=profileStats(p.id);
      const active=p.id===activeProfileId;
      return `<div class="profile-row"><div class="profile-avatar" aria-hidden="true">${escapeHTML((p.name||"P").slice(0,1).toLocaleUpperCase("pt-BR"))}</div><div class="profile-row-copy"><strong>${escapeHTML(p.name)}</strong><small>${active?"Perfil ativo":"Perfil local"}${p.id==="main"?", sincroniza com a conta":", somente neste dispositivo"}</small><small>${stats.favorites} salvos, ${stats.watched} vistos, ${stats.inProgress} em andamento</small></div><div class="profile-actions"><button class="button button-ghost" type="button" data-profile-switch="${escapeHTML(p.id)}" ${active?"disabled":""}>${active?"Ativo":"Usar"}</button><button class="button button-ghost" type="button" data-profile-rename="${escapeHTML(p.id)}" aria-label="Renomear perfil ${escapeHTML(p.name)}">Renomear</button>${p.id!=="main"?`<button class="button button-ghost" type="button" data-profile-delete="${escapeHTML(p.id)}" aria-label="Excluir perfil ${escapeHTML(p.name)}">Excluir</button>`:""}</div></div>`;
    }).join("");
    const initial=$("#avatarInitial"); if(initial) initial.textContent=(activeProfile().name||"P").slice(0,1).toLocaleUpperCase("pt-BR");
    const form=$("#profileForm"); if(form) form.classList.toggle("hidden",profiles.length>=5);
    const status=$("#profileStatus"); if(status) status.textContent=`Perfil atual: ${activeProfile().name}. ${profiles.length}/5 perfis. Os dados são locais, exceto a sincronização do Principal.`;
  }
  function renameProfile(profileId) {
    const profile=profiles.find(p=>p.id===profileId); if(!profile) return;
    const answer=prompt("Novo nome do perfil (até 24 caracteres):",profile.name);
    if(answer===null) return;
    const name=answer.trim().slice(0,24);
    if(!name) { showToast("O nome do perfil não pode ficar vazio."); return; }
    if(profiles.some(p=>p.id!==profileId&&p.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR"))) { showToast("Já existe um perfil com esse nome."); return; }
    profile.name=name; persistProfiles(); renderProfiles();
    if(profileId===activeProfileId) showToast(`Perfil renomeado para ${name}.`);
  }
  function switchProfile(nextId) {
    if(!profiles.some(p=>p.id===nextId)||nextId===activeProfileId) return;
    clearTimeout(userSyncTimer);
    activeProfileId=nextId; persistProfiles();
    favorites=safeParse(localStorage.getItem(profileStorageKey(FAVORITES_KEY))||"[]",[]);
    progress=safeParse(localStorage.getItem(profileStorageKey(PROGRESS_KEY))||"{}",{});
    watchHistory=safeParse(localStorage.getItem(profileStorageKey(WATCH_HISTORY_KEY))||"[]",[]);
    recentSearches=safeParse(localStorage.getItem(profileStorageKey(RECENT_SEARCHES_KEY))||"[]",[]).filter(v=>typeof v==="string").slice(0,8);
    $("#searchInput").value=""; favoritesOnly=false;
    if(userSession && activeProfileId==="main") loadUserState();
    else if(userSession) setAccountStatus("Perfil local ativo. A sincronização da conta fica limitada ao perfil Principal.");
    renderProfiles(); renderCatalog(); renderWatchHistory(); renderMyList();
    showToast(`Perfil alterado para ${activeProfile().name}.`);
  }
  function loadCatalog() {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) {
      const parsed = safeParse(current, null);
      if (Array.isArray(parsed)) return parsed;
    }
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old) {
      const parsed = safeParse(old, null);
      if (Array.isArray(parsed)) {
        const upgraded = parsed.map(item => ({seasons:[], ...item}));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded));
        return upgraded;
      }
    }
    return starterCatalog.map(item => ({...item, seasons: item.seasons || []}));
  }
  let catalog = loadCatalog();
  const CLEANUP_VERSION_KEY = "lumiplay.catalog.examples.cleaned.v2";
  if (localStorage.getItem(CLEANUP_VERSION_KEY) !== "yes") {
    // Remove only demo records from older builds. Never clear the user's whole catalog
    // during a version upgrade: real titles may exist only in this browser.
    const catalogBeforeCleanup = catalog.length;
    catalog = catalog.filter(item => !String(item?.id || "").startsWith("demo-"));
    if (catalog.length !== catalogBeforeCleanup) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog)); } catch (_) {}
    }
    localStorage.setItem(CLEANUP_VERSION_KEY, "yes");
  }
  let favorites = safeParse(localStorage.getItem(profileStorageKey(FAVORITES_KEY)) || "[]", []);
  let communityRatings = safeParse(localStorage.getItem(COMMUNITY_RATINGS_KEY) || "{}", {});
  let progress = safeParse(localStorage.getItem(profileStorageKey(PROGRESS_KEY)) || "{}", {});
  let watchHistory = safeParse(localStorage.getItem(profileStorageKey(WATCH_HISTORY_KEY)) || "[]", []);
  let tmdbCache = safeParse(localStorage.getItem(TMDB_CACHE_KEY) || "{}", {});
  function saveTmdbCache() {
    try { localStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(tmdbCache)); }
    catch (_) { /* cache é descartável; não impedir o uso do site se o armazenamento estiver cheio */ }
  }
  function cacheGet(key) {
    const entry = tmdbCache[key];
    if (!entry || !entry.savedAt || Date.now() - entry.savedAt > TMDB_CACHE_TTL) return null;
    return entry.value ?? null;
  }
  function cacheSet(key, value) {
    tmdbCache[key] = {savedAt:Date.now(), value};
    // Limita o cache para não encher o armazenamento de TVs antigas.
    const keys = Object.keys(tmdbCache);
    if (keys.length > 180) {
      keys.sort((a,b)=>(tmdbCache[a]?.savedAt||0)-(tmdbCache[b]?.savedAt||0));
      keys.slice(0, keys.length - 180).forEach(k => delete tmdbCache[k]);
    }
    saveTmdbCache();
  }
  function tmdbIdentity(item) {
    const match = String(item?.id || "").match(/^tmdb-(tv|movie)-(\d+)$/);
    const id = item?.tmdbId || (match ? match[2] : "");
    const type = item?.type === "Série" || item?.tmdbMediaType === "tv" || match?.[1] === "tv" ? "tv" : "movie";
    return /^\d+$/.test(String(id)) ? `${type}:${id}` : "";
  }
  function dedupeCatalog(items) {
    const output = [], byTmdb = new Map(), byId = new Map();
    for (const original of items || []) {
      if (!original) continue;
      const item = original; // preserva a identidade do objeto: referências já guardadas pela interface continuam válidas
      const identity = tmdbIdentity(item);
      const idKey = String(item.id || "");
      const priorIndex = (identity && byTmdb.has(identity)) ? byTmdb.get(identity) : byId.get(idKey);
      if (priorIndex !== undefined) {
        const prior = output[priorIndex];
        // Preferir metadados novos, mas preservar vídeo, temporadas e progresso já conhecidos.
        output[priorIndex] = {...prior, ...item,
          id: prior.id || item.id,
          tmdbId: prior.tmdbId || item.tmdbId,
          video: prior.video || item.video || "",
          seasons: (prior.seasons?.length ? prior.seasons : item.seasons) || [],
          dbId: prior.dbId || item.dbId};
        continue;
      }
      const index = output.length;
      output.push(item);
      byId.set(idKey, index);
      if (identity) byTmdb.set(identity, index);
    }
    return output;
  }

  function setBackendStatus(message, isError=false) {
    const el = $("#backendStatus");
    if (el) { el.textContent = message; el.classList.toggle("backend-error", !!isError); }
  }
  function rowToItem(row) {
    return {dbId:row.id, id:row.app_id || (row.tmdb_id ? `tmdb-${row.tipo === "serie" ? "tv" : "movie"}-${row.tmdb_id}` : `db-${row.id}`), title:row.titulo || "Sem título", type:row.tipo === "serie" ? "Série" : "Filme", genre:row.genero || "", year:row.ano ? String(row.ano) : "", description:row.sinopse || "", poster:row.capa_url || "", video:row.video_url || "", subtitlesUrl:safeVttURL(row.legendas_url || ""), color:"#6650a4", seasons:Array.isArray(row.temporadas) ? row.temporadas : [], tmdbId:row.tmdb_id || undefined};
  }
  function itemToRow(item) {
    const tmdbMatch = String(item.id || "").match(/^tmdb-(tv|movie)-(\d+)$/);
    return {app_id:String(item.id), tmdb_id:item.tmdbId || (tmdbMatch ? Number(tmdbMatch[2]) : null), titulo:String(item.title || "Sem título"), tipo:item.type === "Série" ? "serie" : "filme", ano:/^\d{4}$/.test(String(item.year||"")) ? Number(item.year) : null, genero:item.genre || "", capa_url:item.poster || "", sinopse:item.description || "", video_url:item.video || "", ...(safeVttURL(item.subtitlesUrl || "") ? {legendas_url:safeVttURL(item.subtitlesUrl)} : {}), temporadas:Array.isArray(item.seasons) ? item.seasons : []};
  }
  async function loadSharedCatalog() {
    if (!supabaseClient) { setBackendStatus("Não foi possível carregar a biblioteca Supabase. Confira a conexão com a internet.", true); return; }
    try {
      const {data, error} = await supabaseClient.from("catalogo").select("*").order("criado_em", {ascending:false});
      if (error) throw error;
      const shared = (data || []).map(rowToItem);
      // Shared rows take precedence; deduplicate by TMDB identity and internal ID.
      catalog = dedupeCatalog([...shared, ...catalog]);
      renderCatalog();
      backendReady = true;
      setBackendStatus("Banco online conectado. O catálogo compartilhado foi carregado.");
    } catch (error) {
      console.error("Falha ao carregar catálogo compartilhado", error);
      setBackendStatus("Não foi possível ler o banco. Confira se a coluna app_id foi criada e se a política de leitura está ativa.", true);
    }
  }
  async function saveItemToCloud(item) {
    if (!supabaseClient || !adminSession || adminSession.user?.id !== ADMIN_UID) return false;
    const {error} = await supabaseClient.from("catalogo").upsert(itemToRow(item), {onConflict:"app_id"});
    if (error) { console.error(error); showToast("Erro ao salvar no banco: " + error.message); return false; }
    return true;
  }
  async function deleteItemFromCloud(item) {
    if (!supabaseClient || !adminSession || adminSession.user?.id !== ADMIN_UID) {
      showToast("Entre como administrador para excluir do catálogo compartilhado.");
      return false;
    }
    try {
      let query = supabaseClient.from("catalogo").select("id,app_id,tmdb_id,tipo");
      if (item.dbId) query = query.eq("id", item.dbId);
      else if (item.tmdbId) query = query.eq("tmdb_id", Number(item.tmdbId)).eq("tipo", item.type === "Série" ? "serie" : "filme");
      else query = query.eq("app_id", String(item.id));
      const lookup = await query.limit(10);
      if (lookup.error) throw lookup.error;
      const rows = lookup.data || [];
      if (!rows.length) return true; // Não existe registro remoto para este item local.
      for (const row of rows) {
        let deletion = supabaseClient.from("catalogo").delete().eq("id", row.id).select("id");
        const result = await deletion;
        if (result.error) throw result.error;
        if (!result.data || !result.data.length) throw new Error("Nenhuma linha foi excluída. Verifique as políticas RLS do Supabase e se você está conectado como administrador.");
      }
      return true;
    } catch (error) {
      console.error("Falha ao excluir título no Supabase", error);
      showToast("Erro ao excluir do banco: " + (error.message || "permissão negada"));
      return false;
    }
  }
  async function refreshAdminState() {
    if (!supabaseClient) return;
    try {
      const {data:{session}} = await supabaseClient.auth.getSession();
      adminSession = session;
      const isAdmin = !!session && session.user?.id === ADMIN_UID;
      $("#adminLoginBox")?.classList.toggle("hidden", isAdmin);
      $("#adminLoggedBox")?.classList.toggle("hidden", !isAdmin);
      $("#titleForm")?.classList.toggle("hidden", !isAdmin);
      $("#adminAddTitle")?.classList.toggle("hidden", !isAdmin);
      $("#bulkImportPanel")?.classList.toggle("hidden", !isAdmin);
      $("#resetCatalog")?.classList.toggle("hidden", !isAdmin);
      $("#adminIdentity").textContent = isAdmin ? `Conectado como ${session.user.email}. Alterações serão salvas no banco compartilhado.` : "";
      if (session && !isAdmin) { await supabaseClient.auth.signOut(); adminSession = null; setBackendStatus("Conta autenticada, mas sem permissão de administrador.", true); }
      else if (isAdmin) setBackendStatus("Administrador autenticado. Você pode gerenciar o catálogo online.");
      renderAdminList();
      if (isAdmin) { await loadModerationReports(); await loadAdminAuditLog(); }
      else { const reports = $("#moderationReports"); if (reports) reports.replaceChildren(); const audit = $("#adminAuditLog"); if (audit) audit.replaceChildren(); }
    } catch (error) { console.warn(error); }
  }
  async function loginAdmin() {
    const email = $("#adminEmail").value.trim(), password = $("#adminPassword").value;
    if (!email || !password) { showToast("Informe e-mail e senha."); return; }
    if (!supabaseClient) { showToast("Serviço administrativo carregando. Aguarde alguns segundos e tente novamente."); return; }
    const button = $("#adminLogin"); button.disabled = true; setButton(button, null, "Entrando…");
    const {data, error} = await supabaseClient.auth.signInWithPassword({email, password});
    button.disabled = false; setButton(button, null, "Entrar como administrador");
    if (error) { showToast("Falha no login: " + error.message); return; }
    if (data.user?.id !== ADMIN_UID) { await supabaseClient.auth.signOut(); showToast("Esta conta não tem permissão de administrador."); return; }
    adminSession = data.session; $("#adminPassword").value = "";
    await logAdminAction("admin_login", "admin", data.user.id, {email:data.user.email || ""});
    await refreshAdminState(); await loadSharedCatalog(); await loadTvChannelsFromCloud(); renderCatalog(); await loadAdminAuditLog(); showToast("Login administrativo concluído.");
  }
  function saveCatalog() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog)); return true; }
    catch (_) { showToast("Não foi possível salvar. O armazenamento do navegador pode estar cheio."); return false; }
  }
  function saveFavorites() { try { localStorage.setItem(profileStorageKey(FAVORITES_KEY), JSON.stringify(favorites)); } catch (_) { showToast("O armazenamento do navegador está cheio; não foi possível salvar a lista."); } scheduleUserSync(); }
  function saveProgress() { try { localStorage.setItem(profileStorageKey(PROGRESS_KEY), JSON.stringify(progress)); } catch (_) { /* A reprodução continua mesmo se o armazenamento estiver indisponível. */ } scheduleUserSync(); }
  function saveWatchHistory() { try { localStorage.setItem(profileStorageKey(WATCH_HISTORY_KEY), JSON.stringify(watchHistory.slice(0,100))); } catch (_) {} scheduleUserSync(); }
  function setAccountStatus(message, error=false) { const el=$("#accountStatus"); if(el){el.textContent=message;el.classList.toggle("backend-error",!!error);} }
  function scheduleUserSync() { if(activeProfileId!=="main" || !userSession || !userSupabaseClient) return; clearTimeout(userSyncTimer); userSyncTimer=setTimeout(()=>syncUserState(false),900); }
  async function syncUserState(showMessage=true) {
    if(activeProfileId!=="main") { if(showMessage) setAccountStatus("A sincronização da conta está disponível somente no perfil Principal."); return false; }
    if(!userSupabaseClient || !userSession?.user?.id) { if(showMessage) setAccountStatus("Entre na sua conta para sincronizar seus dados."); return false; }
    const syncUserId = userSession.user.id;
    const state=normalizeRemoteState({favorites,progress,watchHistory:watchHistory.slice(0,100)});
    try {
      const {error}=await userSupabaseClient.from("user_library_state").upsert({user_id:syncUserId,state,updated_at:new Date().toISOString()},{onConflict:"user_id"});
      if(error) throw error;
      if (userSession?.user?.id !== syncUserId) return false;
      localStorage.setItem(USER_ACCOUNT_KEY,syncUserId);
      setAccountStatus("Sincronização concluída. Favoritos, histórico e progresso estão atualizados.");
      if(showMessage) showToast("Dados pessoais sincronizados.");
      return true;
    } catch(error) {
      console.warn("Falha na sincronização pessoal",error);
      setAccountStatus("Não foi possível sincronizar. Confira se executou database/supabase-user-sync.sql e se as políticas RLS estão ativas.",true);
      return false;
    }
  }
  function normalizeRemoteState(value) {
    const state = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      favorites: Array.isArray(state.favorites) ? [...new Set(state.favorites.map(String))].slice(0,2000) : [],
      progress: state.progress && typeof state.progress === "object" && !Array.isArray(state.progress)
        ? Object.fromEntries(Object.entries(state.progress).sort((a,b)=>Number(b[1]?.updated||0)-Number(a[1]?.updated||0)).slice(0,1000)) : {},
      watchHistory: Array.isArray(state.watchHistory) ? state.watchHistory.filter(entry => entry && typeof entry.key === "string").sort((a,b)=>Number(b.watchedAt||0)-Number(a.watchedAt||0)).slice(0,100) : []
    };
  }
  function applyUserState(state) {
    favorites = state.favorites;
    progress = state.progress;
    watchHistory = state.watchHistory;
    try {
      localStorage.setItem(profileStorageKey(FAVORITES_KEY), JSON.stringify(favorites));
      localStorage.setItem(profileStorageKey(PROGRESS_KEY), JSON.stringify(progress));
      localStorage.setItem(profileStorageKey(WATCH_HISTORY_KEY), JSON.stringify(watchHistory));
    } catch (_) { setAccountStatus("Dados carregados, mas o armazenamento local está cheio.", true); }
    renderCatalog(); renderWatchHistory(); renderContinue();
  }
  function mergeInitialUserState(remoteState) {
    const remote = normalizeRemoteState(remoteState);
    const local = normalizeRemoteState({favorites,progress,watchHistory});
    const mergedProgress = {...remote.progress};
    Object.entries(local.progress).forEach(([key,value]) => {
      const remoteValue = mergedProgress[key];
      if (!remoteValue || Number(value?.updated||0) > Number(remoteValue?.updated||0)) mergedProgress[key] = value;
    });
    const historyMap = new Map();
    [...remote.watchHistory,...local.watchHistory].forEach(entry => {
      const prior = historyMap.get(entry.key);
      if (!prior || Number(entry.watchedAt||0) > Number(prior.watchedAt||0)) historyMap.set(entry.key, entry);
    });
    return {
      favorites: [...new Set([...remote.favorites,...local.favorites])].slice(0,2000),
      progress: mergedProgress,
      watchHistory: [...historyMap.values()].sort((a,b)=>Number(b.watchedAt||0)-Number(a.watchedAt||0)).slice(0,100)
    };
  }
  async function loadUserState() {
    if(activeProfileId!=="main") { setAccountStatus("A sincronização da conta está disponível somente no perfil Principal."); return; }
    if(!userSupabaseClient || !userSession?.user?.id) return;
    const userId = userSession.user.id;
    clearTimeout(userSyncTimer);
    try {
      const {data,error}=await userSupabaseClient.from("user_library_state").select("state").eq("user_id",userId).maybeSingle();
      if(error) throw error;
      // Never merge one account's browser data into another account. Only migrate anonymous local data on first use.
      const previousAccountId = localStorage.getItem(USER_ACCOUNT_KEY);
      let state;
      if (data?.state && typeof data.state === "object") {
        state = previousAccountId === userId ? normalizeRemoteState(data.state) :
          previousAccountId ? normalizeRemoteState(data.state) : mergeInitialUserState(data.state);
        applyUserState(state);
        if (previousAccountId !== userId && !previousAccountId) {
          const migrated = await syncUserState(false);
          if (!migrated) return;
        }
      } else {
        // If switching from another signed-in account, start clean rather than uploading their local data.
        state = previousAccountId && previousAccountId !== userId
          ? {favorites:[],progress:{},watchHistory:[]}
          : normalizeRemoteState({favorites,progress,watchHistory});
        applyUserState(state);
        const {error:saveError}=await userSupabaseClient.from("user_library_state").upsert({user_id:userId,state,updated_at:new Date().toISOString()},{onConflict:"user_id"});
        if(saveError) throw saveError;
      }
      localStorage.setItem(USER_ACCOUNT_KEY,userId);
      setAccountStatus("Conta conectada. Favoritos, histórico e progresso sincronizados neste dispositivo.");
    } catch(error) {
      console.warn("Falha ao carregar dados da conta",error);
      setAccountStatus("Conta conectada, mas a sincronização falhou. Confira a migração SQL, as políticas RLS e sua conexão.",true);
    }
  }
  async function refreshAccountState() {
    if(!userSupabaseClient) {setAccountStatus("O serviço de contas não está disponível agora.",true);return;}
    const {data,error}=await userSupabaseClient.auth.getSession();
    if(error) {setAccountStatus("Não foi possível consultar a sessão da conta.",true);return;}
    userSession=data.session;
    const logged=!!userSession;
    $("#accountForm")?.classList.toggle("hidden",logged);
    $("#accountLoggedBox")?.classList.toggle("hidden",!logged);
    if(logged) {$("#accountIdentity").textContent=`Conectado como ${userSession.user.email||"usuário"}.`;await loadUserState();}
    else setAccountStatus("Entre ou crie uma conta para sincronizar favoritos e histórico.");
  }
  async function accountLogin(event) {
    event?.preventDefault();
    if (!userSupabaseClient) { setAccountStatus("O serviço de contas ainda está carregando. Tente novamente em instantes.", true); return; }
    const email=$("#accountEmail").value.trim(),password=$("#accountPassword").value;
    if(!email||password.length<8){setAccountStatus("Informe um e-mail válido e uma senha com pelo menos 8 caracteres.",true);return;}
    const button=$("#accountLogin");button.disabled=true;button.textContent="Entrando…";
    try {
      const {data,error}=await userSupabaseClient.auth.signInWithPassword({email,password});
      if(error) throw error;
      userSession=data.session;$("#accountPassword").value="";await refreshAccountState();showToast("Você entrou na sua conta LumiPlay.");
    } catch(error) {setAccountStatus(error.message||"Não foi possível entrar.",true);}
    finally {button.disabled=false;button.textContent="Entrar";}
  }
  async function accountSignup() {
    if (!userSupabaseClient) { setAccountStatus("O serviço de contas ainda está carregando. Tente novamente em instantes.", true); return; }
    const email=$("#accountEmail").value.trim(),password=$("#accountPassword").value;
    if(!email||password.length<8){setAccountStatus("Informe um e-mail válido e uma senha com pelo menos 8 caracteres.",true);return;}
    const button=$("#accountSignup");button.disabled=true;button.textContent="Criando…";
    try {
      const {data,error}=await userSupabaseClient.auth.signUp({email,password});
      if(error) throw error;
      if(data.session) {userSession=data.session;await refreshAccountState();setAccountStatus("Conta criada e conectada. Sincronização ativada.");}
      else setAccountStatus("Cadastro iniciado. Confira seu e-mail para confirmar a conta e depois entre no LumiPlay.");
    } catch(error) {setAccountStatus(error.message||"Não foi possível criar a conta.",true);}
    finally {button.disabled=false;button.textContent="Criar conta";}
  }
  function readProfileJSON(base, fallback) { return safeParse(localStorage.getItem(profileStorageKey(base)) || "", fallback); }
  function writeProfileJSON(base, value) { try { localStorage.setItem(profileStorageKey(base), JSON.stringify(value)); return true; } catch (_) { showToast("Não foi possível salvar no armazenamento deste navegador."); return false; } }
  function getPreferences() { return { genres: [], prioritizeRatings: false }; }
  function recordWatch(item, episode=null, seasonIndex=null, episodeIndex=null) {
    if (!item) return;
    const season = episode ? Number(episode.seasonNumber ?? (Number(seasonIndex||0)+1)) : null;
    const ep = episode ? Number(episode.episodeNumber ?? (Number(episodeIndex||0)+1)) : null;
    const key = episode ? `${item.id}:s${season}:e${ep}` : String(item.id);
    watchHistory = [{key,id:String(item.id),title:item.title,type:item.type,poster:item.poster||item.capa_url||"",episode:episode?.title||"",season,episodeNumber:ep,watchedAt:Date.now()}, ...watchHistory.filter(entry=>entry.key!==key)].slice(0,100);
    saveWatchHistory();
    renderWatchHistory();
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }
  function safeURL(value) {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; }
    catch (_) { return ""; }
  }
  function safeVttURL(value) {
    const url = safeURL(String(value || "").trim());
    if (!url) return "";
    try { return new URL(url).pathname.toLowerCase().endsWith(".vtt") ? url : ""; }
    catch (_) { return ""; }
  }
  function formatPlayerTime(value) {
    if (!Number.isFinite(value) || value < 0) return "00:00";
    const total = Math.floor(value), hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
    return hours ? `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}` : `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
  }
  const ICON = (name, extra = "") => `<svg class="icon${extra ? " " + extra : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  // Troca o ícone e/ou o texto de um botão no formato <svg><use/></svg><span>texto</span>.
  function setButton(button, iconName, label) {
    if (!button) return;
    if (iconName) button.querySelector("use")?.setAttribute("href", `#i-${iconName}`);
    if (label != null) { const span = button.querySelector("span"); if (span) span.textContent = label; else button.textContent = label; }
  }
  // Troca o endereço de um iframe SEM criar entradas no histórico: atribuir iframe.src cria uma entrada,
  // e o botão Voltar do celular/TV passava a andar "dentro" do player em vez de fechar a janela.
  function setFrame(frame, url) {
    if (!frame) return;
    frame.dataset.src = url;
    try { if (frame.contentWindow) { frame.contentWindow.location.replace(url); return; } } catch (_) { /* cai para o atributo src */ }
    frame.setAttribute("src", url);
  }
  function safePoster(value) { return safeURL(String(value || "").trim()); }
  // O TMDB serve a mesma imagem em vários tamanhos: pedimos o menor que ainda fica nítido.
  function tmdbSize(url, size) {
    return typeof url === "string" ? url.replace(/(image\.tmdb\.org\/t\/p\/)(?:w\d+|original)(\/)/, `$1${size}$2`) : url;
  }
  const isTmdbImage = url => /^https:\/\/image\.tmdb\.org\/t\/p\//.test(url || "");
  const splitGenres = value => String(value || "").split(/[,/|•]/).map(part => part.trim()).filter(Boolean);
  const formatScore = value => Number(value).toFixed(1).replace(".", ",");
  function showToast(message) {
    const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }
  function findItem(id) { return catalog.find(item => item.id === id); }
  function isFavorite(id) { return favorites.includes(id); }
  function glowColor(item) { return /^#[0-9a-f]{6}$/i.test(item?.color || "") ? item.color : "#4a3fb0"; }
  function skeletonMarkup(count) {
    return Array.from({length:count}, () => '<div class="card skeleton" aria-hidden="true"><div class="poster"></div><div class="card-info"><span></span><span></span></div></div>').join("");
  }
  function posterMarkup(item, options = {}) {
    const title = escapeHTML(item.title), poster = safePoster(item.poster);
    const rating = communityRatings[String(item.id)];
    const badge = rating?.count ? `<span class="badge">${ICON("star")}${formatScore(rating.average)}<small>(${rating.count})</small></span>` : "";
    const progressBar = Number.isFinite(options.progress) ? `<span class="poster-progress"><span style="width:${Math.max(3, Math.min(100, options.progress)).toFixed(1)}%"></span></span>` : "";
    let image = "";
    if (poster) {
      const src = tmdbSize(poster, "w342");
      const srcset = isTmdbImage(poster) && !LOW_POWER_DEVICE ? ` srcset="${escapeHTML(tmdbSize(poster, "w185"))} 185w, ${escapeHTML(src)} 342w, ${escapeHTML(tmdbSize(poster, "w500"))} 500w" sizes="(max-width: 479px) 34vw, (max-width: 1023px) 150px, 200px"` : "";
      image = `<img src="${escapeHTML(src)}"${srcset} alt="" loading="lazy" decoding="async">`;
    }
    return `<span class="poster-frame"><span class="poster${poster ? "" : " no-img"}" style="--poster-glow:${glowColor(item)}">${image}<span class="poster-fallback">${title}</span>${badge}${progressBar}</span></span>`;
  }
  // Um cartão = botão principal (abre os detalhes) + botão de coração (lista), sem botões aninhados.
  function cardMarkup(item, options = {}) {
    const id = escapeHTML(item.id), title = escapeHTML(item.title), fav = isFavorite(item.id);
    const sub = Array.isArray(options.sub) ? options.sub : [item.year, item.type === "Série" ? "Série" : "Filme"];
    return `<article class="card" role="listitem" data-id="${id}"><button class="card-main" type="button" data-open="${id}" aria-label="Ver detalhes de ${title}">${posterMarkup(item, options)}<span class="card-info"><span class="card-title">${title}</span><span class="card-sub">${sub.filter(Boolean).map(part => `<span>${escapeHTML(part)}</span>`).join("")}</span></span></button><button class="card-fav" type="button" data-fav="${id}" aria-pressed="${fav}" aria-label="${fav ? "Remover de" : "Adicionar a"} minha lista: ${title}">${ICON(fav ? "heart-fill" : "heart")}</button></article>`;
  }
  function relatedCardMarkup(item) {
    const poster = safePoster(item.poster);
    return `<button type="button" class="related-card" data-related-id="${escapeHTML(item.id)}"><span class="poster-frame"><span class="poster${poster ? "" : " no-img"}" style="--poster-glow:${glowColor(item)}">${poster ? `<img src="${escapeHTML(tmdbSize(poster, "w185"))}" alt="" loading="lazy" decoding="async">` : ""}<span class="poster-fallback">${escapeHTML(item.title)}</span></span></span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.year || (item.type === "Série" ? "Série" : "Filme"))}</small></button>`;
  }
  // Metadados como itens separados (nota, ano, tipo e gêneros), sem texto emendado por símbolos.
  function metaMarkup(item, genres = 2, extra = []) {
    const rating = communityRatings[String(item.id)];
    const parts = [];
    if (rating?.count) parts.push(`<li class="meta-rating">${ICON("star")}${formatScore(rating.average)}</li>`);
    if (item.year) parts.push(`<li>${escapeHTML(item.year)}</li>`);
    parts.push(`<li class="meta-pill">${item.type === "Série" ? "Série" : "Filme"}</li>`);
    splitGenres(item.genre).filter(genre => genre !== "Série" && genre !== "Filme").slice(0, genres).forEach(genre => parts.push(`<li class="meta-pill">${escapeHTML(genre)}</li>`));
    extra.filter(Boolean).forEach(text => parts.push(`<li>${escapeHTML(text)}</li>`));
    return parts.join("");
  }
  function setDetailsMeta(item, extra = []) { const meta = $("#detailsMeta"); if (meta) meta.innerHTML = metaMarkup(item, 3, extra); }
  function saveRecentSearch(term) {
    const value = String(term || "").trim().replace(/\s+/g, " ").slice(0,80);
    if (value.length < 2) return;
    recentSearches = [value, ...recentSearches.filter(entry => entry.toLocaleLowerCase("pt-BR") !== value.toLocaleLowerCase("pt-BR"))].slice(0,8);
    try { localStorage.setItem(profileStorageKey(RECENT_SEARCHES_KEY), JSON.stringify(recentSearches)); } catch (_) {}
    renderRecentSearches();
  }
  function renderRecentSearches() {
    const section = $("#recentSearches"), chips = $("#recentSearchChips");
    if (!section || !chips) return;
    section.classList.toggle("hidden", recentSearches.length === 0);
    chips.innerHTML = recentSearches.map(term => `<button class="chip recent-search-chip" type="button" data-recent-search="${escapeHTML(term)}">${ICON("clock")}<span>${escapeHTML(term)}</span></button>`).join("");
  }
  function normalizeSearch(value) {
    return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  }
  // Cache de busca por objeto: evita normalizar sinopses longas repetidamente a cada tecla.
  const searchIndexCache = new WeakMap();
  function getSearchIndex(item) {
    const source = [item.title,item.genre,item.year,item.description,item.cast,item.director,item.originalTitle].map(value=>String(value||"")).join("\u0001");
    const cached = searchIndexCache.get(item);
    if (cached && cached.source === source) return cached;
    const index = {
      source,
      title: normalizeSearch(item.title),
      genre: normalizeSearch(item.genre),
      genreParts: String(item.genre||"").split(/[,/|•]/).map(value=>normalizeSearch(value)),
      haystack: normalizeSearch(source.replace(/\u0001/g," "))
    };
    searchIndexCache.set(item,index);
    return index;
  }
  const SEARCH_SYNONYMS = {
    "desenho":"animacao", "desenhos":"animacao", "cartoon":"animacao", "anime":"animacao",
    "sci fi":"ficcao cientifica", "scifi":"ficcao cientifica", "ficcao":"ficcao cientifica",
    "engracado":"comedia", "engracada":"comedia", "rir":"comedia", "medo":"terror",
    "policial":"crime", "investigacao":"misterio", "investigacao policial":"crime",
    "romantico":"romance", "romantica":"romance", "espaco":"ficcao cientifica"
  };
  function levenshteinDistance(a,b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previous = Array.from({length:b.length+1},(_,i)=>i);
    for (let i=1;i<=a.length;i++) {
      const current=[i];
      for(let j=1;j<=b.length;j++) current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
      previous=current;
    }
    return previous[b.length];
  }
  function searchTermMatches(term, haystack) {
    if (!term) return true;
    const expanded = SEARCH_SYNONYMS[term] || term;
    if (haystack.includes(term) || haystack.includes(expanded)) return true;
    const queryWords = expanded.split(" ").filter(Boolean);
    const haystackWords = haystack.split(" ").filter(Boolean);
    return queryWords.every(word => haystackWords.some(candidate => candidate.includes(word) || (word.length >= 5 && Math.abs(candidate.length-word.length)<=1 && levenshteinDistance(word,candidate)<=1)));
  }
  function closeSuggestions() {
    const box = $("#searchSuggestions");
    if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
    $("#searchInput")?.setAttribute("aria-expanded", "false");
  }
  function renderSearchSuggestions() {
    const box = $("#searchSuggestions"), input = $("#searchInput");
    if (!box || !input) return;
    const term = normalizeSearch(input.value);
    let html = "";
    if (term.length >= 2 && !IS_TV) {
      const seen = new Set();
      html = catalog.filter(item => getSearchIndex(item).title.includes(term))
        .sort((a, b) => Number(getSearchIndex(b).title.startsWith(term)) - Number(getSearchIndex(a).title.startsWith(term)) || a.title.localeCompare(b.title, "pt-BR"))
        .filter(item => { const key = getSearchIndex(item).title; if (seen.has(key)) return false; seen.add(key); return true; })
        .slice(0, LOW_POWER_DEVICE ? 4 : 6)
        .map(item => {
          const poster = safePoster(item.poster);
          return `<button class="suggestion" type="button" role="option" data-suggest="${escapeHTML(item.id)}"><span class="suggestion-thumb">${poster ? `<img src="${escapeHTML(tmdbSize(poster, "w92"))}" alt="" loading="lazy" decoding="async">` : ""}</span><span><strong>${escapeHTML(item.title)}</strong><small>${item.type === "Série" ? "Série" : "Filme"}${item.year ? `, ${escapeHTML(item.year)}` : ""}</small></span></button>`;
        }).join("");
    }
    box.innerHTML = html;
    box.classList.toggle("hidden", !html);
    input.setAttribute("aria-expanded", String(Boolean(html)));
  }
  function filteredCatalog() {
    const term = normalizeSearch($("#searchInput").value);
    const genre = $("#genreFilter")?.value || "Tudo";
    const sort = $("#sortFilter")?.value || "featured";
    const items = catalog.filter(item => {
      const matchesType = activeFilter === "Tudo" || item.type === activeFilter;
      if (!matchesType) return false;
      const searchIndex = getSearchIndex(item);
      const normalizedGenre = normalizeSearch(genre);
      const matchesGenre = genre === "Tudo" || searchIndex.genreParts.some(value => value === normalizedGenre || value.includes(normalizedGenre) || normalizeSearch(SEARCH_SYNONYMS[normalizedGenre] || normalizedGenre) === value);
      if (!matchesGenre || (favoritesOnly && !isFavorite(item.id))) return false;
      return searchTermMatches(term, searchIndex.haystack);
    });
    const ratingOf = item => Number(communityRatings[String(item.id)]?.average || 0);
    if (term && sort === "featured") {
      // Com busca ativa, títulos que começam ou contêm o termo vêm antes de acertos na sinopse.
      const rank = item => { const t = getSearchIndex(item).title; return t === term ? 0 : t.startsWith(term) ? 1 : t.includes(term) ? 2 : 3; };
      items.sort((a, b) => rank(a) - rank(b));
    } else if (sort === "newest") items.sort((a,b) => Number(b.year || 0) - Number(a.year || 0) || a.title.localeCompare(b.title,"pt-BR"));
    else if (sort === "oldest") items.sort((a,b) => Number(a.year || 9999) - Number(b.year || 9999) || a.title.localeCompare(b.title,"pt-BR"));
    else if (sort === "title") items.sort((a,b) => a.title.localeCompare(b.title,"pt-BR",{sensitivity:"base"}));
    else if (sort === "rating") items.sort((a,b) => ratingOf(b)-ratingOf(a) || a.title.localeCompare(b.title,"pt-BR"));
    return items;
  }
  const HERO_INTERVAL = 9000;
  const HERO_DEFAULT_TITLE = 'Histórias que <span>ficam com você.</span>';
  const HERO_DEFAULT_COPY = "Grandes histórias, universos inesquecíveis e suas próximas maratonas, tudo em um só lugar.";
  // Prefere títulos com imagem larga (backdrop), mas nunca deixa o destaque vazio.
  function heroCandidates() {
    const usable = catalog.filter(item => item && (safePoster(item.backdrop) || safePoster(item.poster)) && (item.description || item.year || item.genre));
    const wide = usable.filter(item => safePoster(item.backdrop));
    const rest = usable.filter(item => !safePoster(item.backdrop));
    return [...wide, ...rest].slice(0, LOW_POWER_DEVICE ? 5 : 6);
  }
  function setHeroImage(item) {
    const img = $("#heroImage"), mobile = $("#heroSourceMobile"), hero = $("#hero");
    if (!img || !hero) return;
    const wide = safePoster(item.backdrop), tall = safePoster(item.poster);
    hero.classList.toggle("is-poster", !wide && Boolean(tall));
    const src = wide ? tmdbSize(wide, LOW_POWER_DEVICE ? "w780" : "w1280") : tmdbSize(tall, "w780");
    // No celular a capa vertical enche melhor a tela do que a imagem larga.
    if (mobile) { if (tall) mobile.setAttribute("srcset", tmdbSize(tall, "w780")); else mobile.removeAttribute("srcset"); }
    img.classList.remove("is-empty");
    if (img.getAttribute("src") !== src) { img.classList.remove("is-loaded"); img.setAttribute("src", src); }
    else if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
  }
  function updateFeaturedHero() {
    const hero = $("#hero"), heading = $("#heroTitle"), copy = $("#heroCopy"), meta = $("#heroMeta");
    if (!hero || !heading || !copy || !meta) return;
    featuredItems = heroCandidates();
    featuredIndex = Math.max(0, Math.min(featuredIndex, featuredItems.length - 1));
    featuredItem = featuredItems[featuredIndex] || null;
    const controls = $("#heroFeatureControls"), dots = $("#heroFeatureDots"), count = $("#heroFeatureCount");
    const play = $("#heroPlay"), details = $("#heroDetails"), fav = $("#heroFavorite"), info = $("#heroInfo");
    if (!featuredItem) {
      heroRenderedId = "";
      hero.classList.add("is-empty"); hero.classList.remove("is-poster");
      heading.innerHTML = HERO_DEFAULT_TITLE; copy.textContent = HERO_DEFAULT_COPY;
      meta.classList.add("hidden"); meta.innerHTML = "";
      setButton(play, "search", "Explorar catálogo");
      details.classList.add("hidden"); fav.classList.add("hidden"); info.classList.remove("hidden");
      controls.classList.add("hidden"); dots.replaceChildren(); count.textContent = "";
      $("#heroProgress")?.classList.remove("running");
      const img = $("#heroImage"); if (img) { img.removeAttribute("src"); img.classList.add("is-empty"); img.classList.remove("is-loaded"); }
      $("#heroSourceMobile")?.removeAttribute("srcset");
      return;
    }
    const changed = heroRenderedId !== String(featuredItem.id);
    heroRenderedId = String(featuredItem.id);
    hero.classList.remove("is-empty");
    setHeroImage(featuredItem);
    heading.textContent = featuredItem.title;
    copy.textContent = featuredItem.description || "Descubra este título no catálogo LumiPlay.";
    meta.innerHTML = metaMarkup(featuredItem, 2); meta.classList.remove("hidden");
    setButton(play, "play", "Assistir");
    details.classList.remove("hidden"); fav.classList.remove("hidden"); info.classList.add("hidden");
    syncFavoriteButtons(featuredItem.id);
    controls.classList.toggle("hidden", featuredItems.length < 2);
    dots.innerHTML = featuredItems.map((item, index) => {
      const thumb = tmdbSize(safePoster(item.poster) || safePoster(item.backdrop), "w185");
      const active = index === featuredIndex;
      return `<button class="hero-thumb${active ? " active" : ""}" type="button" data-hero-index="${index}" aria-label="Destaque ${index + 1}: ${escapeHTML(item.title)}" aria-pressed="${active}">${thumb ? `<img src="${escapeHTML(thumb)}" alt="" decoding="async">` : ""}</button>`;
    }).join("");
    count.textContent = `Destaque ${featuredIndex + 1} de ${featuredItems.length}`;
    if (changed && !REDUCED_MOTION) { const content = $("#heroContent"); if (content) { content.style.animation = "none"; void content.offsetWidth; content.style.animation = ""; } }
    enrichFeaturedBackdrops();
  }
  function setFeaturedIndex(index) {
    if (featuredItems.length < 2) return;
    featuredIndex = (index + featuredItems.length) % featuredItems.length;
    updateFeaturedHero();
    restartFeaturedRotation();
  }
  function restartFeaturedRotation() {
    if (featuredRotationTimer) clearTimeout(featuredRotationTimer);
    featuredRotationTimer = null;
    const bar = $("#heroProgress");
    if (bar) bar.classList.remove("running");
    if (LOW_POWER_DEVICE || REDUCED_MOTION || heroPaused || featuredItems.length < 2 || document.hidden || !isHomeView()) return;
    if (bar) { void bar.offsetWidth; bar.style.setProperty("--hero-ms", HERO_INTERVAL + "ms"); bar.classList.add("running"); }
    featuredRotationTimer = setTimeout(() => setFeaturedIndex(featuredIndex + 1), HERO_INTERVAL);
  }
  // Itens vindos só do banco têm capa, mas não imagem larga: buscamos no TMDB (com cache) para o destaque ficar cinematográfico.
  async function fetchBackdropPath(item) {
    const identity = tmdbIdentity(item);
    if (!identity) return "";
    const key = `backdrop:${identity}`;
    const cached = cacheGet(key);
    if (cached !== null) return cached;
    const [mediaType, id] = identity.split(":");
    const data = await tmdbRequest(`${mediaType}/${encodeURIComponent(id)}`);
    const path = data.backdrop_path || "";
    cacheSet(key, path);
    return path;
  }
  async function enrichFeaturedBackdrops() {
    if (backdropEnriching || backdropFailures >= 2 || !tmdbCredential) return;
    const queue = featuredItems.filter(item => !safePoster(item.backdrop) && tmdbIdentity(item)).slice(0, 4);
    if (!queue.length) return;
    backdropEnriching = true;
    try {
      for (const item of queue) {
        const path = await fetchBackdropPath(item);
        if (!path) continue;
        item.backdrop = "https://image.tmdb.org/t/p/w1280" + path;
        const live = findItem(item.id); if (live && live !== item) live.backdrop = item.backdrop;
        scheduleSaveCatalog();
        if (featuredItem && featuredItem.id === item.id) setHeroImage(item);
        if (selectedItemId === item.id) setDetailsArt(item);
      }
    } catch (error) { backdropFailures++; console.warn("Não foi possível carregar imagens de destaque", error); }
    finally { backdropEnriching = false; }
  }
  function syncFavoriteButtons(id) {
    const fav = isFavorite(id), sid = String(id);
    document.querySelectorAll(".card-fav").forEach(button => {
      if (button.dataset.fav !== sid) return;
      button.setAttribute("aria-pressed", String(fav));
      button.querySelector("use")?.setAttribute("href", fav ? "#i-heart-fill" : "#i-heart");
      button.setAttribute("aria-label", `${fav ? "Remover de" : "Adicionar a"} minha lista: ${findItem(id)?.title || ""}`);
    });
    if (featuredItem && String(featuredItem.id) === sid) {
      const button = $("#heroFavorite");
      if (button) {
        button.setAttribute("aria-pressed", String(fav));
        button.setAttribute("aria-label", fav ? "Remover da minha lista" : "Adicionar à minha lista");
        button.querySelector("use")?.setAttribute("href", fav ? "#i-check" : "#i-plus");
      }
    }
    if (selectedItemId && String(selectedItemId) === sid) {
      const button = $("#detailsFavorite");
      if (button) { button.setAttribute("aria-pressed", String(fav)); setButton(button, fav ? "check" : "plus", fav ? "Na minha lista" : "Minha lista"); }
    }
  }
  async function loadCommunityRatings() {
    if (!supabaseClient) return;
    try {
      const {data,error} = await supabaseClient.from("catalogo_feedback").select("app_id,avaliacao").not("avaliacao","is",null).limit(5000);
      if (error) throw error;
      const sums = {};
      (data || []).forEach(row => {
        const rating = Number(row.avaliacao);
        if (!row.app_id || rating < 1 || rating > 5) return;
        const key = String(row.app_id);
        if (!sums[key]) sums[key] = {sum:0,count:0};
        sums[key].sum += rating; sums[key].count++;
      });
      communityRatings = Object.fromEntries(Object.entries(sums).map(([key,value]) => [key,{average:value.sum/value.count,count:value.count}]));
      try { localStorage.setItem(COMMUNITY_RATINGS_KEY, JSON.stringify(communityRatings)); } catch (_) {}
      renderCatalog();
    } catch (error) { console.warn("Não foi possível carregar as avaliações da comunidade", error); }
  }
  function renderRecommendations() {
    const section=$("#recommendationsSection"),grid=$("#recommendationsGrid");
    if(!section||!grid) return;
    // Não calcula recomendações durante buscas/filtros ou em outras telas: é um dos cálculos mais caros.
    if (!isHomeView()) {
      section.classList.add("hidden");
      return;
    }
    const saved = new Set(favorites.map(String));
    const watched = new Set(watchHistory.map(entry => String(entry.id)));
    const savedItems = catalog.filter(item => saved.has(String(item.id)));
    const recentItems = catalog.filter(item => watched.has(String(item.id)));
    const genreWeights = new Map();
    const preferences=getPreferences();
    const addGenres = (items, weight) => items.forEach(item => String(item.genre||"").split(/[,/|•]/).map(g=>g.trim()).filter(Boolean).forEach(genre => {
      const key = genre.toLocaleLowerCase("pt-BR");
      const prior = genreWeights.get(key) || {label:genre,score:0};
      prior.score += weight; genreWeights.set(key, prior);
    }));
    addGenres(savedItems, 3);
    addGenres(recentItems, 1);
    preferences.genres.forEach(genre=>{ const key=genre.toLocaleLowerCase("pt-BR"); const prior=genreWeights.get(key)||{label:genre,score:0}; prior.score+=5; genreWeights.set(key,prior); });
    const preferred = [...genreWeights.values()].sort((a,b)=>b.score-a.score).slice(0,8);
    let suggestions = catalog.filter(item => !saved.has(String(item.id)) && !watched.has(String(item.id)));
    const ratingOf = item => Number(communityRatings[String(item.id)]?.average || 0);
    if(preferred.length) suggestions.sort((a,b) => {
      const score = item => {
        const genres = String(item.genre||"").split(/[,/|•]/).map(g=>g.trim().toLocaleLowerCase("pt-BR"));
        const match = preferred.reduce((sum,genre,index)=>sum+(genres.some(g=>g===genre.label.toLocaleLowerCase("pt-BR")||g.includes(genre.label.toLocaleLowerCase("pt-BR"))) ? genre.score*(preferred.length-index) : 0),0);
        return match + ratingOf(item)*(preferences.prioritizeRatings?1.25:0.25);
      };
      return score(b)-score(a) || a.title.localeCompare(b.title,"pt-BR");
    });
    else suggestions.sort((a,b)=>(preferences.prioritizeRatings?ratingOf(b)-ratingOf(a):0) || Number(b.year||0)-Number(a.year||0));
    suggestions = suggestions.slice(0, LOW_POWER_DEVICE ? 10 : 14);
    section.classList.toggle("hidden", suggestions.length < 3);
    grid.innerHTML = suggestions.map(item => cardMarkup(item)).join("");
    const note=$("#recommendationsNote");
    if(note) note.textContent = preferred.length ? `Com base nos seus gêneros preferidos: ${preferred.slice(0,3).map(g=>g.label).join(", ")}. O que você já salvou ou assistiu fica de fora.` : "Sugestões baseadas nas avaliações da comunidade. Salve ou assista a algo para personalizar.";
  }
  function renderTrending() {
    const section = $("#trendingSection"), grid = $("#trendingGrid"); if (!section || !grid) return;
    if (!isHomeView()) { section.classList.add("hidden"); return; }
    const ratingOf = item => Number(communityRatings[String(item.id)]?.average || 0);
    const countOf = item => Number(communityRatings[String(item.id)]?.count || 0);
    // Em empate (a maioria) vale a ordem do catálogo: no TMDB, a popularidade da semana.
    const items = [...catalog].sort((a, b) => ratingOf(b) - ratingOf(a) || countOf(b) - countOf(a)).slice(0, LOW_POWER_DEVICE ? 10 : 14);
    grid.innerHTML = items.map(item => cardMarkup(item)).join("");
    section.classList.toggle("hidden", items.length < 4);
  }
  function rowSectionMarkup(id, title, items, genreLabel) {
    const jump = genreLabel ? `<button class="text-button" type="button" data-genre-jump="${escapeHTML(genreLabel)}">Ver todos</button>` : "";
    return `<section class="row-section" aria-labelledby="${id}Title"><div class="row-head"><h2 id="${id}Title">${escapeHTML(title)}</h2><div class="row-tools">${jump}<div class="row-nav"><button class="row-arrow" type="button" data-row="prev" aria-label="Rolar para a esquerda">${ICON("left")}</button><button class="row-arrow" type="button" data-row="next" aria-label="Rolar para a direita">${ICON("right")}</button></div></div></div><div class="row-track" role="list">${items.map(item => cardMarkup(item)).join("")}</div></section>`;
  }
  // Fileiras por gênero, calculadas a partir do catálogo (os gêneros mais frequentes).
  function renderGenreRows() {
    const host = $("#genreRows"); if (!host) return;
    if (!isHomeView()) { host.innerHTML = ""; return; }
    const groups = new Map();
    catalog.forEach(item => splitGenres(item.genre).forEach(genre => {
      if (genre === "Filme" || genre === "Série") return;
      const key = normalizeSearch(genre);
      if (!key) return;
      const group = groups.get(key) || {label: genre, items: []};
      group.items.push(item); groups.set(key, group);
    }));
    const rows = [...groups.values()].filter(group => group.items.length >= 6).sort((a, b) => b.items.length - a.items.length).slice(0, LOW_POWER_DEVICE ? 2 : 4);
    host.innerHTML = rows.map((group, index) => rowSectionMarkup(`genreRow${index}`, group.label, group.items.slice(0, 14), group.label)).join("");
  }
  let homeRowsTimer = null;
  function renderHomeRows() {
    clearTimeout(homeRowsTimer);
    homeRowsTimer = setTimeout(() => {
      if (!isHomeView()) return;
      renderContinue(); renderTrending(); renderRecommendations(); renderGenreRows();
    }, 40);
  }
  function syncGenreOptions() {
    const select = $("#genreFilter"); if (!select) return;
    const key = String(catalog.length);
    if (key === genreOptionsKey) return;
    genreOptionsKey = key;
    const known = new Set([...select.options].map(option => normalizeSearch(option.value === "Tudo" ? "" : option.value)));
    const extra = new Map();
    catalog.forEach(item => splitGenres(item.genre).forEach(genre => {
      const norm = normalizeSearch(genre);
      if (norm && !known.has(norm) && genre !== "Filme" && genre !== "Série" && !extra.has(norm)) extra.set(norm, genre);
    }));
    [...extra.values()].sort((a, b) => a.localeCompare(b, "pt-BR")).forEach(genre => select.add(new Option(genre, genre)));
  }
  function updateCatalogCounters() {
    $("#totalTitles").textContent = catalog.length;
    $("#totalMovies").textContent = catalog.filter(item => item.type === "Filme").length;
    $("#totalSeries").textContent = catalog.filter(item => item.type === "Série").length;
  }
  function endCatalogLoading() {
    if (!catalogLoading) return;
    catalogLoading = false;
    if (!catalog.length) renderCatalog(); // só redesenha se for trocar a grade de carregamento pela mensagem de vazio
  }
  function renderCatalog(resetVisible = true) {
    if (pendingDeepLink) openDeepLink();
    updateCatalogCounters();
    // Em TV ao vivo, histórico ou lista não há grade do catálogo para desenhar.
    if (!browsing()) { renderMyList(); if (currentView === "history") renderWatchHistory(); return; }
    if (resetVisible) catalogVisibleLimit = CATALOG_BATCH_SIZE;
    syncGenreOptions();
    const items = filteredCatalog();
    const visibleItems = items.slice(0, catalogVisibleLimit);
    const grid = $("#catalogGrid");
    $("#favoritesOnlyFilter")?.setAttribute("aria-pressed", String(favoritesOnly));
    renderRecentSearches();
    const showSkeleton = catalogLoading && !catalog.length;
    grid.setAttribute("aria-busy", String(showSkeleton));
    if (showSkeleton) { grid.innerHTML = skeletonMarkup(LOW_POWER_DEVICE ? 6 : 12); lastGridIds = []; }
    else {
      const ids = visibleItems.map(item => item.id);
      // "Mostrar mais" só acrescenta os cartões novos, sem redesenhar (nem recarregar) os que já estão na tela.
      const append = !resetVisible && lastGridIds.length && lastGridIds.length < ids.length && lastGridIds.every((id, index) => id === ids[index]);
      if (append) grid.insertAdjacentHTML("beforeend", visibleItems.slice(lastGridIds.length).map(item => cardMarkup(item)).join(""));
      else grid.innerHTML = visibleItems.map(item => cardMarkup(item)).join("");
      lastGridIds = ids;
    }
    const showMore = $("#showMoreCatalog");
    if (showMore) {
      const remaining = Math.max(0, items.length - visibleItems.length);
      showMore.classList.toggle("hidden", remaining === 0);
      showMore.textContent = remaining ? `Mostrar mais ${Math.min(CATALOG_BATCH_SIZE, remaining)} (${remaining} restantes)` : "Todos os títulos exibidos";
      showMore.setAttribute("aria-label", remaining ? `Mostrar mais títulos. Restam ${remaining}` : "Todos os títulos exibidos");
    }
    $("#emptyState").classList.toggle("hidden", showSkeleton || items.length > 0);
    grid.classList.toggle("hidden", !showSkeleton && items.length === 0);
    const query = $("#searchInput").value.trim();
    $("#catalogHeading").textContent = favoritesOnly ? "Minha lista" : query ? "Resultados da busca" : currentView === "movies" ? "Filmes" : currentView === "series" ? "Séries" : "Todos os títulos";
    const resultCount = $("#catalogResultCount");
    if (resultCount) resultCount.textContent = showSkeleton ? "Carregando catálogo…" : `${items.length} ${items.length === 1 ? "título" : "títulos"}${items.length > visibleItems.length ? `, exibindo ${visibleItems.length}` : ""}`;
    const sortNote = $("#catalogSortNote");
    if (sortNote) sortNote.textContent = $("#sortFilter")?.selectedOptions?.[0]?.textContent || "";
    if (isHomeView()) { updateFeaturedHero(); restartFeaturedRotation(); renderHomeRows(); }
    // Títulos que chegam da busca online também entram na lista de sugestões enquanto a pessoa digita.
    if (document.activeElement === $("#searchInput")) renderSearchSuggestions();
    const status = $("#catalogStatus");
    if (status && tmdbCredential && !status.textContent) status.textContent = "Catálogo online conectado. Os dados vêm do TMDB.";
  }

  /* ---------------- Telas, rotas e navegação ---------------- */
  const VIEW_ROUTES = {home: "#/", movies: "#/filmes", series: "#/series", tv: "#/tv", list: "#/lista", history: "#/assistidos"};
  const browsing = () => ["home", "movies", "series", "search"].includes(currentView);
  const isHomeView = () => currentView === "home";
  function viewFromHash(hash) {
    const clean = String(hash || "").replace(/^#\/?/, "").split("?")[0];
    const [first, second] = clean.split("/");
    if (first === "titulo" && second) { try { return {view: "home", title: decodeURIComponent(second)}; } catch (_) { return {view: "home", title: ""}; } }
    if (!first) return {view: "home", title: ""};
    const found = Object.entries(VIEW_ROUTES).find(([, route]) => route === `#/${first}`);
    return {view: found ? found[0] : null, title: ""}; // âncora desconhecida: não é uma rota do app
  }
  function setActiveNav(view) {
    document.querySelectorAll("[data-nav]").forEach(element => {
      const active = element.dataset.nav === view || (view === "search" && element.dataset.nav === "home") || (element.dataset.also || "").split(" ").includes(view);
      element.classList.toggle("active", active);
      if (element.classList.contains("seg")) element.setAttribute("aria-pressed", String(active));
      else if (active) element.setAttribute("aria-current", "page");
      else element.removeAttribute("aria-current");
    });
  }
  function setViewState(view) {
    currentView = view;
    activeFilter = view === "movies" ? "Filme" : view === "series" ? "Série" : "Tudo";
    document.body.dataset.view = view;
    setActiveNav(view);
  }
  function resetBrowseFilters() {
    favoritesOnly = false;
    const search = $("#searchInput"); if (search) search.value = "";
    const clear = $("#searchClear"); if (clear) clear.dataset.empty = "true";
    const genre = $("#genreFilter"); if (genre) genre.value = "Tudo";
    const sort = $("#sortFilter"); if (sort) sort.value = "featured";
    closeSuggestions();
  }
  // Buscar ou filtrar "Minha lista" troca para a tela só de resultados; limpar volta ao início.
  function syncBrowseMode() {
    const input = $("#searchInput");
    const searching = Boolean(input.value.trim()) || favoritesOnly;
    const before = currentView;
    if (searching && !["movies", "series", "search"].includes(currentView)) setViewState("search");
    else if (!searching && currentView === "search") setViewState("home");
    if (before !== currentView) window.scrollTo(0, 0);
    const clear = $("#searchClear"); if (clear) clear.dataset.empty = String(!input.value);
  }
  function setRoute(route) {
    if (location.hash === route || (route === "#/" && !location.hash)) return;
    try { history.pushState(null, "", route); } catch (_) { location.hash = route; }
  }
  function renderView(view) {
    if (view === "tv") { renderTvChannels(); loadTvChannelsFromCloud(); }
    else if (view === "history") renderWatchHistory();
    else if (view === "list") renderMyList();
    else renderCatalog();
  }
  function navigate(view, options = {}) {
    if (!VIEW_ROUTES[view]) view = "home";
    const {updateRoute = true, scroll = true} = options;
    closeAllModals();
    resetBrowseFilters();
    setViewState(view);
    if (updateRoute) setRoute(VIEW_ROUTES[view]);
    renderView(view);
    const bar = $("#topbar");
    if (bar?.classList.contains("search-open")) { bar.classList.remove("search-open"); $("#searchToggle")?.setAttribute("aria-expanded", "false"); }
    if (scroll) window.scrollTo(0, 0);
    restartFeaturedRotation();
  }
  function setFilter(filter) { navigate(filter === "Filme" ? "movies" : filter === "Série" ? "series" : "home"); }
  function clearAllFilters() {
    const keep = currentView === "movies" || currentView === "series" ? currentView : "home";
    resetBrowseFilters();
    setViewState(keep);
    renderCatalog();
  }
  const showMyList = () => navigate("list");
  const showWatchHistory = () => navigate("history");
  function openDeepLink() {
    if (!pendingDeepLink) return false;
    const item = findItem(pendingDeepLink);
    if (!item) return false;
    pendingDeepLink = "";
    openDetails(item, {fromRoute: true});
    return true;
  }
  async function resolveDeepLink(id) {
    const match = String(id).match(/^tmdb-(tv|movie)-(\d+)$/);
    if (!match || !tmdbCredential) return false;
    try {
      const data = await tmdbRequest(`${match[1]}/${match[2]}`);
      mergeTmdbResults([{...data, media_type: match[1], genre_ids: (data.genres || []).map(genre => genre.id)}], false);
      return true;
    } catch (_) { return false; }
  }
  function applyRoute(hash, options = {}) {
    const route = viewFromHash(hash);
    if (!route.title && !route.view) { if (options.initial) navigate("home", {updateRoute: false, scroll: false}); return; }
    if (route.title) {
      pendingDeepLink = route.title;
      if (!browsing()) navigate("home", {updateRoute: false, scroll: false});
      if (!openDeepLink()) {
        resolveDeepLink(route.title).then(() => openDeepLink());
        window.setTimeout(() => {
          if (!pendingDeepLink) return;
          pendingDeepLink = "";
          showToast("Não encontramos esse título. Ele pode ter saído do catálogo.");
          try { history.replaceState(null, "", "#/"); } catch (_) {}
        }, 9000);
      }
    } else navigate(route.view, {updateRoute: false, scroll: !options.initial});
  }
  window.addEventListener("popstate", () => {
    if (suppressPopstate) { suppressPopstate = false; return; }
    if (openModalElements().length) { closeAllModals({fromPop: true}); return; }
    applyRoute(location.hash);
  });
  function openGenre(label) {
    closeAllModals();
    resetBrowseFilters();
    const select = $("#genreFilter");
    if (![...select.options].some(option => option.value === label)) select.add(new Option(label, label));
    select.value = label;
    setViewState("search");
    renderCatalog();
    window.scrollTo(0, 0);
  }

  /* ---------------- Janelas (modais) ---------------- */
  // Nomes lógicos usados pelo app apontam para os IDs reais do HTML (inclui "profiles", que faltava no original).
  const modalIds = {details:"detailsModal", player:"playerModal", admin:"adminModal", info:"infoModal", tmdb:"tmdbModal", account:"accountModal", tvChannel:"tvChannelModal", tvPlayer:"tvPlayerModal", profiles:"profilesModal", trailer:"trailerModal"};
  const openModalElements = () => [...document.querySelectorAll(".modal")].filter(modal => !modal.classList.contains("hidden"));
  // Cada conjunto de janelas abertas ocupa uma entrada do histórico: o botão Voltar (celular, TV) fecha a janela em vez de sair do site.
  function releaseModalHistory() {
    if (modalHistoryPushed) {
      window.setTimeout(() => {
        if (openModalElements().length || !modalHistoryPushed) return;
        modalHistoryPushed = false;
        suppressPopstate = true;
        try { history.back(); } catch (_) { suppressPopstate = false; }
        window.setTimeout(() => { suppressPopstate = false; }, 600);
      }, 0);
    } else if (/^#\/titulo\//.test(location.hash)) {
      try { history.replaceState(null, "", VIEW_ROUTES[currentView] || "#/"); } catch (_) {}
    }
  }
  function openModal(id) {
    const modal = $("#" + (modalIds[id] || id));
    if (!modal) { console.error("Modal não encontrado:", id); return; }
    if (!openModalElements().length && !modalHistoryPushed && !skipModalPush) {
      try { history.pushState({lumiModal: true}, "", location.href); modalHistoryPushed = true; } catch (_) {}
    }
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  function closeModal(id, options = {}) {
    const key = modalIds[id] || id;
    const modal = $("#" + key);
    if (!modal) { console.error("Modal não encontrado:", id); return; }
    modal.classList.add("hidden");
    if (key === "playerModal") {
      clearTimeout(playbackLoadTimer); playbackLoadTimer = null; playbackRequestToken++;
      const video = $("#videoPlayer"); if (video) { video.pause(); video.removeAttribute("src"); video.load(); video.classList.remove("hidden"); }
      const embed = $("#embedPlayer"); if (embed) { embed.onload = null; embed.onerror = null; setFrame(embed, "about:blank"); embed.classList.add("hidden"); }
      $("#videoPlaceholder").classList.remove("hidden"); clearInterval(progressTimer);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
    // Interrompe qualquer transmissão ao fechar, inclusive com a tecla Esc (no original o áudio continuava tocando).
    if (key === "tvPlayerModal") { const frame = $("#tvEmbedFrame"); if (frame) setFrame(frame, "about:blank"); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); }
    if (key === "trailerModal") { const frame = $("#trailerFrame"); if (frame) setFrame(frame, "about:blank"); }
    if (!openModalElements().length) {
      document.body.style.overflow = "";
      document.title = DEFAULT_TITLE;
      if (!options.skipHistory) releaseModalHistory();
    }
  }
  function closeAllModals(options = {}) {
    const open = openModalElements();
    if (!open.length) return;
    if (options.fromPop) modalHistoryPushed = false;
    open.forEach(modal => closeModal(modal.id, {skipHistory: true}));
    releaseModalHistory();
  }
  function toggleFavorite(id) {
    const item = findItem(id);
    if (!item) return;
    const adding = !isFavorite(item.id);
    favorites = adding ? [...favorites, item.id] : favorites.filter(entry => entry !== item.id);
    saveFavorites();
    syncFavoriteButtons(item.id);
    if (currentView === "list") renderMyList();
    showToast(adding ? "Adicionado à minha lista." : "Removido da minha lista.");
  }
  // "Surpreenda-me": sorteia um título dentro dos filtros atuais, preferindo o que ainda não foi assistido.
  function pickRandomTitle() {
    const items = filteredCatalog();
    if (!items.length) { showToast("Nenhum título para sortear com os filtros atuais."); return; }
    const watched = new Set(watchHistory.map(entry => String(entry.id)));
    const fresh = items.filter(item => !watched.has(String(item.id)));
    const pool = fresh.length ? fresh : items;
    openDetails(pool[Math.floor(Math.random() * pool.length)]);
  }
  async function playTrailer() {
    const item = findItem(selectedItemId);
    if (!item) return;
    const identity = tmdbIdentity(item);
    if (!tmdbCredential || !identity) { showToast("Trailer indisponível para este título."); return; }
    const button = $("#detailsTrailer");
    setButton(button, null, "Buscando…"); button.disabled = true;
    try {
      const [mediaType, tmdbId] = identity.split(":");
      const key = `trailer:${identity}`;
      let videoKey = cacheGet(key);
      if (videoKey === null) {
        const data = await tmdbRequest(`${mediaType}/${encodeURIComponent(tmdbId)}/videos`, {include_video_language: "pt,en,null"});
        const list = (data.results || []).filter(entry => entry.site === "YouTube" && /^[\w-]{6,20}$/.test(entry.key || ""));
        const pick = list.find(entry => entry.type === "Trailer" && entry.official && entry.iso_639_1 === "pt")
          || list.find(entry => entry.type === "Trailer" && entry.iso_639_1 === "pt")
          || list.find(entry => entry.type === "Trailer" && entry.official)
          || list.find(entry => entry.type === "Trailer")
          || list.find(entry => entry.type === "Teaser") || list[0];
        videoKey = pick ? pick.key : "";
        cacheSet(key, videoKey);
      }
      if (selectedItemId !== item.id) return;
      if (!videoKey) { showToast("Nenhum trailer disponível para este título."); return; }
      $("#trailerTitle").textContent = `Trailer: ${item.title}`;
      setFrame($("#trailerFrame"), `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoKey)}?autoplay=1&rel=0&playsinline=1`);
      openModal("trailer");
    } catch (error) { showToast(error.message || "Não foi possível carregar o trailer."); }
    finally { setButton(button, null, "Trailer"); button.disabled = false; }
  }
  async function togglePlayerFullscreen() {
    const wrap = $("#videoWrap");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (wrap?.requestFullscreen) await wrap.requestFullscreen();
      else if (wrap?.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
      else showToast("Tela cheia não é compatível com este navegador. Use o botão dentro do player.");
    } catch (_) { showToast("Não foi possível entrar em tela cheia."); }
  }
  function scheduleSaveCatalog() { clearTimeout(saveCatalogTimer); saveCatalogTimer = setTimeout(saveCatalog, 600); }
  function warmPlaybackConnection(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.origin === location.origin) return;
      if (document.querySelector(`link[data-playback-origin="${url.origin}"]`)) return;
      const dns = document.createElement("link");
      dns.rel = "dns-prefetch"; dns.href = url.origin; dns.dataset.playbackOrigin = url.origin;
      document.head.appendChild(dns);
      const preconnect = document.createElement("link");
      preconnect.rel = "preconnect"; preconnect.href = url.origin; preconnect.crossOrigin = "anonymous"; preconnect.dataset.playbackOrigin = url.origin;
      document.head.appendChild(preconnect);
    } catch (_) { /* A URL inválida não deve bloquear a abertura do player. */ }
  }
  function armPlaybackLoadTimeout(token, message) {
    clearTimeout(playbackLoadTimer);
    playbackLoadTimer = window.setTimeout(() => {
      if (token !== playbackRequestToken || $("#playerModal").classList.contains("hidden")) return;
      $("#videoPlaceholderMessage").textContent = message;
      $("#retryPlayback")?.classList.remove("hidden");
      $("#retryPlayerButton")?.classList.remove("hidden");
    }, LOW_POWER_DEVICE ? 14000 : 18000);
  }
  const detailsRoute = item => "#/titulo/" + encodeURIComponent(item.id);
  function setDetailsArt(item) {
    const backdrop = $("#detailsBackdrop"), poster = $("#detailsPoster"), hero = $("#detailsHero");
    const posterUrl = safePoster(item.poster), wideUrl = safePoster(item.backdrop);
    if (backdrop) {
      const src = wideUrl ? tmdbSize(wideUrl, LOW_POWER_DEVICE ? "w780" : "w1280") : (posterUrl ? tmdbSize(posterUrl, "w780") : "");
      if (!src) { backdrop.removeAttribute("src"); backdrop.classList.add("is-empty"); backdrop.classList.remove("is-loaded"); }
      else {
        backdrop.classList.remove("is-empty");
        if (backdrop.getAttribute("src") !== src) { backdrop.classList.remove("is-loaded"); backdrop.setAttribute("src", src); }
        else if (backdrop.complete && backdrop.naturalWidth) backdrop.classList.add("is-loaded");
      }
      hero?.classList.toggle("is-poster-only", !wideUrl);
    }
    if (poster) poster.innerHTML = posterUrl ? `<img src="${escapeHTML(tmdbSize(posterUrl, "w500"))}" alt="Capa de ${escapeHTML(item.title)}" decoding="async">` : `<span class="poster-fallback">${escapeHTML(item.title)}</span>`;
  }
  function openDetails(item, options = {}) {
    if (!item) return;
    // Mostra a janela primeiro e preenche no quadro seguinte, para o toque parecer imediato.
    const token = ++detailsOpenToken;
    selectedItemId = item.id;
    skipModalPush = Boolean(options.fromRoute);
    openModal("details");
    skipModalPush = false;
    try { history.replaceState(history.state, "", detailsRoute(item)); } catch (_) {}
    document.title = `${item.title} | LumiPlay`;
    const panel = $("#detailsModal .details-panel"); if (panel) panel.scrollTop = 0;
    $("#detailsTitle").textContent = item.title;
    $("#detailsEyebrow").textContent = item.type === "Série" ? "Série" : "Filme";
    setDetailsMeta(item);
    setDetailsArt(item);
    syncFavoriteButtons(item.id);
    const schedule = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
    schedule(() => { if (token === detailsOpenToken && selectedItemId === item.id) populateDetails(item); });
  }
  function populateDetails(item) {
    if (!item || selectedItemId !== item.id) return;
    selectedItemId = item.id;
    trackTitleEvent(item, "click");
    $("#detailsTitle").textContent = item.title;
    $("#detailsEyebrow").textContent = item.type === "Série" ? "Série" : "Filme";
    setDetailsMeta(item);
    $("#detailsDescription").textContent = item.description || "Nenhuma descrição cadastrada.";
    setDetailsArt(item);
    syncFavoriteButtons(item.id);
    $("#detailsTrailer")?.classList.toggle("hidden", !(tmdbCredential && tmdbIdentity(item)));
    setButton($("#detailsPlay"), "play", "Assistir");
    const isSeries = item.type === "Série";
    const seasonCount = Array.isArray(item.seasons) ? item.seasons.length : 0;
    const episodeCount = Array.isArray(item.seasons) ? item.seasons.reduce((n, season) => n + (season.episodes?.length || 0), 0) : 0;
    if (isSeries) {
      $("#episodeArea").classList.remove("hidden");
      $("#episodeList").innerHTML = '<p class="form-hint">Carregando temporadas e episódios…</p>';
      $("#seasonSelect").innerHTML = '<option>Carregando…</option>';
    } else $("#episodeArea").classList.add("hidden");
    if (isSeries) {
      if (item.seasons?.length && item.seasons.some(season => Array.isArray(season.episodes) && season.episodes.length)) {
        $("#seasonSelect").innerHTML = item.seasons.map((season,index) => `<option value="${index}">${escapeHTML(season.name || `Temporada ${index+1}`)}${season.episodes?.length ? ` (${season.episodes.length})` : ""}</option>`).join("");
        if (item.seasons[0]?.episodes?.length) renderEpisodes(item, 0);
        else if (tmdbCredential) loadSeasonEpisodes(item, 0).catch(error => { if (selectedItemId === item.id) $("#episodeList").innerHTML = `<p class="form-hint">${escapeHTML(error.message || "Não foi possível carregar os episódios.")}</p><button class="button button-ghost" type="button" data-retry-season="0">Tentar novamente</button>`; });
        else renderEpisodes(item, 0);
      } else if (tmdbCredential) {
        // Títulos locais/importados podem não ter tmdbId; resolver pelo nome evita deixar a série sem episódios.
        loadSeriesEpisodes(item).catch(error => {
          console.warn("Não foi possível carregar temporadas", error);
          if (selectedItemId === item.id) $("#episodeList").innerHTML = `<p class="form-hint">${escapeHTML(error.message || "Não foi possível carregar os episódios.")}</p><button class="button button-ghost" type="button" data-retry-season="metadata">Tentar novamente</button>`;
        });
      } else {
        $("#episodeList").innerHTML = '<p class="form-hint">Conecte o TMDB para carregar temporadas automaticamente ou cadastre os episódios pelo painel administrativo.</p>';
      }
    }
    $("#detailsCastSection").classList.add("hidden");
    $("#detailsSimilarSection").classList.add("hidden");
    $("#detailsCast").innerHTML = '<p class="form-hint">Carregando elenco…</p>';
    $("#detailsSimilar").innerHTML = '<p class="form-hint">Buscando títulos relacionados…</p>';
    // Zera o painel da comunidade para não mostrar dados do título anterior enquanto o novo carrega.
    currentRating = 0; $("#commentText").value = ""; $("#commentText").disabled = false; renderRatingStars();
    document.querySelectorAll("#ratingInput [data-rating]").forEach(button => { button.disabled = false; });
    const feedbackReset = $("#commentForm button[type='submit']"); if (feedbackReset) { feedbackReset.disabled = false; feedbackReset.textContent = "Enviar comentário"; }
    $("#detailRatingAverage").textContent = "—"; $("#detailClickCount").textContent = "0"; $("#detailCompletionCount").textContent = "0";
    $("#commentsList").innerHTML = '<p class="form-hint">Carregando avaliações e comentários…</p>';
    loadTitleCommunity(item);
    // Primeiro deixa a janela aparecer e só então consulta metadados opcionais.
    // TVs recebem consultas sequenciais e listas menores para evitar picos de CPU/rede.
    const scheduleExtras = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
    scheduleExtras(() => {
      if (selectedItemId !== item.id) return;
      loadTitleExtras(item).catch(error => {
        console.warn("Metadados extras do título indisponíveis", error);
        if (selectedItemId === item.id) {
          $("#detailsCastSection").classList.add("hidden");
          $("#detailsSimilarSection").classList.add("hidden");
        }
      });
    });
  }
  async function loadTitleExtras(item) {
    const identity = tmdbIdentity(item);
    if (!tmdbCredential || !identity) return;
    const [mediaType, tmdbId] = identity.split(":");
    const cacheKey = `title-extras:${mediaType}:${tmdbId}`;
    let extras = cacheGet(cacheKey);
    if (!extras) {
      let credits, recommendations;
      if (LOW_POWER_DEVICE) {
        // Consultas sequenciais evitam duas respostas grandes ao mesmo tempo em Tizen.
        credits = await tmdbRequest(`${mediaType}/${encodeURIComponent(tmdbId)}/credits`);
        if (selectedItemId !== item.id) return;
        recommendations = await tmdbRequest(`${mediaType}/${encodeURIComponent(tmdbId)}/recommendations`, {page:1});
      } else {
        [credits, recommendations] = await Promise.all([
          tmdbRequest(`${mediaType}/${encodeURIComponent(tmdbId)}/credits`),
          tmdbRequest(`${mediaType}/${encodeURIComponent(tmdbId)}/recommendations`, {page:1})
        ]);
      }
      extras = {
        cast:(credits.cast || []).slice(0, LOW_POWER_DEVICE ? 6 : 10).map(person => ({id:person.id,name:person.name||"Artista",character:person.character||"",photo:person.profile_path?`https://image.tmdb.org/t/p/${LOW_POWER_DEVICE ? "w92" : "w185"}${person.profile_path}`:""})),
        related:(recommendations.results || []).filter(entry => entry && entry.id && (entry.poster_path || entry.title || entry.name)).slice(0, LOW_POWER_DEVICE ? 6 : 12).map(entry => ({...entry,media_type:mediaType}))
      };
      cacheSet(cacheKey, extras);
    }
    if (selectedItemId !== item.id) return;
    const castSection = $("#detailsCastSection"), castList = $("#detailsCast");
    if (extras.cast?.length) {
      castList.innerHTML = extras.cast.slice(0, LOW_POWER_DEVICE ? 6 : 10).map(person => {
        const photo = LOW_POWER_DEVICE ? String(person.photo || "").replace("/w185/", "/w92/") : person.photo;
        return `<article class="cast-person"><span class="cast-photo">${photo ? `<img src="${escapeHTML(photo)}" alt="" loading="lazy" decoding="async">` : ICON("user")}</span><strong>${escapeHTML(person.name)}</strong>${person.character ? `<small>${escapeHTML(person.character)}</small>` : ""}</article>`;
      }).join("");
      castSection.classList.remove("hidden");
    } else castSection.classList.add("hidden");
    const similarSection = $("#detailsSimilarSection"), similarGrid = $("#detailsSimilar");
    const relatedItems = (extras.related || []).map(raw => normalizeTmdb(raw)).filter(Boolean);
    if (relatedItems.length) {
      // Os relacionados ficam disponíveis para abrir, mas não forçam uma renderização completa do catálogo.
      mergeTmdbResults(extras.related, false);
      const usable = relatedItems.map(candidate => catalog.find(entry => tmdbIdentity(entry) === tmdbIdentity(candidate)) || candidate).filter(candidate => candidate.id !== item.id);
      similarGrid.innerHTML = usable.slice(0, LOW_POWER_DEVICE ? 6 : 12).map(related => relatedCardMarkup(related)).join("");
      similarSection.classList.toggle("hidden", !usable.length);
    } else similarSection.classList.add("hidden");
  }
  function normalizeEpisodeData(data, seasonNumber) {
    return (data?.episodes || []).map(ep => ({
      title:ep.name || `Episódio ${ep.episode_number}`, description:ep.overview || "",
      tmdbEpisodeId:ep.id ? String(ep.id) : "", episodeNumber:Number(ep.episode_number),
      seasonNumber, still:ep.still_path ? `https://image.tmdb.org/t/p/${LOW_POWER_DEVICE ? "w185" : "w300"}${ep.still_path}` : ""
    }));
  }
  async function loadSeasonEpisodes(item, seasonIndex) {
    const season = item?.seasons?.[seasonIndex];
    if (!season) return;
    const seasonNumber = Number(season.seasonNumber ?? seasonIndex + 1);
    if (Array.isArray(season.episodes) && season.episodes.length) {
      if (selectedItemId === item.id && Number($("#seasonSelect").value) === seasonIndex) renderEpisodes(item, seasonIndex);
      return;
    }
    const tmdbId = String(item.tmdbId || "");
    if (!/^\d+$/.test(tmdbId)) throw new Error("Não foi possível identificar esta série no TMDB.");
    const cacheKey = `series:${tmdbId}:season:${seasonNumber}`;
    const cached = cacheGet(cacheKey);
    if (cached && Array.isArray(cached.episodes)) {
      season.episodes = cached.episodes;
    } else {
      if (selectedItemId === item.id && Number($("#seasonSelect").value) === seasonIndex) $("#episodeList").innerHTML = '<p class="form-hint">Carregando episódios desta temporada…</p>';
      const data = await tmdbRequest(`tv/${encodeURIComponent(tmdbId)}/season/${seasonNumber}`);
      season.episodes = normalizeEpisodeData(data, seasonNumber);
      cacheSet(cacheKey, {episodes:season.episodes});
    }
    if (selectedItemId === item.id && Number($("#seasonSelect").value) === seasonIndex) renderEpisodes(item, seasonIndex);
    // Só grava o catálogo depois de receber dados; o cache de temporadas permanece local para evitar gravações repetidas.
    saveCatalog();
  }
  async function loadSeriesEpisodes(item) {
    if (!tmdbCredential) throw new Error("Conecte o TMDB para carregar os episódios.");
    let tmdbId = String(item.tmdbId || "");
    const idMatch = String(item.id || "").match(/^tmdb-tv-(\d+)$/);
    if (!/^\d+$/.test(tmdbId) && idMatch) tmdbId = idMatch[1];
    if (!/^\d+$/.test(tmdbId)) {
      const searchKey = `series-search:${String(item.title || "").toLocaleLowerCase("pt-BR")}:${item.year || ""}`;
      let match = cacheGet(searchKey);
      if (!match) {
        const result = await tmdbRequest("search/tv", {query:item.title, page:1, include_adult:"false"});
        const results = result.results || [];
        const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
        const exact = results.find(entry => norm(entry.name) === norm(item.title));
        const yearMatch = item.year ? results.find(entry => String(entry.first_air_date || "").startsWith(String(item.year))) : null;
        match = exact || yearMatch || (results.length === 1 ? results[0] : null);
        if (!match?.id) throw new Error(`Não encontrei “${item.title}” no TMDB. Confira o nome ou informe o ID TMDB no painel administrativo.`);
        cacheSet(searchKey, {id:match.id, name:match.name, first_air_date:match.first_air_date || ""});
      }
      tmdbId = String(match.id);
      item.tmdbId = tmdbId;
      item.tmdbMediaType = "tv";
    }
    const allCacheKey = `series:${tmdbId}:episodes`;
    const cachedAll = cacheGet(allCacheKey);
    if (Array.isArray(cachedAll) && cachedAll.length && cachedAll.every(season => Array.isArray(season.episodes) && season.episodes.length)) {
      item.seasons = cachedAll;
      if (selectedItemId === item.id) {
        $("#seasonSelect").innerHTML = cachedAll.map((season,index) => `<option value="${index}">${escapeHTML(season.name || `Temporada ${season.seasonNumber ?? index+1}`)} (${season.episodes.length})</option>`).join("");
        renderEpisodes(item, 0);
      }
      return;
    }
    const detailsKey = `series:${tmdbId}:details`;
    let details = cacheGet(detailsKey);
    if (!details) { details = await tmdbRequest(`tv/${encodeURIComponent(tmdbId)}`); cacheSet(detailsKey, details); }
    if (selectedItemId !== item.id) return;
    const seasonsMeta = (details.seasons || []).filter(season => Number(season.season_number) > 0);
    if (!seasonsMeta.length) throw new Error("O TMDB não retornou temporadas para esta série.");
    item.seasons = seasonsMeta.map(meta => {
      const seasonNumber = Number(meta.season_number);
      const cached = cacheGet(`series:${tmdbId}:season:${seasonNumber}`);
      return {name:meta.name || `Temporada ${seasonNumber}`, seasonNumber, episodes:Array.isArray(cached?.episodes) ? cached.episodes : []};
    });
    $("#seasonSelect").innerHTML = item.seasons.map((season,index) => `<option value="${index}">${escapeHTML(season.name)}${season.episodes.length ? ` (${season.episodes.length})` : ""}</option>`).join("");
    const count = Number(details.number_of_seasons || item.seasons.length);
    setDetailsMeta(item, [`${count} ${count === 1 ? "temporada" : "temporadas"}`]);
    // Carrega somente a primeira temporada. As demais são buscadas quando o usuário as seleciona.
    await loadSeasonEpisodes(item, 0);
    const total = item.seasons.reduce((sum, season) => sum + (season.episodes?.length || 0), 0);
    if (selectedItemId === item.id) setDetailsMeta(item, [`${count} ${count === 1 ? "temporada" : "temporadas"}`, total ? `${total} episódios` : "Episódios disponíveis"]);
    if (item.seasons.every(season => Array.isArray(season.episodes) && season.episodes.length)) cacheSet(allCacheKey, item.seasons);
    saveCatalog();
  }
  function renderRatingStars() {
    document.querySelectorAll("#ratingInput [data-rating]").forEach(button => {
      button.classList.toggle("selected", Number(button.dataset.rating) <= currentRating);
      button.setAttribute("aria-checked", String(Number(button.dataset.rating) === currentRating));
    });
  }
  async function trackTitleEvent(item, eventType) {
    // Em TVs lentas, não bloqueie a abertura de um título com chamadas de analytics.
    // Também não recarregue os comentários aqui: openDetails já inicia esse carregamento.
    if (LOW_POWER_DEVICE || !supabaseClient || !item?.id) return;
    try {
      const {error} = await supabaseClient.from("catalogo_eventos").upsert({app_id:String(item.id), visitor_id:visitorId, tipo_evento:eventType}, {onConflict:"app_id,visitor_id,tipo_evento", ignoreDuplicates:true});
      if (error) console.warn("Não foi possível registrar evento", error.message);
    } catch (error) { console.warn(error); }
  }
  async function loadTitleCommunity(item) {
    const comments = $("#commentsList"); if (!comments || !item?.id) return;
    if (!supabaseClient) { comments.innerHTML = '<p class="form-hint">Avaliações e estatísticas aparecem quando o Supabase está conectado e as tabelas de comunidade foram criadas.</p>'; return; }
    try {
      const feedbackQuery = supabaseClient.from("catalogo_feedback").select("id,visitor_id,avaliacao,comentario,criado_em").eq("app_id",String(item.id)).order("criado_em",{ascending:false}).limit(LOW_POWER_DEVICE ? 15 : 50);
      const [feedbackResult, eventsResult, myResult] = LOW_POWER_DEVICE
        ? [await feedbackQuery, {data:[],error:null}, {data:null,error:null}]
        : await Promise.all([
            feedbackQuery,
            supabaseClient.from("catalogo_eventos").select("visitor_id,tipo_evento").eq("app_id",String(item.id)),
            supabaseClient.from("catalogo_feedback").select("avaliacao,comentario").eq("app_id",String(item.id)).eq("visitor_id",visitorId).maybeSingle()
          ]);
      if (selectedItemId !== item.id) return; // a pessoa já abriu outro título
      if (feedbackResult.error) throw feedbackResult.error;
      if (eventsResult.error) throw eventsResult.error;
      const feedback = feedbackResult.data || [], events = eventsResult.data || [];
      const ratings = feedback.filter(x => Number(x.avaliacao) > 0).map(x => Number(x.avaliacao));
      $("#detailRatingAverage").textContent = ratings.length ? (ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1).replace(".", ",")+" / 5" : "—";
      $("#detailClickCount").textContent = new Set(events.filter(x=>x.tipo_evento==="click").map(x=>x.visitor_id)).size;
      $("#detailCompletionCount").textContent = new Set(events.filter(x=>x.tipo_evento==="completed").map(x=>x.visitor_id)).size;
      const hasSubmitted = !!myResult.data;
      if (hasSubmitted) { currentRating = Number(myResult.data.avaliacao)||0; $("#commentText").value = myResult.data.comentario || ""; }
      document.querySelectorAll("#ratingInput [data-rating]").forEach(button => { button.disabled = hasSubmitted; });
      $("#commentText").disabled = hasSubmitted;
      const feedbackSubmit = $("#commentForm button[type='submit']");
      if (feedbackSubmit) { feedbackSubmit.disabled = hasSubmitted; feedbackSubmit.textContent = hasSubmitted ? "Comentário já enviado" : "Enviar comentário"; }
      renderRatingStars();
      comments.innerHTML = feedback.filter(x => String(x.comentario||"").trim()).length ? feedback.filter(x => String(x.comentario||"").trim()).map(x=>`<article class="comment-card"><div class="comment-head"><strong>${escapeHTML(x.visitor_id===visitorId?"Você":"Usuário LumiPlay")}</strong><span>${x.avaliacao ? `${ICON("star")} ${Number(x.avaliacao)}/5` : "Sem nota"}</span></div><p>${escapeHTML(x.comentario)}</p><div class="comment-foot"><small>${x.criado_em ? new Date(x.criado_em).toLocaleDateString("pt-BR") : ""}</small>${x.visitor_id===visitorId ? "" : `<button class="text-button comment-report" type="button" data-feedback-id="${Number(x.id)}" aria-label="Denunciar comentário de usuário LumiPlay">Denunciar</button>`}</div></article>`).join("") : '<p class="form-hint">Ainda não há comentários. Seja o primeiro a comentar.</p>';
    } catch (error) { comments.innerHTML = '<p class="form-hint">Não foi possível carregar a comunidade. Execute os arquivos SQL da pasta database/ e confira as permissões do Supabase.</p>'; console.warn(error); }
  }
  async function saveTitleFeedback(event) {
    event.preventDefault(); const item = findItem(selectedItemId); if (!item || !supabaseClient) { showToast("Conecte o Supabase para publicar avaliações e comentários."); return; }
    const comment = $("#commentText").value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    if (!currentRating && !comment) { showToast("Escolha uma nota ou escreva um comentário."); return; }
    if (comment && comment.length < 3) { showToast("O comentário precisa ter pelo menos 3 caracteres."); return; }
    if (comment.length > 800) { showToast("O comentário pode ter no máximo 800 caracteres."); return; }
    const submitButton = $("#commentForm button[type='submit']"); if (submitButton) submitButton.disabled = true;
    const payload = {app_id:String(item.id), visitor_id:visitorId, avaliacao:currentRating || null, comentario:comment};
    const {error} = await supabaseClient.from("catalogo_feedback").insert(payload);
    if (error) {
      if (error.code === "23505") showToast("Você já enviou uma avaliação para este título neste navegador.");
      else showToast("Não foi possível salvar a avaliação. Confira a conexão e as permissões do Supabase.");
      if (submitButton) submitButton.disabled = false;
      return;
    }
    showToast("Avaliação enviada. Obrigado!"); await loadTitleCommunity(item); await loadCommunityRatings();
  }
  async function reportCommunityComment(button) {
    const feedbackId = Number(button?.dataset.feedbackId);
    const item = findItem(selectedItemId);
    if (!supabaseClient || !item || !Number.isSafeInteger(feedbackId) || feedbackId < 1) { showToast("Não foi possível abrir a denúncia. Confira a conexão."); return; }
    const reason = window.prompt("Conte por que este comentário deve ser revisado (10 a 500 caracteres). Não inclua dados pessoais.");
    if (reason === null) return;
    const cleanReason = reason.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    if (cleanReason.length < 10 || cleanReason.length > 500) { showToast("A justificativa deve ter entre 10 e 500 caracteres."); return; }
    button.disabled = true;
    try {
      const {error} = await supabaseClient.from("catalogo_denuncias_feedback").insert({feedback_id:feedbackId,app_id:String(item.id),reporter_visitor_id:visitorId,motivo:cleanReason});
      if (error?.code === "23505") showToast("Você já denunciou este comentário neste navegador.");
      else if (error) { showToast("Não foi possível enviar. Execute a migração social do LumiPlay e confira o Supabase."); button.disabled = false; }
      else { button.textContent = "Denunciado"; button.disabled = true; showToast("Denúncia enviada para revisão. Obrigado."); }
    } catch (_) { button.disabled = false; showToast("Falha de conexão ao enviar a denúncia."); }
  }
  async function logAdminAction(action, targetType, targetId, details = {}) {
    if (!supabaseClient || adminSession?.user?.id !== ADMIN_UID) return false;
    const {error} = await supabaseClient.from("lumiplay_admin_audit").insert({
      actor_uid: adminSession.user.id, action, target_type: targetType,
      target_id: String(targetId ?? ""), details
    });
    if (error) { console.warn("Não foi possível registrar auditoria administrativa", error); return false; }
    return true;
  }
  async function loadAdminAuditLog() {
    const list = $("#adminAuditLog"), status = $("#auditLogStatus");
    if (!list || !status) return;
    if (!supabaseClient || adminSession?.user?.id !== ADMIN_UID) {
      list.replaceChildren(); status.textContent = "Entre como administrador para consultar o histórico."; return;
    }
    status.textContent = "Carregando histórico…"; list.replaceChildren();
    try {
      const {data, error} = await supabaseClient.from("lumiplay_admin_audit")
        .select("id,action,target_type,target_id,details,created_at")
        .order("created_at", {ascending:false}).limit(50);
      if (error) throw error;
      if (!data?.length) { status.textContent = "Ainda não há ações registradas."; return; }
      const labels = {report_reviewed:"Denúncia revisada",comment_removed:"Comentário removido",admin_login:"Login administrativo"};
      list.innerHTML = data.map(entry => {
        const when = entry.created_at ? new Date(entry.created_at).toLocaleString("pt-BR") : "Data indisponível";
        const details = entry.details && typeof entry.details === "object" ? Object.entries(entry.details).map(([key,value]) => `${key}: ${String(value)}`).join("; ") : "";
        return `<article class="admin-item audit-item"><div class="admin-item-text"><strong>${escapeHTML(labels[entry.action] || entry.action)}</strong><span>${escapeHTML(when)}, ${escapeHTML(entry.target_type || "registro")} #${escapeHTML(String(entry.target_id || "—"))}</span>${details ? `<p class="moderation-comment">${escapeHTML(details)}</p>` : ""}</div></article>`;
      }).join("");
      status.textContent = `${data.length} ação(ões) recentes. Máximo de 50 exibidas.`;
    } catch (error) {
      console.warn("Falha ao carregar auditoria", error);
      status.textContent = "Não foi possível carregar o histórico. Execute database/supabase-social-features.sql e confira as políticas RLS.";
    }
  }

  async function loadModerationReports() {
    const list = $("#moderationReports"), status = $("#moderationStatus");
    if (!list || !status) return;
    if (!supabaseClient || adminSession?.user?.id !== ADMIN_UID) {
      list.replaceChildren(); status.textContent = "Entre com a conta administradora autorizada para consultar denúncias."; return;
    }
    status.textContent = "Carregando denúncias…"; list.replaceChildren();
    try {
      let query = supabaseClient.from("catalogo_denuncias_feedback").select("id,feedback_id,app_id,motivo,criado_em,status,resolved_at").order("criado_em", {ascending:false}).limit(100);
      const filter = $("#reportStatusFilter")?.value || "pending";
      if (filter !== "all") query = query.eq("status", filter);
      const {data: reports, error} = await query;
      if (error) throw error;
      const pendingResult = await supabaseClient.from("catalogo_denuncias_feedback").select("id", {count:"exact", head:true}).eq("status", "pending");
      const pendingCount = pendingResult.error ? null : (pendingResult.count || 0);
      const heading = $("#moderationPanel h3");
      if (heading) heading.textContent = pendingCount === null ? "Moderação da comunidade" : `Moderação da comunidade: ${pendingCount} ${pendingCount === 1 ? "pendente" : "pendentes"}`;
      if (!reports?.length) { status.textContent = "Nenhuma denúncia nesta categoria."; return; }
      const feedbackIds = [...new Set(reports.map(r => Number(r.feedback_id)).filter(Number.isSafeInteger))];
      const feedbackResult = feedbackIds.length ? await supabaseClient.from("catalogo_feedback").select("id,comentario,avaliacao").in("id", feedbackIds) : {data:[],error:null};
      if (feedbackResult.error) throw feedbackResult.error;
      const feedbackMap = new Map((feedbackResult.data || []).map(row => [Number(row.id), row]));
      list.innerHTML = reports.map(report => {
        const feedback = feedbackMap.get(Number(report.feedback_id));
        const comment = feedback?.comentario || "Comentário não encontrado (pode ter sido removido).";
        const created = report.criado_em ? new Date(report.criado_em).toLocaleString("pt-BR") : "Data indisponível";
        const statusLabel = report.status === "reviewed" ? "Revisada" : "Pendente";
        return `<article class="moderation-item admin-item"><div class="admin-item-text"><strong>Denúncia #${Number(report.id)}, ${escapeHTML(statusLabel)}</strong><span>Título ID: ${escapeHTML(String(report.app_id))}, ${escapeHTML(created)}</span><p class="moderation-comment">${escapeHTML(comment)}</p><p class="moderation-reason"><strong>Motivo:</strong> ${escapeHTML(report.motivo)}</p></div><div class="moderation-actions">${report.status === "pending" ? `<button class="button button-ghost moderation-review" type="button" data-report-review="${Number(report.id)}">Marcar revisada</button>` : ""}${feedback ? `<button class="delete-button moderation-remove" type="button" data-feedback-remove="${Number(feedback.id)}">Remover comentário</button>` : ""}</div></article>`;
      }).join("");
      status.textContent = `${reports.length} denúncia(s) carregada(s).`;
    } catch (error) {
      console.warn("Falha ao carregar denúncias", error);
      status.textContent = "Não foi possível carregar denúncias. Execute database/supabase-social-features.sql e confira as políticas RLS.";
    }
  }
  async function reviewCommunityReport(button) {
    if (adminSession?.user?.id !== ADMIN_UID || !supabaseClient) { showToast("Entre como administrador para revisar denúncias."); return; }
    const id = Number(button?.dataset.reportReview);
    if (!Number.isSafeInteger(id) || id < 1) return;
    button.disabled = true;
    const {error} = await supabaseClient.from("catalogo_denuncias_feedback").update({status:"reviewed",resolved_at:new Date().toISOString(),resolved_by:adminSession.user.id}).eq("id",id);
    if (error) { button.disabled = false; showToast("Não foi possível atualizar a denúncia. Confira a migração e as permissões."); return; }
    const audited = await logAdminAction("report_reviewed", "denuncia", id, {status:"reviewed"});
    showToast(audited ? "Denúncia revisada e ação registrada." : "Denúncia revisada, mas o histórico não foi salvo."); await loadModerationReports(); await loadAdminAuditLog();
  }
  async function removeReportedComment(button) {
    if (adminSession?.user?.id !== ADMIN_UID || !supabaseClient) { showToast("Entre como administrador para moderar comentários."); return; }
    const id = Number(button?.dataset.feedbackRemove);
    if (!Number.isSafeInteger(id) || id < 1) return;
    if (!window.confirm("Remover este comentário da comunidade? A ação não pode ser desfeita.")) return;
    button.disabled = true;
    const {error} = await supabaseClient.from("catalogo_feedback").delete().eq("id",id).select("id");
    if (error) { button.disabled = false; showToast("Não foi possível remover o comentário. Confira a migração e as permissões."); return; }
    const audited = await logAdminAction("comment_removed", "feedback", id, {reason:"Removido a partir da fila de denúncias"});
    showToast(audited ? "Comentário removido e ação registrada." : "Comentário removido, mas o histórico não foi salvo."); await loadModerationReports(); await loadAdminAuditLog();
  }

  function renderEpisodes(item, seasonIndex) {
    const season = item.seasons?.[seasonIndex];
    const episodes = season?.episodes || [];
    $("#episodeList").innerHTML = episodes.length ? episodes.map((episode, index) => {
      const thumb = safePoster(episode.still || episode.poster);
      const number = String(episode.episodeNumber || index + 1).padStart(2, "0");
      return `<button class="episode-row" type="button" data-episode="${index}" data-season="${seasonIndex}"><span class="episode-thumb"><span>${number}</span>${thumb ? `<img src="${escapeHTML(thumb)}" alt="" loading="lazy" decoding="async">` : ""}</span><span class="episode-copy"><strong>${escapeHTML(episode.title || `Episódio ${index + 1}`)}</strong><small>${escapeHTML(episode.description || "Episódio da série.")}</small></span><span class="episode-play">${ICON("play")}</span></button>`;
    }).join("") : '<p class="form-hint">Nenhum episódio cadastrado nesta temporada.</p>';
  }
  // Próximo episódio: segue na mesma temporada ou passa para o primeiro da seguinte.
  function nextEpisodeTarget() {
    const last = lastPlayback;
    if (!last || last.item.type !== "Série" || !Array.isArray(last.item.seasons) || !last.item.seasons.length) return null;
    const seasons = last.item.seasons;
    const seasonIndex = last.seasonIndex == null ? 0 : Number(last.seasonIndex);
    const episodeIndex = last.episodeIndex == null ? 0 : Number(last.episodeIndex);
    const episodes = seasons[seasonIndex]?.episodes;
    if (Array.isArray(episodes) && episodeIndex + 1 < episodes.length) return {seasonIndex, episodeIndex: episodeIndex + 1, needsLoad: false};
    if (seasonIndex + 1 < seasons.length) return {seasonIndex: seasonIndex + 1, episodeIndex: 0, needsLoad: !seasons[seasonIndex + 1].episodes?.length};
    return null;
  }
  function updateNextEpisodeButton() { $("#playerNext")?.classList.toggle("hidden", !nextEpisodeTarget()); }
  async function playNextEpisode() {
    const target = nextEpisodeTarget();
    if (!target || !lastPlayback) return;
    const item = lastPlayback.item;
    const button = $("#playerNext");
    try {
      if (button) button.disabled = true;
      if (target.needsLoad) { selectedItemId = item.id; await loadSeasonEpisodes(item, target.seasonIndex); }
      const episode = item.seasons[target.seasonIndex]?.episodes?.[target.episodeIndex];
      if (episode) playItem(item, episode, target.seasonIndex, target.episodeIndex);
      else showToast("Não há mais episódios disponíveis.");
    } catch (error) { showToast(error.message || "Não foi possível carregar o próximo episódio."); }
    finally { if (button) button.disabled = false; }
  }
  function playItem(item, episode = null, seasonIndex = null, episodeIndex = null) {
    if (!item) return;
    clearTimeout(playbackLoadTimer); playbackLoadTimer = null;
    const requestToken = ++playbackRequestToken;
    lastPlayback = {item,episode,seasonIndex,episodeIndex};
    const directSource = safeURL(episode?.video || item.video);
    const tmdbMatch = String(item.id || "").match(/^tmdb-(?:tv|movie)-(\d+)$/);
    const tmdbId = String(item.tmdbId || (tmdbMatch ? tmdbMatch[1] : "")).trim();
    // Aquece DNS/TLS no clique, em paralelo à abertura da interface.
    if (directSource) warmPlaybackConnection(directSource);
    else if (/^\d+$/.test(tmdbId)) warmPlaybackConnection("https://mgeb.site/");
    closeModal("details");
    openModal("player");
    $("#playerTitle").textContent = episode ? `${item.title} — ${episode.title || "Episódio"}` : item.title;
    $("#playerDescription").textContent = "Estamos conectando à fonte de reprodução.";
    $("#videoPlaceholderMessage").textContent = "Preparando seu filme…";
    $("#videoPlaceholder").classList.remove("hidden");
    $("#retryPlayback")?.classList.add("hidden");
    $("#retryPlayerButton")?.classList.add("hidden");
    const schedulePlayback = callback => window.setTimeout(callback, LOW_POWER_DEVICE ? 24 : 0);
    schedulePlayback(() => {
      if (requestToken === playbackRequestToken) preparePlayback(item, episode, seasonIndex, episodeIndex);
    });
  }
  function preparePlayback(item, episode = null, seasonIndex = null, episodeIndex = null) {
    if (!item) return;
    lastPlayback = {item,episode,seasonIndex,episodeIndex};
    updateNextEpisodeButton();
    const retryButton=$("#retryPlayerButton"); if(retryButton) retryButton.classList.add("hidden");
    const retryPlaceholder=$("#retryPlayback"); if(retryPlaceholder) retryPlaceholder.classList.add("hidden");
    $("#videoPlaceholderMessage").textContent="Conectando à fonte de reprodução…";
    $("#retryPlayback")?.classList.add("hidden");
    const requestToken = playbackRequestToken;
    clearTimeout(playbackLoadTimer); playbackLoadTimer = null;
    const title = episode ? `${item.title} — ${episode.title || "Episódio"}` : item.title;
    const source = safeURL(episode?.video || item.video);
    const video = $("#videoPlayer"), embed = $("#embedPlayer"), placeholder = $("#videoPlaceholder");
    // Resolva a fonte antes de tocar nos elementos de mídia. O caminho externo
    // não deve executar video.load(), que é particularmente caro no navegador Tizen.
    const tmdbMatch = String(item.id || "").match(/^tmdb-(?:tv|movie)-(\d+)$/);
    const tmdbId = String(item.tmdbId || (tmdbMatch ? tmdbMatch[1] : "")).trim();
    let embedUrl = "";
    if (/^\d+$/.test(tmdbId)) {
      if (item.type === "Série") {
        const selectedSeason = seasonIndex !== null ? item.seasons?.[Number(seasonIndex)] : null;
        const selectedEpisode = selectedSeason && episodeIndex !== null ? selectedSeason.episodes?.[Number(episodeIndex)] : null;
        const seasonNumber = Number(selectedEpisode?.seasonNumber ?? selectedSeason?.seasonNumber ?? (seasonIndex !== null ? Number(seasonIndex) + 1 : 1));
        const episodeNumber = Number(selectedEpisode?.episodeNumber ?? (episodeIndex !== null ? Number(episodeIndex) + 1 : 1));
        embedUrl = `https://mgeb.site/embed/${encodeURIComponent(tmdbId)}/${seasonNumber}/${episodeNumber}`;
      } else embedUrl = `https://mgeb.site/embed/${encodeURIComponent(tmdbId)}`;
    }
    const videoWrap = document.querySelector(".player-panel .video-wrap");
    // Em TVs não baixe uma imagem grande de fundo enquanto o player abre.
    if (videoWrap && !LOW_POWER_DEVICE) {
      const playerArt = safePoster(episode?.still || episode?.poster || item.backdrop || item.poster);
      if (playerArt) videoWrap.style.setProperty("--player-art", `url("${playerArt.replace(/["\\)]/g, "")}")`);
      else videoWrap.style.removeProperty("--player-art");
    } else if (videoWrap) videoWrap.style.removeProperty("--player-art");
    video.classList.add("hidden");
    $("#nativePlayerTools")?.classList.add("hidden");
    $("#playerProgressSummary")?.classList.add("hidden");
    video.playbackRate=Number($("#playbackSpeed")?.value||1);
    const captionsButton=$("#captionsButton"); if(captionsButton){captionsButton.disabled=true;captionsButton.setAttribute("aria-pressed","false");setButton(captionsButton,null,"Legendas");}
    $("#playerTitle").textContent = title;
    $("#playerDescription").textContent = `${[item.type, item.year, splitGenres(item.genre).join(", ")].filter(Boolean).join(", ")}. ${episode?.description || item.description || "Sem descrição cadastrada."}`;
    placeholder.classList.remove("hidden");
    if (embedUrl && !source) {
      // Mostra um estado de carregamento bonito até o documento do player externo responder.
      if (video.hasAttribute("src")) { video.pause(); video.removeAttribute("src"); }
      embed.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
      embed.setAttribute("allowfullscreen", "");
      embed.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      embed.setAttribute("loading", "eager");
      embed.dataset.playbackToken = String(requestToken);
      embed.onload = () => {
        if (Number(embed.dataset.playbackToken) !== playbackRequestToken) return;
        clearTimeout(playbackLoadTimer); playbackLoadTimer = null;
        placeholder.classList.add("hidden");
        $("#retryPlayback")?.classList.add("hidden");
        retryButton?.classList.add("hidden");
        $("#playerSourceNote").textContent = "Fonte conectada. Se o vídeo não iniciar sozinho, use o botão de reprodução dentro do player.";
      };
      embed.onerror = () => {
        if (Number(embed.dataset.playbackToken) !== playbackRequestToken) return;
        $("#videoPlaceholderMessage").textContent = "Não foi possível conectar à fonte. Verifique a conexão ou tente novamente.";
        $("#retryPlayback")?.classList.remove("hidden");
        retryButton?.classList.remove("hidden");
      };
      embed.classList.remove("hidden");
      placeholder.classList.remove("hidden");
      $("#videoPlaceholderMessage").textContent = "Conectando ao player de vídeo…";
      $("#playerSourceNote").textContent = "Preparando conexão segura com a fonte de reprodução.";
      armPlaybackLoadTimeout(requestToken, "A fonte está demorando para responder. Você pode aguardar mais um pouco ou tentar novamente.");
      // Reatribuir a URL permite que a ação "Tentar novamente" recarregue a mesma fonte,
      // sem navegar primeiro para about:blank.
      setFrame(embed, embedUrl);
    } else if (source) {
      if (embed.dataset.src && embed.dataset.src !== "about:blank") setFrame(embed, "about:blank");
      if (!video.paused) video.pause();
      video.querySelectorAll("track[data-lumiplay-subtitle]").forEach(track=>track.remove());
      video.classList.remove("hidden"); $("#nativePlayerTools")?.classList.remove("hidden"); $("#playerProgressSummary")?.classList.remove("hidden");
      if (video.getAttribute("src") !== source) video.setAttribute("src", source);
      placeholder.classList.remove("hidden");
      $("#videoPlaceholderMessage").textContent = "Carregando o vídeo…";
      armPlaybackLoadTimeout(requestToken, "O vídeo está demorando para carregar. Confira a conexão ou tente novamente.");
      const subtitlesUrl=safeVttURL(episode?.subtitlesUrl || item.subtitlesUrl || "");
      if(subtitlesUrl){const track=document.createElement("track");track.kind="captions";track.label="Português";track.srclang="pt-BR";track.src=subtitlesUrl;track.dataset.lumiplaySubtitle="1";video.appendChild(track);track.addEventListener("load",()=>{const captions=$("#captionsButton");if(captions){captions.disabled=false;captions.setAttribute("aria-pressed","true");setButton(captions,null,"Legendas ativadas");}try{track.track.mode="showing";}catch(_){}});track.addEventListener("error",()=>showToast("Não foi possível carregar a legenda. Confira o arquivo VTT e o CORS."));}
      $("#captionsButton") && ( $("#captionsButton").disabled=!subtitlesUrl );
      $("#playerSourceNote").textContent = "Vídeo direto compatível. Legendas exigem arquivo WebVTT (.vtt) acessível pelo navegador.";
      // Definir src inicia o carregamento; evitar uma segunda chamada explícita a load().
      video.onloadeddata = () => { clearTimeout(playbackLoadTimer); playbackLoadTimer = null; placeholder.classList.add("hidden"); retryPlaceholder?.classList.add("hidden"); retryButton?.classList.add("hidden"); };
      video.onerror = () => { clearTimeout(playbackLoadTimer); playbackLoadTimer = null; placeholder.classList.remove("hidden"); $("#videoPlaceholderMessage").textContent="Não foi possível reproduzir este arquivo. Confira se a URL é direta, segura (HTTPS) e compatível com o navegador da TV."; retryPlaceholder?.classList.remove("hidden"); retryButton?.classList.remove("hidden"); };
      retryButton?.classList.add("hidden");
      const progressKey = episode ? `${item.id}:s${Number(episode.seasonNumber ?? (seasonIndex !== null ? Number(seasonIndex)+1 : 1))}:e${Number(episode.episodeNumber ?? (episodeIndex !== null ? Number(episodeIndex)+1 : 1))}` : item.id;
      video.onloadedmetadata = () => { if (progress[progressKey]?.time && progress[progressKey].time < video.duration - 10) video.currentTime = progress[progressKey].time; };
      let lastProgressPersistAt = 0;
      video.ontimeupdate = () => {
        if (video.duration && Number.isFinite(video.duration)) {
          const elapsed=$("#playerElapsed"), durationLabel=$("#playerDuration"), fill=$("#playerProgressFill"), track=$("#playerProgressTrack");
          if(elapsed) elapsed.textContent=formatPlayerTime(video.currentTime);
          if(durationLabel) durationLabel.textContent=formatPlayerTime(video.duration);
          const percent=Math.max(0,Math.min(100,video.currentTime/video.duration*100));
          if(fill) fill.style.width=`${percent}%`;
          if(track) track.setAttribute("aria-valuenow",String(Math.round(percent)));
          const now = Date.now();
          const previous = progress[progressKey] || {};
          progress[progressKey] = {...previous,time:video.currentTime,duration:video.duration,title:item.title,episode:episode?.title || "",updated:now};
          // Atualiza em memória em cada evento, mas grava no armazenamento no máximo a cada 10 s.
          // Isso evita escrita síncrona repetida no celular durante a reprodução.
          if (now - lastProgressPersistAt >= 10000) { lastProgressPersistAt = now; saveProgress(); }
          if (!progress[progressKey].completedTracked && video.duration - video.currentTime <= 1200) { progress[progressKey].completedTracked = true; saveProgress(); trackTitleEvent(item, "completed"); }
        }
      };
      video.onended = () => { if (!progress[progressKey]?.completedTracked) trackTitleEvent(item, "completed"); delete progress[progressKey]; saveProgress(); renderContinue(); };
      video.onpause = () => { if (video.currentTime > 0 && video.duration && Number.isFinite(video.duration)) saveProgress(); };
    } else {
      if (embed.dataset.src && embed.dataset.src !== "about:blank") setFrame(embed, "about:blank");
      if (video.hasAttribute("src")) { video.pause(); video.removeAttribute("src"); }
      $("#playerSourceNote").textContent = "Este título não tem ID TMDB válido nem fonte de vídeo direta cadastrada.";
      $("#videoPlaceholderMessage").textContent="Ainda não há uma fonte de vídeo cadastrada para este título.";
      retryPlaceholder?.classList.add("hidden");
    }
    // A escrita síncrona do histórico e a renderização da lista não devem atrasar
    // a primeira pintura da tela de reprodução na TV.
    window.setTimeout(() => { if (requestToken === playbackRequestToken) recordWatch(item, episode, seasonIndex, episodeIndex); }, LOW_POWER_DEVICE ? 650 : 0);
  }
  function renderContinue() {
    const section = $("#continueSection"), grid = $("#continueGrid"); if (!section || !grid) return;
    if (!isHomeView()) { section.classList.add("hidden"); return; }
    const entries = Object.entries(progress).filter(([key, value]) => value && value.duration && value.time > 2 && value.time < value.duration - 10).sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0));
    const seen = new Set(), cards = [];
    for (const [key, value] of entries) {
      const item = findItem(key.split(":")[0]);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      const minutes = Math.max(1, Math.round((value.duration - value.time) / 60));
      cards.push(cardMarkup(item, {progress: value.time / value.duration * 100, sub: [value.episode || (item.type === "Série" ? "Série" : "Filme"), `${minutes} min restantes`]}));
      if (cards.length >= 12) break;
    }
    grid.innerHTML = cards.join("");
    section.classList.toggle("hidden", cards.length === 0);
  }
  let historyFilter = "Tudo";
  function renderWatchHistory() {
    const grid = $("#watchHistoryGrid");
    if (!grid) return;
    const query = ($("#historySearch")?.value || "").trim().toLocaleLowerCase("pt-BR");
    const entries = watchHistory.filter(entry => (historyFilter === "Tudo" || entry.type === historyFilter) && (!query || `${entry.title} ${entry.episode || ""}`.toLocaleLowerCase("pt-BR").includes(query)));
    const cards = [];
    entries.forEach(entry => {
      const item = findItem(entry.id);
      if (!item) return;
      const label = entry.episode ? `${entry.season ? `T${entry.season} ` : ""}${entry.episodeNumber ? `E${entry.episodeNumber}` : entry.episode}`.trim() : "Filme";
      const date = entry.watchedAt ? new Date(entry.watchedAt).toLocaleDateString("pt-BR") : "";
      cards.push(cardMarkup(item, {sub: [label, date]}));
    });
    grid.innerHTML = cards.join("");
    $("#watchHistoryEmpty").classList.toggle("hidden", cards.length > 0);
  }
  function renderMyList() {
    if (currentView !== "list") return;
    // Mais recentes primeiro.
    const items = [...favorites].reverse().map(id => findItem(id)).filter(Boolean);
    $("#myListGrid").innerHTML = items.map(item => cardMarkup(item)).join("");
    $("#myListEmpty").classList.toggle("hidden", items.length > 0);
  }
  function renderAdminList() {
    const total = catalog.length;
    $("#adminTotalTitles") && ($("#adminTotalTitles").textContent=String(total));
    $("#adminTotalMovies") && ($("#adminTotalMovies").textContent=String(catalog.filter(item=>item.type==="Filme").length));
    $("#adminTotalSeries") && ($("#adminTotalSeries").textContent=String(catalog.filter(item=>item.type==="Série").length));
    $("#adminTotalChannels") && ($("#adminTotalChannels").textContent=String(tvChannels.length));
    const query = normalizeSearch($("#adminCatalogSearch")?.value || "");
    const type = $("#adminCatalogType")?.value || "Tudo";
    const sort = $("#adminCatalogSort")?.value || "title-asc";
    const filtered = catalog.filter(item => {
      const matchesType = type === "Tudo" || item.type === type;
      const searchable = normalizeSearch([item.title,item.genre,item.year,item.type,item.description,item.tmdbId].filter(Boolean).join(" "));
      return matchesType && (!query || searchable.includes(query));
    }).sort((a,b) => {
      if (sort === "title-desc") return String(b.title||"").localeCompare(String(a.title||""),"pt-BR");
      if (sort === "year-desc") return Number(b.year||0)-Number(a.year||0) || String(a.title||"").localeCompare(String(b.title||""),"pt-BR");
      if (sort === "year-asc") return Number(a.year||0)-Number(b.year||0) || String(a.title||"").localeCompare(String(b.title||""),"pt-BR");
      return String(a.title||"").localeCompare(String(b.title||""),"pt-BR");
    });
    const count = $("#adminCatalogResultCount");
    if (count) count.textContent = `${filtered.length} de ${total} título(s)${query || type !== "Tudo" ? " encontrados" : " no catálogo"}.`;
    $("#adminList").innerHTML = filtered.length ? filtered.map(item => `<div class="admin-item"><label class="check preserve-check" title="Marque para preservar ao excluir em massa"><input type="checkbox" data-preserve="${escapeHTML(item.id)}" ${preservedIds.has(String(item.id))?"checked":""}> Preservar</label><div class="admin-item-text"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.type)}, ${escapeHTML(item.year || "ano não informado")}${item.genre ? ", " + escapeHTML(item.genre) : ""}</span></div><button class="button button-glass edit-button" data-edit="${escapeHTML(item.id)}" type="button">Editar</button><button class="button button-danger delete-button" data-delete="${escapeHTML(item.id)}" type="button">Excluir</button></div>`).join("") : `<p class="form-hint">${total ? "Nenhum título corresponde à busca e aos filtros." : "Nenhum título cadastrado."}</p>`;
    const all = total > 0 && catalog.every(item=>preservedIds.has(String(item.id)));
    if ($("#preserveSelectAll")) $("#preserveSelectAll").checked = all;
  }
  function readSeasonBuilder() {
    const list = $("#seasonEditorList");
    if (!list) return [];
    return [...list.querySelectorAll("[data-season-card]")].map((card, si) => {
      const seasonNumber = Number(card.dataset.seasonNumber);
      return {
        name: card.querySelector("[data-season-name]")?.value.trim() || `Temporada ${si + 1}`,
        ...(seasonNumber > 0 ? {seasonNumber} : {}),
        episodes: [...card.querySelectorAll("[data-episode-card]")].map((ep, ei) => {
          const tmdbEpisodeId = ep.querySelector("[data-episode-tmdb-id]")?.value.trim() || "";
          const episodeNumber = Number(ep.dataset.episodeNumber), episodeSeason = Number(ep.dataset.seasonNumber);
          const still = safeURL(ep.dataset.still || "");
          return {
            title: ep.querySelector("[data-episode-title]")?.value.trim() || `Episódio ${ei + 1}`,
            description: ep.querySelector("[data-episode-description]")?.value.trim() || "",
            video: safeURL(ep.querySelector("[data-episode-video]")?.value.trim() || ""),
            subtitlesUrl: safeVttURL(ep.querySelector("[data-episode-subtitles-url]")?.value.trim() || ""),
            ...(/^\d+$/.test(tmdbEpisodeId) ? {tmdbEpisodeId: Number(tmdbEpisodeId)} : {}),
            ...(episodeNumber > 0 ? {episodeNumber} : {}),
            ...(episodeSeason > 0 ? {seasonNumber: episodeSeason} : {}),
            ...(still ? {still} : {})
          };
        })
      };
    });
  }
  function syncSeasonBuilder() {
    const field = $("#titleForm [name='seasons']");
    if (field) field.value = JSON.stringify(readSeasonBuilder(), null, 2);
  }
  function addEpisodeCard(container, episode = {}) {
    const index = container.querySelectorAll("[data-episode-card]").length + 1;
    const card = document.createElement("div");
    card.className = "episode-card";
    card.dataset.episodeCard = "1";
    card.innerHTML = `<div class="episode-card-head"><strong>Episódio ${index}</strong><button class="button button-ghost" type="button" data-remove-episode>Remover</button></div>
      <div class="episode-grid"><label>Nome do episódio<input data-episode-title maxlength="120" placeholder="Preencha automaticamente pelo TMDB"></label>
      <label>Descrição (opcional)<textarea data-episode-description rows="2" maxlength="500" placeholder="Sinopse automática pelo TMDB"></textarea></label>
      <label>URL direta do vídeo (opcional)<input data-episode-video type="url" placeholder="https://.../episodio.mp4"></label>
      <label>URL de legenda WebVTT (.vtt)<input data-episode-subtitles-url type="url" placeholder="https://.../episodio.vtt"></label>
      <label>ID do episódio no TMDB (opcional)<input data-episode-tmdb-id inputmode="numeric" pattern="[0-9]*" placeholder="Preenchido automaticamente"></label></div>
      <button class="button button-ghost" type="button" data-fetch-episode>Buscar nome, descrição e ID no TMDB</button>`;
    card.querySelector("[data-episode-title]").value = episode.title || "";
    card.querySelector("[data-episode-description]").value = episode.description || "";
    card.querySelector("[data-episode-video]").value = episode.video || "";
    card.querySelector("[data-episode-subtitles-url]").value = episode.subtitlesUrl || "";
    card.querySelector("[data-episode-tmdb-id]").value = episode.tmdbEpisodeId || episode.tmdb_episode_id || "";
    card.dataset.episodeNumber = episode.episodeNumber || ""; card.dataset.seasonNumber = episode.seasonNumber || ""; card.dataset.still = episode.still || "";
    card.querySelector("[data-fetch-episode]").addEventListener("click", async () => {
      const form = $("#titleForm"); const tmdbId = String(form.elements.tmdbId.value || "").trim();
      const seasonCard = container.closest("[data-season-card]");
      const seasonNumber = [...$("#seasonEditorList").querySelectorAll("[data-season-card]")].indexOf(seasonCard) + 1;
      const episodeNumber = [...container.querySelectorAll("[data-episode-card]")].indexOf(card) + 1;
      if (!tmdbCredential) { showToast("Conecte o TMDB pelo menu do perfil antes de buscar dados."); openTmdbSettings(); return; }
      if (!/^\d+$/.test(tmdbId)) { showToast("Preencha primeiro o ID TMDB da série."); return; }
      const button = card.querySelector("[data-fetch-episode]"); button.disabled = true; button.textContent = "Buscando no TMDB…";
      try {
        const data = await tmdbRequest(`tv/${encodeURIComponent(tmdbId)}/season/${seasonNumber}/episode/${episodeNumber}`);
        card.querySelector("[data-episode-title]").value = data.name || `Episódio ${episodeNumber}`;
        card.querySelector("[data-episode-description]").value = data.overview || "";
        card.querySelector("[data-episode-tmdb-id]").value = data.id ? String(data.id) : "";
        syncSeasonBuilder(); showToast(data.name ? "Dados do episódio preenchidos!" : "Episódio encontrado; sem sinopse disponível.");
      } catch (error) { showToast(error.message || "Falha ao buscar episódio."); }
      finally { button.disabled = false; button.textContent = "Buscar nome, descrição e ID no TMDB"; }
    });
    container.appendChild(card);
  }
  function addSeasonCard(season = {}) {
    const list = $("#seasonEditorList");
    if (!list) return;
    const index = list.querySelectorAll("[data-season-card]").length + 1;
    const card = document.createElement("section");
    card.className = "season-card";
    card.dataset.seasonCard = "1";
    card.dataset.seasonNumber = season.seasonNumber || "";
    card.innerHTML = `<div class="season-card-head"><strong>Temporada ${index}</strong><button class="button button-ghost" type="button" data-remove-season>Remover temporada</button></div>
      <label>Nome da temporada<input data-season-name maxlength="80" placeholder="Temporada ${index}"></label>
      <div data-episodes></div>
      <button class="button button-ghost" type="button" data-add-episode>Adicionar episódio</button>`;
    card.querySelector("[data-season-name]").value = season.name || `Temporada ${index}`;
    const episodes = card.querySelector("[data-episodes]");
    (Array.isArray(season.episodes) ? season.episodes : []).forEach(ep => addEpisodeCard(episodes, ep));
    if (!season.episodes?.length) addEpisodeCard(episodes);
    card.querySelector("[data-add-episode]").addEventListener("click", () => { addEpisodeCard(episodes); syncSeasonBuilder(); });
    card.querySelector("[data-remove-season]").addEventListener("click", () => { card.remove(); syncSeasonBuilder(); });
    card.addEventListener("input", syncSeasonBuilder);
    card.addEventListener("click", event => {
      if (event.target.closest("[data-remove-episode]")) { event.target.closest("[data-episode-card]")?.remove(); syncSeasonBuilder(); }
    });
    list.appendChild(card);
    syncSeasonBuilder();
  }
  function loadSeasonBuilder(seasons = []) {
    const list = $("#seasonEditorList");
    if (!list) return;
    list.innerHTML = "";
    (Array.isArray(seasons) ? seasons : []).forEach(addSeasonCard);
    syncSeasonBuilder();
  }
  function startEdit(item) {
    $("#titleForm [name=\"tmdbId\"]").value = item?.tmdbId ? String(item.tmdbId) : "";
    if (!item) return; const form=$("#titleForm");
    form.elements.editId.value=String(item.id); form.elements.title.value=item.title||""; form.elements.type.value=item.type||"Filme"; form.elements.genre.value=item.genre||""; form.elements.year.value=item.year||""; form.elements.poster.value=item.poster||""; form.elements.description.value=item.description||""; form.elements.video.value=item.video||""; form.elements.subtitlesUrl.value=item.subtitlesUrl||""; form.elements.seasons.value=item.seasons?.length?JSON.stringify(item.seasons,null,2):""; loadSeasonBuilder(item.seasons || []);
    $("#titleSubmit").textContent="Salvar alterações"; $("#cancelEdit").classList.remove("hidden"); form.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function cancelEdit() { const form=$("#titleForm"); form.reset(); form.elements.editId.value=""; loadSeasonBuilder([]); $("#titleSubmit").textContent="Adicionar título"; $("#cancelEdit").classList.add("hidden"); }
  async function deleteAllExceptPreserved() {
    if (adminSession?.user?.id !== ADMIN_UID) { showToast("Entre como administrador para excluir em massa."); return; }
    const doomed = catalog.filter(item => !preservedIds.has(String(item.id)));
    if (!doomed.length) { showToast("Todos os títulos estão marcados para preservar."); return; }
    if (!confirm(`ATENÇÃO: serão excluídos ${doomed.length} títulos não selecionados. Os títulos marcados serão preservados. Esta ação não pode ser desfeita. Continuar?`)) return;
    const button = $("#deleteExceptPreserved");
    const originalText = button.querySelector("span")?.textContent || "Excluir todos, exceto selecionados";
    button.disabled = true; setButton(button, null, "Excluindo 0/" + doomed.length + "…");
    const failed = [];
    try {
      for (let i = 0; i < doomed.length; i++) {
        setButton(button, null, `Excluindo ${i+1}/${doomed.length}…`);
        const ok = await deleteItemFromCloud(doomed[i]);
        if (!ok) failed.push(doomed[i]);
      }
      const failedIds = new Set(failed.map(item => String(item.id)));
      catalog = catalog.filter(item => preservedIds.has(String(item.id)) || failedIds.has(String(item.id)));
      favorites = favorites.filter(id => catalog.some(item => String(item.id) === String(id)));
      Object.keys(progress).forEach(key => { if (!catalog.some(item => String(item.id) === String(key.split(":")[0]))) delete progress[key]; });
      saveCatalog(); saveFavorites(); saveProgress(); renderCatalog(); renderAdminList();
      if (failed.length) showToast(`${doomed.length-failed.length} excluídos; ${failed.length} falharam. Veja o erro do Supabase e confira as permissões RLS.`);
      else showToast(`Exclusão concluída: ${doomed.length} título(s) removido(s).`);
    } catch (error) {
      console.error(error); showToast("A exclusão foi interrompida: " + error.message);
    } finally { button.disabled = false; setButton(button, null, originalText); }
  }
  function openAdmin() { renderAdminList(); openModal("admin"); refreshAdminState(); }

  const tmdbGenres = {28:"Ação",12:"Aventura",16:"Animação",35:"Comédia",80:"Crime",99:"Documentário",18:"Drama",10751:"Família",14:"Fantasia",36:"História",27:"Terror",10402:"Música",9648:"Mistério",10749:"Romance",878:"Ficção científica",10770:"Cinema TV",53:"Suspense",10752:"Guerra",37:"Faroeste",10759:"Ação",10762:"Infantil",10763:"Notícias",10764:"Reality",10765:"Ficção científica",10766:"Novela",10767:"Talk show",10768:"Guerra e política"};
  function tmdbImage(path) { return path ? "https://image.tmdb.org/t/p/w500" + path : ""; }
  function tmdbAuthHeaders() { return tmdbCredential.includes(".") ? {Authorization:"Bearer " + tmdbCredential, accept:"application/json"} : {accept:"application/json"}; }
  function tmdbUrl(path, params={}) {
    const url = new URL("https://api.themoviedb.org/3/" + path);
    Object.entries({language:"pt-BR",...params}).forEach(([key,value]) => { if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value); });
    if (!tmdbCredential.includes(".")) url.searchParams.set("api_key", tmdbCredential);
    return url.toString();
  }
  async function tmdbRequest(path, params={}) {
    const response = await fetch(tmdbUrl(path, params), {headers:tmdbAuthHeaders()});
    if (!response.ok) {
      if (response.status === 401) throw new Error("Chave/token inválido. Confira as credenciais do TMDB.");
      if (response.status === 429) throw new Error("O TMDB recebeu muitas solicitações. Aguarde um pouco e tente novamente.");
      throw new Error("Não foi possível consultar o TMDB (HTTP " + response.status + ").");
    }
    return response.json();
  }
  function normalizeTmdb(raw) {
    const isTV = raw.media_type === "tv" || (!!raw.name && !raw.title);
    if (!isTV && !raw.title) return null;
    const type = isTV ? "Série" : "Filme";
    const title = isTV ? raw.name : raw.title;
    const date = isTV ? raw.first_air_date : raw.release_date;
    const genres = Array.isArray(raw.genre_ids) ? [...new Set(raw.genre_ids.map(id => tmdbGenres[id]).filter(Boolean))] : [];
    const id = "tmdb-" + (isTV ? "tv-" : "movie-") + raw.id;
    return {id,title,type,genre:genres.join(" • ") || (isTV ? "Série" : "Filme"),year:date ? date.slice(0,4) : "",description:raw.overview || "Sinopse ainda não disponível em português.",poster:tmdbImage(raw.poster_path),backdrop:raw.backdrop_path ? "https://image.tmdb.org/t/p/w1280"+raw.backdrop_path : "",video:"",color:"#6650a4",seasons:[],tmdbId:raw.id,tmdbMediaType:isTV?"tv":"movie",voteAverage:raw.vote_average||0};
  }
  function mergeTmdbResults(results, rerender = true) {
    let added = 0;
    for (const raw of (results || [])) {
      const item = normalizeTmdb(raw);
      if (!item || !/^\d+$/.test(String(item.tmdbId || ""))) continue;
      const identity = tmdbIdentity(item);
      const index = catalog.findIndex(entry => entry.id === item.id || (identity && tmdbIdentity(entry) === identity));
      if (index >= 0) {
        const existing = catalog[index];
        catalog[index] = {...existing, ...item, id:existing.id || item.id,
          video:existing.video || "", seasons:existing.seasons?.length ? existing.seasons : [],
          dbId:existing.dbId || undefined};
      } else {
        catalog.push(item);
        added++;
      }
    }
    catalog = dedupeCatalog(catalog);
    scheduleSaveCatalog(); // gravação agrupada: evita reescrever o catálogo inteiro a cada resposta da API
    if (rerender) renderCatalog();
    return added;
  }
  async function searchTmdb(term) {
    if (!tmdbCredential || term.length < 2) return;
    $("#catalogStatus").textContent = "Buscando filmes e séries no TMDB…";
    try {
      const cacheKey = `search:${term.trim().toLocaleLowerCase("pt-BR")}`;
      let data = cacheGet(cacheKey);
      if (!data) {
        data = await tmdbRequest("search/multi", {query:term,include_adult:"false",page:1});
        cacheSet(cacheKey, data);
      }
      const filtered = (data.results || []).filter(item => item.media_type === "movie" || item.media_type === "tv");
      const added = mergeTmdbResults(filtered);
      $("#catalogStatus").textContent = `${filtered.length} ${filtered.length === 1 ? "resultado encontrado" : "resultados encontrados"} online${added ? `; ${added} ${added === 1 ? "novo título adicionado" : "novos títulos adicionados"} ao catálogo` : ""}.`;
      renderCatalog();
    } catch (error) { $("#catalogStatus").textContent = error.message; }
  }
  // Fallback local: mantém o catálogo utilizável quando a API do TMDB está indisponível.
  // Os itens locais são metadados de catálogo; não incluem nem inventam URLs de vídeo.
  async function loadBundledCatalogFallback() {
    await new Promise(resolve => setTimeout(resolve, 2200));
    if (catalog.length) { endCatalogLoading(); return; }
    try {
      const response = await fetch("data/catalog.json", {cache:"no-store"});
      if (!response.ok) throw new Error(`Catálogo local indisponível (${response.status})`);
      const bundled = await response.json();
      if (!Array.isArray(bundled)) throw new Error("Formato inválido no catálogo local");
      const fallback = bundled
        .filter(item => item && typeof item.title === "string" && item.title.trim() && ["Filme", "Série"].includes(item.type))
        .map((item, index) => ({...item, id:`seed-${String(item.id || index + 1).replace(/[^a-zA-Z0-9_-]/g, "-")}`, seasons:Array.isArray(item.seasons) ? item.seasons : [], video:""}));
      // Não sobrescreve títulos que chegaram do TMDB ou do Supabase enquanto o fetch ocorria.
      if (!catalog.length && fallback.length) {
        catalog = fallback;
        renderCatalog();
        const status = $("#catalogStatus");
        if (status) status.textContent = `Catálogo local de contingência carregado: ${fallback.length} títulos. Alguns recursos online podem estar indisponíveis.`;
      }
    } catch (error) {
      console.warn("Não foi possível carregar o catálogo local de contingência:", error);
    } finally { setTimeout(endCatalogLoading, 300); }
  }

  async function loadPopularTitles(reset=false) {
    if (!tmdbCredential || discoveryLoading) return;
    discoveryLoading = true;
    const button = $("#loadMoreTitles"); button.classList.remove("hidden"); button.disabled = true; button.textContent = "Carregando…";
    if (reset) discoveryPage = 1;
    try {
      const discoveryCacheKey = `trending:week:${discoveryPage}`;
      let data = cacheGet(discoveryCacheKey);
      if (!data || Date.now() - (tmdbCache[discoveryCacheKey]?.savedAt || 0) > DISCOVERY_CACHE_TTL) {
        data = await tmdbRequest("trending/all/week", {page:discoveryPage});
        cacheSet(discoveryCacheKey, data);
      }
      const results = (data.results || []).filter(item => item.media_type === "movie" || item.media_type === "tv");
      mergeTmdbResults(results);
      discoveryHasMore = discoveryPage < (data.total_pages || 1);
      discoveryPage++;
      button.classList.toggle("hidden", !discoveryHasMore);
      button.textContent = "Carregar mais títulos";
      $("#catalogStatus").textContent = `Catálogo online atualizado: ${results.length} títulos populares carregados nesta página.`;
    } catch (error) { $("#catalogStatus").textContent = error.message; button.textContent = "Tentar carregar novamente"; button.classList.remove("hidden"); }
    finally { discoveryLoading = false; button.disabled = false; }
  }
  function updateBulkProgress(done, total, message) {
    const bar = $("#bulkProgressBar"), text = $("#bulkProgressText");
    if (bar) bar.style.width = Math.max(0, Math.min(100, total ? done / total * 100 : 0)) + "%";
    if (text) text.textContent = message;
  }
  function getBulkState() { return safeParse(localStorage.getItem(BULK_STATE_KEY) || "null", null); }
  function setBulkButtons(running) {
    $("#bulkStart").disabled = running; $("#bulkPause").disabled = !running;
    $("#bulkStart").textContent = running ? "Importando…" : "Iniciar importação";
  }
  function bulkRow(item) {
    const row = itemToRow(item);
    // Keep imports strictly additive: no video URLs or seasons are supplied by metadata import.
    row.video_url = ""; row.temporadas = [];
    return row;
  }
  async function runBulkImport(resume=false) {
    if (bulkImportRunning) return;
    if (!tmdbCredential) { showToast("Conecte o TMDB primeiro no botão ☁."); openTmdbSettings(); return; }
    if (!supabaseClient || !adminSession || adminSession.user?.id !== ADMIN_UID) { showToast("Entre como administrador antes de importar."); return; }
    let state = resume ? getBulkState() : null;
    if (!state) state = {target:Number($("#bulkLimit").value)||1000, priority:$("#bulkPriority").value, types:$("#bulkTypes").value, genre:$("#bulkGenre")?.value || "", stage:0, page:1, scanned:0, inserted:0, skipped:0};
    bulkImportRunning = true; bulkImportPause = false; setBulkButtons(true);
    $("#bulkResume").classList.add("hidden");
    const target = Math.min(1000, Math.max(1, Number(state.target)||1000));
    const stages = [];
    const types = state.types === "both" ? ["movie","tv"] : [state.types];
    types.forEach(type => {
      if (state.priority === "popular" || state.priority === "mixed") stages.push({type, sort:"popularity.desc"});
      if (state.priority === "rated" || state.priority === "mixed") stages.push({type, sort:"vote_average.desc", minVotes:200});
    });
    try {
      // Read existing keys in pages to avoid replacing or duplicating records.
      const existing = new Set();
      for (let from=0; ; from+=500) {
        const {data,error} = await supabaseClient.from("catalogo").select("tmdb_id,tipo,app_id").range(from, from+499);
        if (error) throw error;
        (data||[]).forEach(r => { if (r.tmdb_id) existing.add((r.tipo === "serie" ? "tv" : "movie")+":"+r.tmdb_id); if (r.app_id) existing.add(String(r.app_id)); });
        if (!data || data.length < 500) break;
      }
      while (state.stage < stages.length && state.scanned < target && !bulkImportPause) {
        const stage = stages[state.stage];
        const data = await tmdbRequest("discover/"+stage.type, {page:state.page, sort_by:stage.sort, include_adult:"false", "vote_count.gte":stage.minVotes||0, with_genres:state.genre||undefined});
        const results = data.results || [];
        if (!results.length || state.page > Math.min(Number(data.total_pages)||1, 500)) { state.stage++; state.page=1; continue; }
        const batch=[];
        for (const raw of results) {
          if (state.scanned >= target) break;
          state.scanned++;
          const normalized = normalizeTmdb({...raw, media_type:stage.type});
          if (!normalized) continue;
          const key = stage.type+":"+raw.id;
          if (existing.has(key) || existing.has(normalized.id)) { state.skipped++; continue; }
          existing.add(key); existing.add(normalized.id);
          batch.push(bulkRow(normalized));
        }
        // Insert, never upsert: existing records are not modified by this importer.
        for (let i=0;i<batch.length;i+=50) {
          const chunk=batch.slice(i,i+50);
          const {error} = await supabaseClient.from("catalogo").insert(chunk);
          if (error) {
            // Handle races safely: roll back this batch from the in-memory set and report instead of overwriting.
            throw new Error("Falha ao gravar lote no Supabase: "+error.message+". O progresso anterior foi salvo; você pode retomar.");
          }
          state.inserted += chunk.length;
        }
        state.page++;
        localStorage.setItem(BULK_STATE_KEY, JSON.stringify(state));
        updateBulkProgress(state.scanned,target,`Analisados ${state.scanned}/${target}, adicionados ${state.inserted}, duplicados ignorados ${state.skipped}. Salvando progresso…`);
        await new Promise(resolve => setTimeout(resolve, 180));
      }
      localStorage.setItem(BULK_STATE_KEY, JSON.stringify(state));
      if (bulkImportPause) {
        updateBulkProgress(state.scanned,target,`Pausado: ${state.scanned}/${target} analisados, ${state.inserted} adicionados, ${state.skipped} duplicados ignorados. Progresso salvo neste navegador.`);
        $("#bulkResume").classList.remove("hidden");
      } else {
        localStorage.removeItem(BULK_STATE_KEY);
        updateBulkProgress(state.scanned,target,`Concluído: ${state.inserted} adicionados, ${state.skipped} duplicados ignorados. Nenhum vídeo foi importado.`);
        $("#bulkResume").classList.add("hidden");
        await loadSharedCatalog(); renderCatalog(); renderAdminList(); showToast("Importação do catálogo concluída.");
      }
    } catch(error) {
      console.error("Importação em massa", error);
      const saved = getBulkState() || state; localStorage.setItem(BULK_STATE_KEY, JSON.stringify(saved));
      updateBulkProgress(saved.scanned||0, target, "Erro: "+error.message+" O progresso foi salvo; corrija o problema e toque em Retomar.");
      $("#bulkResume").classList.remove("hidden");
    } finally { bulkImportRunning=false; setBulkButtons(false); }
  }
  function openTmdbSettings() {
    $("#tmdbToken").value = tmdbCredential;
    $("#tmdbAutoLoad").checked = localStorage.getItem(TMDb_AUTO_KEY_SAFE) !== "false";
    openModal("tmdbModal");
  }
  const TMDb_AUTO_KEY_SAFE = TMDB_AUTO_KEY;
  async function connectTmdb() {
    const credential = $("#tmdbToken").value.trim();
    if (!credential) { showToast("Cole primeiro a chave ou o token do TMDB."); return; }
    tmdbCredential = credential;
    try {
      $("#tmdbSave").disabled = true; $("#tmdbSave").textContent = "Testando conexão…";
      await tmdbRequest("configuration");
      localStorage.setItem(TMDB_KEY, tmdbCredential);
      localStorage.setItem(TMDB_AUTO_KEY, $("#tmdbAutoLoad").checked ? "true" : "false");
      closeModal("tmdbModal");
      $("#catalogStatus").textContent = "Conectado ao TMDB. Preparando catálogo online…";
      showToast("TMDB conectado com sucesso.");
      if ($("#tmdbAutoLoad").checked) await loadPopularTitles(true);
      else $("#catalogStatus").textContent = "TMDB conectado. Pesquise um filme ou série pelo campo acima.";
    } catch (error) { tmdbCredential = localStorage.getItem(TMDB_KEY) || TMDB_DEFAULT_API_KEY; showToast(error.message); }
    finally { $("#tmdbSave").disabled = false; $("#tmdbSave").textContent = "Salvar e conectar"; }
  }
  function disconnectTmdb() {
    if (!confirm("Remover a configuração personalizada? A chave padrão do site continuará ativa para todos os aparelhos.")) return;
    localStorage.removeItem(TMDB_KEY); localStorage.removeItem(TMDB_AUTO_KEY);
    tmdbCredential = TMDB_DEFAULT_API_KEY; closeModal("tmdbModal");
    $("#catalogStatus").textContent = "TMDB usa a configuração padrão do site. O catálogo online será carregado automaticamente.";
    $("#loadMoreTitles").classList.remove("hidden"); showToast("Configuração personalizada removida; TMDB padrão mantido.");
    loadPopularTitles(true);
  }
  function openAddTitleSearch() {
    if (!tmdbCredential) { showToast("Conecte o TMDB pelo botão de nuvem antes de pesquisar títulos."); openTmdbSettings(); return; }
    cancelEdit();
    $("#addTitleSearchPanel").classList.remove("hidden");
    $("#tmdbAdminSearch").focus();
    $("#tmdbAdminResults").innerHTML = "";
    $("#tmdbAdminSearchStatus").textContent = "Digite o nome de um filme ou série para pesquisar no TMDB.";
  }
  async function searchTmdbForAdmin() {
    const term = $("#tmdbAdminSearch").value.trim();
    if (term.length < 2) { $("#tmdbAdminSearchStatus").textContent = "Digite pelo menos 2 caracteres."; return; }
    if (!tmdbCredential) { showToast("Conecte o TMDB primeiro."); return; }
    const button = $("#tmdbAdminSearchButton"); button.disabled = true; button.textContent = "Pesquisando…";
    $("#tmdbAdminSearchStatus").textContent = "Consultando filmes e séries no TMDB…";
    try {
      const data = await tmdbRequest("search/multi", {query:term, include_adult:"false", page:1});
      const results = (data.results || []).filter(raw => raw.media_type === "movie" || raw.media_type === "tv").slice(0,12);
      $("#tmdbAdminResults").innerHTML = results.length ? results.map(raw => {
        const item = normalizeTmdb(raw); if (!item) return "";
        const exists = catalog.some(entry => String(entry.tmdbId||"") === String(item.tmdbId) && entry.type === item.type);
        return `<button class="tmdb-admin-result" type="button" data-tmdb-add="${escapeHTML(item.id)}" data-tmdb-title="${escapeHTML(item.title)}"><span class="tmdb-admin-poster">${item.poster ? `<img src="${escapeHTML(item.poster)}" alt="" loading="lazy">` : ""}</span><span class="tmdb-admin-copy"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.type)}, ${escapeHTML(item.year || "ano desconhecido")}</small><small>${escapeHTML(item.genre)}</small>${exists ? '<em>Já cadastrado — será selecionado para edição</em>' : ""}</span><span class="tmdb-admin-plus">${exists ? "Editar" : "Adicionar"}</span></button>`;
      }).join("") : '<p class="form-hint">Nenhum filme ou série encontrado. Tente outro nome.</p>';
      $("#tmdbAdminSearchStatus").textContent = `${results.length} resultado(s). Escolha o título correto.`;
    } catch (error) { $("#tmdbAdminSearchStatus").textContent = error.message; }
    finally { button.disabled = false; button.textContent = "Pesquisar"; }
  }
  async function addTmdbResultToCatalog(id) {
    const item = catalog.find(entry => String(entry.id) === String(id));
    if (item) { $("#addTitleSearchPanel").classList.add("hidden"); startEdit(item); showToast("Esse título já existe. Edite os dados e adicione a URL MP4."); return; }
    const resultId = String(id).match(/^tmdb-(tv|movie)-(\d+)$/);
    if (!resultId) return;
    const type = resultId[1] === "tv" ? "Série" : "Filme";
    const tmdbId = Number(resultId[2]);
    const raw = (await tmdbRequest(`${type === "Série" ? "tv" : "movie"}/${tmdbId}`));
    const genre = Array.isArray(raw.genres) ? raw.genres.map(g=>g.name).join(" • ") : "";
    const title = type === "Série" ? raw.name : raw.title;
    const date = type === "Série" ? raw.first_air_date : raw.release_date;
    const normalized = {id:String(id), title:title||"Sem título", type, genre, year:date?date.slice(0,4):"", description:raw.overview||"Sinopse ainda não disponível.", poster:tmdbImage(raw.poster_path), video:"", color:"#6650a4", seasons:[], tmdbId};
    if (catalog.some(entry => String(entry.tmdbId||"") === String(tmdbId) && entry.type === type)) {
      const existing = catalog.find(entry => String(entry.tmdbId||"") === String(tmdbId) && entry.type === type);
      $("#addTitleSearchPanel").classList.add("hidden"); startEdit(existing); showToast("Este título já está cadastrado. Você pode adicionar a URL MP4 na edição."); return;
    }
    if (adminSession?.user?.id !== ADMIN_UID) { showToast("Entre como administrador para adicionar ao catálogo compartilhado."); return; }
    const button = document.querySelector(`[data-tmdb-add="${CSS.escape(id)}"]`); if (button) { button.disabled = true; }
    const {data:existingRows,error:lookupError} = await supabaseClient.from("catalogo").select("id,app_id").eq("tmdb_id", tmdbId).eq("tipo", type === "Série" ? "serie" : "filme").limit(1);
    if (lookupError) { showToast("Erro ao verificar duplicados: " + lookupError.message); if(button)button.disabled=false; return; }
    if (existingRows?.length) { await loadSharedCatalog(); const found=catalog.find(entry=>String(entry.tmdbId||"")===String(tmdbId)&&entry.type===type); $("#addTitleSearchPanel").classList.add("hidden"); if(found)startEdit(found); showToast("O título já existia no banco. Abra a edição para informar a URL MP4."); return; }
    const {error} = await supabaseClient.from("catalogo").insert(itemToRow(normalized));
    if (error) { showToast("Não foi possível adicionar: " + error.message); if(button)button.disabled=false; return; }
    catalog.unshift(normalized); saveCatalog(); renderCatalog(); renderAdminList();
    $("#addTitleSearchPanel").classList.add("hidden"); startEdit(normalized);
    showToast("Título adicionado. Agora cole a URL direta do MP4 e salve as alterações.");
  }

  function addTitle(event) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    if (!title) { showToast("Informe o título."); return; }
    const poster = safeURL(String(data.get("poster") || "").trim());
    const video = safeURL(String(data.get("video") || "").trim());
    const subtitlesRaw=String(data.get("subtitlesUrl")||"").trim();
    const subtitlesUrl=subtitlesRaw?safeVttURL(subtitlesRaw):"";
    if(subtitlesRaw&&!subtitlesUrl){showToast("A legenda precisa ser uma URL válida de arquivo .vtt (WebVTT).");return;}
    const yearRaw = String(data.get("year") || "").trim();
    const type = data.get("type") === "Série" ? "Série" : "Filme";
    const tmdbIdRaw = String(data.get("tmdbId") || "").trim();
    if (tmdbIdRaw && !/^\d+$/.test(tmdbIdRaw)) { showToast("O ID TMDB deve conter somente números."); return; }
    let seasons = [];
    const seasonsText = String(data.get("seasons") || "").trim();
    if (type === "Série" && seasonsText) {
      try {
        const parsed = JSON.parse(seasonsText);
        if (!Array.isArray(parsed)) throw new Error("O JSON precisa ser uma lista de temporadas.");
        seasons = parsed.map((season,si) => ({
          name: String(season.name || `Temporada ${si+1}`),
          ...(Number(season.seasonNumber) > 0 ? {seasonNumber: Number(season.seasonNumber)} : {}),
          episodes: Array.isArray(season.episodes) ? season.episodes.map((episode,ei) => ({
            title: String(episode.title || `Episódio ${ei+1}`),
            description: String(episode.description || ""),
            video: safeURL(String(episode.video || "")),
            subtitlesUrl: safeVttURL(String(episode.subtitlesUrl || "")),
            ...(Number(episode.tmdbEpisodeId) > 0 ? {tmdbEpisodeId: Number(episode.tmdbEpisodeId)} : {}),
            ...(Number(episode.episodeNumber) > 0 ? {episodeNumber: Number(episode.episodeNumber)} : {}),
            ...(Number(episode.seasonNumber) > 0 ? {seasonNumber: Number(episode.seasonNumber)} : {}),
            ...(safeURL(String(episode.still || "")) ? {still: safeURL(String(episode.still || ""))} : {})
          })) : []
        }));
      } catch (error) { showToast("JSON de temporadas inválido. Confira os colchetes, aspas e vírgulas."); return; }
    }
    const editId=String(data.get("editId")||""); const existing=editId?findItem(editId):null;
    const item = {...(existing || {}), id:existing?existing.id:"local-"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),dbId:existing?.dbId,title,type,genre:String(data.get("genre")||"").trim(),year:/^\d{4}$/.test(yearRaw)?yearRaw:"",description:String(data.get("description")||"").trim(),poster,video,subtitlesUrl,color:existing?.color||["#6650a4","#287b91","#a35b65","#9a713f","#3d6b77","#9b6599"][catalog.length%6],seasons,tmdbId:tmdbIdRaw || existing?.tmdbId || undefined};
    if (existing) catalog=catalog.map(entry=>entry.id===existing.id?item:entry); else catalog.unshift(item);
    if (saveCatalog()) {
      cancelEdit(); renderCatalog(); renderAdminList();
      if (adminSession?.user?.id === ADMIN_UID) {
        saveItemToCloud(item).then(ok => { if (ok) showToast(existing?"Alterações salvas no catálogo compartilhado.":"Título salvo no catálogo compartilhado."); });
      } else showToast(existing?"Título editado apenas neste navegador. Entre como administrador para sincronizar.":"Título salvo apenas neste navegador. Entre como administrador para sincronizar.");
    }
  }
  function exportCatalog() {
    const blob = new Blob([JSON.stringify(catalog,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href=url; a.download="lumiplay-catalogo.json"; a.click(); URL.revokeObjectURL(url);
    showToast("Exportação iniciada.");
  }


  // TV ao Vivo: cache local + sincronização compartilhada pelo Supabase.
  const TV_CHANNELS_KEY = "lumiplay.tv-channels.v1";
  let tvChannels = safeParse(localStorage.getItem(TV_CHANNELS_KEY) || "[]", []);
  if (!Array.isArray(tvChannels)) tvChannels = [];
  let tvCloudReady = false;
  let tvCloudLoadPromise = null;
  let editingTvId = null;
  function saveTvChannelsLocal() {
    try { localStorage.setItem(TV_CHANNELS_KEY, JSON.stringify(tvChannels)); } catch (e) { console.warn("Não foi possível salvar o cache local dos canais", e); }
  }
  async function saveTvChannels(options = {}) {
    saveTvChannelsLocal();
    renderTvChannels();
    if (options.cloud === false) return true;
    if (!supabaseClient) { showToast("Canais salvos apenas neste aparelho: Supabase indisponível."); return false; }
    if (adminSession?.user?.id !== ADMIN_UID) { showToast("Entre como administrador para sincronizar canais com a TV."); return false; }
    if (!tvCloudReady) {
      const loaded = await loadTvChannelsFromCloud();
      if (!loaded) { showToast("Não foi possível confirmar a lista de canais no banco. Nada foi alterado lá."); return false; }
    }
    const rows = tvChannels.map(c => ({ id: String(c.id), name: String(c.name), category: String(c.category || "Outros"), url: String(c.url), logo: String(c.logo || ""), updated_at: new Date().toISOString() }));
    if (rows.length) {
      const { error } = await supabaseClient.from("tv_channels").upsert(rows, { onConflict: "id" });
      if (error) { console.error("Falha ao sincronizar canais", error); showToast("Falha ao sincronizar canais: " + error.message); return false; }
    }
    // Só depois de gravar com sucesso removemos do banco os canais que não existem mais.
    const keepIds = rows.map(row => `"${row.id.replace(/"/g, "")}"`).join(",");
    const cleanup = supabaseClient.from("tv_channels").delete();
    const { error: deleteError } = keepIds ? await cleanup.not("id", "in", `(${keepIds})`) : await cleanup.neq("id", "__never_match__");
    if (deleteError) { console.warn("Canais antigos não puderam ser removidos do banco", deleteError); showToast("Canais salvos, mas não foi possível remover os excluídos: " + deleteError.message); return false; }
    tvCloudReady = true;
    showToast("Canais sincronizados. Eles já podem aparecer na TV após atualizar.");
    return true;
  }
  async function loadTvChannelsFromCloud() {
    if (tvCloudReady) return true;
    if (tvCloudLoadPromise) return tvCloudLoadPromise;
    tvCloudLoadPromise = (async () => {
      if (!supabaseClient) return false;
      const { data, error } = await supabaseClient.from("tv_channels").select("id,name,category,url,logo,updated_at").order("name", { ascending: true });
      if (error) {
        console.warn("Canais compartilhados não carregaram", error);
        const note = error.code === "42P01" || error.code === "PGRST205" ? " Execute o arquivo database/supabase-tv-channels.sql no SQL Editor do Supabase." : error.message;
        if (tvChannels.length) showToast("TV ao Vivo ainda está local neste aparelho." + note);
        return false;
      }
      const remote = (data || []).map(c => ({ id: String(c.id), name: String(c.name || ""), category: String(c.category || "Outros"), url: normalizeEmbedInput(c.url), logo: String(c.logo || "") })).filter(c => c.name && validHttpsUrl(c.url));
      // Preserve channels already stored on the admin device so they can be migrated to the shared table.
      const byUrl = new Map(remote.map(c => [c.url, c]));
      for (const c of tvChannels) if (c?.name && validHttpsUrl(c.url) && !byUrl.has(c.url)) byUrl.set(c.url, c);
      const hadLocalOnly = byUrl.size > remote.length;
      tvChannels = [...byUrl.values()];
      saveTvChannelsLocal(); renderTvChannels(); tvCloudReady = true;
      if (hadLocalOnly && adminSession?.user?.id === ADMIN_UID) await saveTvChannels();
      return true;
    })();
    try { return await tvCloudLoadPromise; } finally { tvCloudLoadPromise = null; }
  }
  function normalizeEmbedInput(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    // Aceita tanto URL direta quanto o iframe copiado do site de embeds.
    if (/<iframe\b/i.test(raw)) {
      const srcMatch = raw.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
      if (!srcMatch) return "";
      try { return new URL(srcMatch[2], location.href).href; } catch (_) { return ""; }
    }
    return raw;
  }
  function validHttpsUrl(value) { try { const u = new URL(String(value || "")); return u.protocol === "https:" && !!u.hostname; } catch (_) { return false; } }
  function showTvSection() { navigate("tv"); }
  function renderTvChannels() {
    const grid=$("#tvChannelGrid"); if(!grid) return;
    const query=($("#tvSearch")?.value||"").trim().toLocaleLowerCase("pt-BR");
    const chosen=$("#tvCategory")?.value||"Tudo";
    const cats=[...new Set(tvChannels.map(c=>String(c.category||"Outros")).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    const select=$("#tvCategory"); if(select){ const prior=chosen; select.innerHTML='<option value="Tudo">Todas</option>'+cats.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join(""); select.value=cats.includes(prior)?prior:"Tudo"; }
    const filtered=tvChannels.filter(c=>(chosen==="Tudo"||String(c.category||"Outros")===chosen)&&(!query||`${c.name} ${c.category||""}`.toLocaleLowerCase("pt-BR").includes(query)));
    grid.innerHTML = filtered.map(c => `<button class="tv-card" type="button" data-tv-play="${escapeHTML(c.id)}"><span class="tv-card-logo${validHttpsUrl(c.logo) ? " has-img" : ""}">${validHttpsUrl(c.logo) ? `<img src="${escapeHTML(c.logo)}" alt="" loading="lazy" decoding="async">` : ""}<span class="tv-card-fallback">${escapeHTML((c.name || "TV").slice(0, 22))}</span></span><span class="tv-card-copy"><span class="live-tag"><i></i>Ao vivo</span><strong>${escapeHTML(c.name)}</strong><small>${escapeHTML(c.category || "Outros")}</small></span></button>`).join("");
    $("#tvEmpty").classList.toggle("hidden",filtered.length>0);
  }
  function openTvChannel(id) {
    const c=tvChannels.find(item=>String(item.id)===String(id)); if(!c)return;
    if(!validHttpsUrl(c.url)){showToast("URL inválida. Use um endereço HTTPS autorizado.");return;}
    setFrame($("#tvEmbedFrame"), c.url); $("#tvPlayerTitle").textContent=c.name; $("#tvPlayerNote").textContent=`${c.category||"Outros"}. Transmissão externa: se não carregar, o provedor pode bloquear a incorporação.`;
    openModal("tvPlayer");
  }
  function openTvForm() { editingTvId=null; $("#tvChannelForm").reset(); $("#tvModalTitle").textContent="Adicionar canal"; openModal("tvChannel"); }
  async function exportTvJson() { if (adminSession?.user?.id !== ADMIN_UID) { showToast("Entre como administrador para exportar os canais."); return; } await loadTvChannelsFromCloud(); const blob=new Blob([JSON.stringify(tvChannels,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="lumiplay-canais-tv.json"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); showToast("Exportação dos canais iniciada."); }
  function importTvJson(file) {
    if(!file)return;
    if (adminSession?.user?.id !== ADMIN_UID) { showToast("Entre como administrador para importar canais."); return; }
    const reader=new FileReader(); reader.onload=async()=>{try{const data=JSON.parse(reader.result);if(!Array.isArray(data))throw new Error("O JSON deve conter uma lista de canais.");const valid=data.map(c=>({id:String(c.id||crypto.randomUUID()),name:String(c.name||c.nome||"").trim(),category:String(c.category||c.categoria||"Outros").trim()||"Outros",url:normalizeEmbedInput(c.url||c.embed||c.embed_url||""),logo:String(c.logo||c.logo_url||"").trim()})).filter(c=>c.name&&validHttpsUrl(c.url));if(!valid.length)throw new Error("Nenhum canal válido. Cada item precisa de name e URL HTTPS em url/embed.");const byUrl=new Map(tvChannels.map(c=>[c.url,c]));valid.forEach(c=>byUrl.set(c.url,c));tvChannels=[...byUrl.values()];await saveTvChannels();showToast(`${valid.length} canal(is) importado(s).`);}catch(e){showToast("Falha na importação: "+e.message);}};reader.readAsText(file);
  }

  document.addEventListener("click", event => {
    const navButton = event.target.closest("[data-nav]");
    if (navButton) { event.preventDefault(); navigate(navButton.dataset.nav); return; }
    const tvCard = event.target.closest("[data-tv-play]"); if (tvCard) openTvChannel(tvCard.dataset.tvPlay);
    const favButton = event.target.closest("[data-fav]");
    if (favButton) { event.preventDefault(); toggleFavorite(favButton.dataset.fav); return; }
    const openButton = event.target.closest("[data-open]");
    if (openButton) { openDetails(findItem(openButton.dataset.open)); return; }
    const suggestion = event.target.closest("[data-suggest]");
    if (suggestion) { closeSuggestions(); openDetails(findItem(suggestion.dataset.suggest)); return; }
    const genreJump = event.target.closest("[data-genre-jump]");
    if (genreJump) { openGenre(genreJump.dataset.genreJump); return; }
    const heroThumb = event.target.closest("[data-hero-index]");
    if (heroThumb) { setFeaturedIndex(Number(heroThumb.dataset.heroIndex)); return; }
    const closeButton = event.target.closest("[data-close]");
    if (closeButton) closeModal(closeButton.dataset.close);
    const editButton = event.target.closest("[data-edit]");
    if (editButton) startEdit(findItem(editButton.dataset.edit));
    const preserveBox = event.target.closest("[data-preserve]");
    if (preserveBox) { if (preserveBox.checked) preservedIds.add(String(preserveBox.dataset.preserve)); else preservedIds.delete(String(preserveBox.dataset.preserve)); const allBox=$("#preserveSelectAll"); if(allBox) allBox.checked=catalog.length>0&&catalog.every(item=>preservedIds.has(String(item.id))); }
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      const item = findItem(deleteButton.dataset.delete);
      if (item && confirm(`Excluir "${item.title}" do catálogo compartilhado?`)) {
        if (adminSession?.user?.id !== ADMIN_UID) { showToast("Entre como administrador para excluir títulos do catálogo compartilhado."); return; }
        deleteButton.disabled = true; deleteButton.textContent = "Excluindo…";
        deleteItemFromCloud(item).then(ok => {
          if (!ok) { deleteButton.disabled = false; deleteButton.textContent = "Excluir"; return; }
          catalog = catalog.filter(entry => String(entry.id) !== String(item.id));
          favorites = favorites.filter(id => String(id) !== String(item.id));
          Object.keys(progress).filter(key => key.startsWith(String(item.id))).forEach(key => delete progress[key]);
          preservedIds.delete(String(item.id));
          saveCatalog(); saveFavorites(); saveProgress(); renderCatalog(); renderAdminList();
          showToast("Título excluído do catálogo compartilhado.");
        }).catch(error => { console.error(error); deleteButton.disabled = false; deleteButton.textContent = "Excluir"; showToast("Não foi possível excluir: " + error.message); });
      }
    }
    const episodeButton = event.target.closest("[data-episode]");
    if (episodeButton) {
      const item = findItem(selectedItemId);
      const season = item?.seasons?.[Number(episodeButton.dataset.season)];
      const episode = season?.episodes?.[Number(episodeButton.dataset.episode)];
      if (item && episode) playItem(item, episode, Number(episodeButton.dataset.season), Number(episodeButton.dataset.episode));
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      const open = [...document.querySelectorAll(".modal:not(.hidden)")];
      if (open.length) { event.preventDefault(); closeModal(open[open.length - 1].id); } // fecha só a janela de cima
      else if (!$("#searchSuggestions").classList.contains("hidden")) closeSuggestions();
    }
  });
  $("#searchInput").addEventListener("input", () => {
    syncBrowseMode();
    clearTimeout(localSearchTimer);
    localSearchTimer = setTimeout(() => {
      renderSearchSuggestions();
      renderCatalog();
    }, LOW_POWER_DEVICE ? 180 : 70);
    clearTimeout(searchTimer);
    const term = $("#searchInput").value.trim();
    if (tmdbCredential && term.length >= 2) searchTimer = setTimeout(() => searchTmdb(term), 450);
    else if (!term && tmdbCredential) $("#catalogStatus").textContent = "Catálogo online conectado. Pesquise para encontrar mais títulos.";
  });
  $("#searchInput").addEventListener("keydown", event => { if (event.key === "Enter") { saveRecentSearch($("#searchInput").value); closeSuggestions(); renderCatalog(); } });
  $("#recentSearchChips")?.addEventListener("click", event => {
    const button = event.target.closest("[data-recent-search]");
    if (!button) return;
    const term = button.dataset.recentSearch || "";
    $("#searchInput").value = term;
    favoritesOnly = false;
    syncBrowseMode();
    closeSuggestions();
    renderCatalog();
    if (tmdbCredential && term.length >= 2) searchTmdb(term);
  });
  $("#clearRecentSearches")?.addEventListener("click", () => {
    recentSearches = [];
    try { localStorage.removeItem(profileStorageKey(RECENT_SEARCHES_KEY)); } catch (_) {}
    renderRecentSearches();
    showToast("Pesquisas recentes apagadas.");
  });
  $("#favoritesOnlyFilter")?.addEventListener("click", () => {
    favoritesOnly = !favoritesOnly;
    syncBrowseMode();
    renderCatalog();
  });
  $("#genreFilter").addEventListener("change", renderCatalog);
  $("#showMoreCatalog")?.addEventListener("click", () => { catalogVisibleLimit += CATALOG_BATCH_SIZE; renderCatalog(false); });
  $("#bulkStart")?.addEventListener("click", () => runBulkImport(false));
  $("#bulkPause")?.addEventListener("click", () => { bulkImportPause = true; $("#bulkPause").disabled = true; });
  $("#bulkResume")?.addEventListener("click", () => runBulkImport(true));
  persistProfiles(); renderProfiles();
  const savedBulkState = getBulkState();
  if (savedBulkState) { $("#bulkResume")?.classList.remove("hidden"); updateBulkProgress(savedBulkState.scanned||0, savedBulkState.target||1000, `Importação interrompida: ${savedBulkState.scanned||0}/${savedBulkState.target||1000} analisados. Toque em Retomar para continuar.`); }
  const openProfiles = () => { renderProfiles(); openModal("profiles"); };
  $("#profilesOpen")?.addEventListener("click", openProfiles);
  $("#profileForm")?.addEventListener("submit", event => {
    event.preventDefault(); const name=$("#profileName").value.trim(); if(!name) return;
    if(profiles.length>=5) { showToast("O limite é de 5 perfis neste dispositivo."); return; }
    if(profiles.some(p=>p.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR"))) { showToast("Já existe um perfil com esse nome."); return; }
    const id="p-"+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)); profiles.push({id,name,createdAt:Date.now()}); persistProfiles(); $("#profileName").value=""; renderProfiles(); switchProfile(id);
  });
  $("#profileList")?.addEventListener("click", event => {
    const sw=event.target.closest("[data-profile-switch]"); if(sw) { switchProfile(sw.dataset.profileSwitch); return; }
    const rename=event.target.closest("[data-profile-rename]"); if(rename) { renameProfile(rename.dataset.profileRename); return; }
    const del=event.target.closest("[data-profile-delete]"); if(!del) return;
    const profile=profiles.find(p=>p.id===del.dataset.profileDelete); if(!profile||!confirm(`Excluir o perfil local “${profile.name}” e seus dados deste navegador?`)) return;
    [FAVORITES_KEY,PROGRESS_KEY,WATCH_HISTORY_KEY,RECENT_SEARCHES_KEY].forEach(key=>localStorage.removeItem(profileStorageKey(key,profile.id)));
    profiles=profiles.filter(p=>p.id!==profile.id); if(activeProfileId===profile.id) activeProfileId="main"; persistProfiles();
    if(activeProfileId==="main") { favorites=safeParse(localStorage.getItem(FAVORITES_KEY)||"[]",[]); progress=safeParse(localStorage.getItem(PROGRESS_KEY)||"{}",{}); watchHistory=safeParse(localStorage.getItem(WATCH_HISTORY_KEY)||"[]",[]); recentSearches=safeParse(localStorage.getItem(RECENT_SEARCHES_KEY)||"[]",[]); }
    renderProfiles(); renderCatalog(); renderWatchHistory(); renderMyList();
  });
  $("#playbackSpeed")?.addEventListener("change", event => { const video=$("#videoPlayer"); if(video) video.playbackRate=Number(event.target.value)||1; });
  $("#seekBackButton")?.addEventListener("click",()=>{const video=$("#videoPlayer");if(video&&Number.isFinite(video.duration))video.currentTime=Math.max(0,video.currentTime-10);});
  $("#seekForwardButton")?.addEventListener("click",()=>{const video=$("#videoPlayer");if(video&&Number.isFinite(video.duration))video.currentTime=Math.min(video.duration,video.currentTime+10);});
  $("#captionsButton")?.addEventListener("click",()=>{const video=$("#videoPlayer"),track=video?.querySelector("track[data-lumiplay-subtitle]");if(!track?.track){showToast("Este vídeo não tem legenda WebVTT cadastrada.");return;}const showing=track.track.mode==="showing";track.track.mode=showing?"disabled":"showing";const button=$("#captionsButton");button.setAttribute("aria-pressed",String(!showing));setButton(button,null,showing?"Legendas desativadas":"Legendas ativadas");});
  $("#pipButton")?.addEventListener("click", async () => {
    const video=$("#videoPlayer");
    try { if(document.pictureInPictureElement) await document.exitPictureInPicture(); else if(video?.requestPictureInPicture) await video.requestPictureInPicture(); else showToast("Mini player não é compatível com este navegador ou fonte."); }
    catch(error) { showToast("Não foi possível abrir o mini player: "+(error.message||"recurso indisponível")); }
  });
  $("#detailsShare")?.addEventListener("click", async () => {
    const item = findItem(selectedItemId); if (!item) return;
    // Link direto para o título (a página abre já nos detalhes dele).
    const shareUrl = location.origin + location.pathname + detailsRoute(item);
    const text = `${item.title} (${item.year || "ano não informado"}), ${item.type}. Descubra no LumiPlay: ${shareUrl}`;
    try { if (navigator.share) await navigator.share({title:item.title,text,url:shareUrl}); else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); showToast("Link e informações do título copiados."); } else { showToast("Compartilhamento não suportado neste navegador."); } }
    catch(error) { if(error?.name!=="AbortError") showToast("Não foi possível compartilhar neste navegador."); }
  });
  $("#accountOpen")?.addEventListener("click", async () => { openModal("account"); await refreshAccountState(); });
  $("#accountForm")?.addEventListener("submit", accountLogin);
  $("#accountSignup")?.addEventListener("click", accountSignup);
  $("#accountSyncNow")?.addEventListener("click", () => syncUserState(true));
  $("#accountLogout")?.addEventListener("click", async () => { clearTimeout(userSyncTimer); if(userSupabaseClient) await userSupabaseClient.auth.signOut(); userSession=null; await refreshAccountState(); setAccountStatus("Você saiu da conta. Os dados ficam guardados neste navegador e serão separados da próxima conta conectada."); showToast("Sessão encerrada."); });
  $("#tmdbOpen").addEventListener("click", openTmdbSettings);
  $("#tmdbSave").addEventListener("click", connectTmdb);
  $("#tmdbDisconnect").addEventListener("click", disconnectTmdb);
  $("#loadMoreTitles").addEventListener("click", () => loadPopularTitles(false));
  $("#sortFilter")?.addEventListener("change", renderCatalog);
  $("#clearFilters")?.addEventListener("click", clearAllFilters);
  $("#emptyClearFilters")?.addEventListener("click", clearAllFilters);
  $("#adminOpen").addEventListener("click", openAdmin);
  $("#resetCatalog").addEventListener("click", () => {
    if (adminSession?.user?.id !== ADMIN_UID) { showToast("Entre como administrador para limpar o cache local."); return; }
    if (!confirm("Limpar o cache local do catálogo neste navegador? Os títulos do banco compartilhado e a sua lista não serão apagados; o catálogo será recarregado.")) return;
    catalog = []; saveCatalog(); renderCatalog(); renderAdminList();
    loadSharedCatalog();
    if (tmdbCredential) loadPopularTitles(true);
    showToast("Cache local limpo. Recarregando o catálogo…");
  });
  $("#heroPlay").addEventListener("click", () => {
    if (featuredItem) playItem(featuredItem);
    else $("#catalogSection").scrollIntoView({behavior: LOW_POWER_DEVICE || REDUCED_MOTION ? "auto" : "smooth", block: "start"});
  });
  $("#heroDetails")?.addEventListener("click", () => { if (featuredItem) openDetails(featuredItem); });
  $("#heroFavorite")?.addEventListener("click", () => { if (featuredItem) toggleFavorite(featuredItem.id); });
  $("#heroPrevious")?.addEventListener("click", () => setFeaturedIndex(featuredIndex - 1));
  $("#heroNext")?.addEventListener("click", () => setFeaturedIndex(featuredIndex + 1));
  // O destaque pausa enquanto a pessoa aponta ou navega por ele.
  const heroElement = $("#hero");
  heroElement.addEventListener("mouseenter", () => { heroPaused = true; restartFeaturedRotation(); });
  heroElement.addEventListener("mouseleave", () => { heroPaused = false; restartFeaturedRotation(); });
  heroElement.addEventListener("focusin", () => { heroPaused = true; restartFeaturedRotation(); });
  heroElement.addEventListener("focusout", event => { if (heroElement.contains(event.relatedTarget)) return; heroPaused = false; restartFeaturedRotation(); });
  document.addEventListener("visibilitychange", () => restartFeaturedRotation());
  $("#heroInfo").addEventListener("click", () => openModal("info"));
  $("#infoOpen")?.addEventListener("click", () => openModal("info"));
  $("#randomPick")?.addEventListener("click", pickRandomTitle);
  $("#detailsTrailer")?.addEventListener("click", playTrailer);
  $("#playerNext")?.addEventListener("click", playNextEpisode);
  $("#playerFullscreen")?.addEventListener("click", togglePlayerFullscreen);
  $("#searchClear")?.addEventListener("click", () => {
    const input = $("#searchInput");
    if (!input.value) return;
    input.value = "";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    input.focus();
  });
  $("#searchInput").addEventListener("focus", renderSearchSuggestions);
  // Manter o foco no campo ao tocar numa sugestão (sem isso o campo perde o foco antes do clique).
  $("#searchSuggestions")?.addEventListener("mousedown", event => event.preventDefault());
  document.addEventListener("click", event => { if (!event.target.closest("#searchWrap")) closeSuggestions(); });
  // Carrega o próximo lote sozinho ao chegar perto do fim da grade (em TVs fica manual, por desempenho).
  if (!LOW_POWER_DEVICE && "IntersectionObserver" in window) {
    const moreButton = $("#showMoreCatalog");
    new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !moreButton.classList.contains("hidden") && browsing()) moreButton.click();
    }, {rootMargin: "700px 0px"}).observe(moreButton);
  }
  $("#historySearch")?.addEventListener("input", renderWatchHistory);
  document.querySelectorAll("[data-history-filter]").forEach(button => button.addEventListener("click", () => {
    historyFilter = button.dataset.historyFilter;
    document.querySelectorAll("[data-history-filter]").forEach(b => b.classList.toggle("active", b === button));
    renderWatchHistory();
  }));
  $("#clearWatchHistory")?.addEventListener("click", () => {
    if (!confirm("Limpar o histórico de filmes e séries assistidos neste navegador?")) return;
    watchHistory = []; saveWatchHistory(); renderWatchHistory(); showToast("Histórico limpo.");
  });
  $("#detailsSimilar").addEventListener("click", event => {
    const card = event.target.closest("[data-related-id]");
    if (!card) return;
    const related = findItem(card.dataset.relatedId);
    if (related) openDetails(related);
  });
  $("#detailsPlay").addEventListener("click", () => playItem(findItem(selectedItemId)));
  $("#retryPlayback")?.addEventListener("click", () => { if(lastPlayback) playItem(lastPlayback.item,lastPlayback.episode,lastPlayback.seasonIndex,lastPlayback.episodeIndex); });
  $("#retryPlayerButton")?.addEventListener("click", () => { if(lastPlayback) playItem(lastPlayback.item,lastPlayback.episode,lastPlayback.seasonIndex,lastPlayback.episodeIndex); });
  $("#detailsFavorite").addEventListener("click", () => { if (selectedItemId) toggleFavorite(selectedItemId); });
  $("#seasonSelect").addEventListener("change", () => {
    const item=findItem(selectedItemId); if (!item) return;
    const seasonIndex = Number($("#seasonSelect").value);
    if (item.seasons?.[seasonIndex]?.episodes?.length) renderEpisodes(item, seasonIndex);
    else loadSeasonEpisodes(item, seasonIndex).catch(error => {
      console.warn("Falha ao carregar temporada", error);
      if (selectedItemId === item.id && Number($("#seasonSelect").value) === seasonIndex) $("#episodeList").innerHTML = `<p class="form-hint">${escapeHTML(error.message || "Não foi possível carregar esta temporada.")}</p><button class="button button-ghost" type="button" data-retry-season="${seasonIndex}">Tentar novamente</button>`;
    });
  });
  $("#episodeList").addEventListener("click", event => {
    const retry = event.target.closest("[data-retry-season]");
    if (!retry) return;
    const item = findItem(selectedItemId); if (!item) return;
    if (retry.dataset.retrySeason === "metadata") loadSeriesEpisodes(item).catch(error => { if (selectedItemId === item.id) $("#episodeList").innerHTML = `<p class="form-hint">${escapeHTML(error.message || "Falha ao carregar temporadas.")}</p><button class="button button-ghost" type="button" data-retry-season="metadata">Tentar novamente</button>`; });
    else loadSeasonEpisodes(item, Number(retry.dataset.retrySeason)).catch(error => { if (selectedItemId === item.id) $("#episodeList").innerHTML = `<p class="form-hint">${escapeHTML(error.message || "Falha ao carregar episódios.")}</p><button class="button button-ghost" type="button" data-retry-season="${retry.dataset.retrySeason}">Tentar novamente</button>`; });
  });
  $("#addSeasonButton")?.addEventListener("click", () => addSeasonCard());
  $("#syncSeasonsButton")?.addEventListener("click", () => { syncSeasonBuilder(); showToast("Temporadas e episódios atualizados."); });
  window.addEventListener("pagehide",()=>{const video=$("#videoPlayer");if(video&&video.currentTime>0&&Number.isFinite(video.duration)&&video.duration>0&&lastPlayback){const item=lastPlayback.item,episode=lastPlayback.episode,seasonIndex=lastPlayback.seasonIndex,episodeIndex=lastPlayback.episodeIndex;const key=episode?`${item.id}:s${Number(episode.seasonNumber??(seasonIndex!==null?Number(seasonIndex)+1:1))}:e${Number(episode.episodeNumber??(episodeIndex!==null?Number(episodeIndex)+1:1))}`:item.id;progress[key]={...(progress[key]||{}),time:video.currentTime,duration:video.duration,title:item.title,episode:episode?.title||"",updated:Date.now()};saveProgress();}});
  $("#titleForm").addEventListener("submit", addTitle);
  $("#adminAddTitle").addEventListener("click", openAddTitleSearch);
  $("#tmdbAdminSearchButton").addEventListener("click", searchTmdbForAdmin);
  $("#tmdbAdminSearch").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); searchTmdbForAdmin(); } });
  $("#tmdbAdminResults").addEventListener("click", event => { const result=event.target.closest("[data-tmdb-add]"); if(result) addTmdbResultToCatalog(result.dataset.tmdbAdd).catch(error=>{console.error(error);showToast("Erro ao adicionar título: "+error.message);}); });
  $("#cancelTmdbAdminSearch").addEventListener("click", () => $("#addTitleSearchPanel").classList.add("hidden"));
  $("#cancelEdit").addEventListener("click", cancelEdit);
  $("#deleteExceptPreserved").addEventListener("click", deleteAllExceptPreserved);
  $("#adminCatalogSearch")?.addEventListener("input", renderAdminList);
  $("#adminCatalogType")?.addEventListener("change", renderAdminList);
  $("#adminCatalogSort")?.addEventListener("change", renderAdminList);
  $("#preserveSelectAll").addEventListener("change", event => { preservedIds.clear(); if(event.target.checked) catalog.forEach(item=>preservedIds.add(String(item.id))); renderAdminList(); });
  document.querySelectorAll("#ratingInput [data-rating]").forEach(button=>button.addEventListener("click",()=>{currentRating=Number(button.dataset.rating);renderRatingStars();}));
  $("#commentForm").addEventListener("submit", saveTitleFeedback);
  $("#commentsList").addEventListener("click", event => { const button = event.target.closest("[data-feedback-id]"); if (button) reportCommunityComment(button); });
  $("#adminLogin").addEventListener("click", loginAdmin);
  $("#adminLogout").addEventListener("click", async () => { if (supabaseClient) await supabaseClient.auth.signOut(); adminSession = null; await refreshAdminState(); setBackendStatus("Você saiu do painel administrativo."); showToast("Sessão encerrada."); });
  $("#refreshReports")?.addEventListener("click", loadModerationReports);
  $("#refreshAuditLog")?.addEventListener("click", loadAdminAuditLog);
  $("#reportStatusFilter")?.addEventListener("change", loadModerationReports);
  $("#moderationReports")?.addEventListener("click", event => {
    const review = event.target.closest("[data-report-review]");
    const remove = event.target.closest("[data-feedback-remove]");
    if (review) reviewCommunityReport(review);
    if (remove) removeReportedComment(remove);
  });
  $("#exportCatalog").addEventListener("click", exportCatalog);
  $("#addTvChannel")?.addEventListener("click", openTvForm);
  $("#tvSearch")?.addEventListener("input", renderTvChannels);
  $("#tvCategory")?.addEventListener("change", renderTvChannels);
  $("#exportTvChannels")?.addEventListener("click", exportTvJson);
  $("#tvFullscreenButton")?.addEventListener("click", async () => { const wrap=$(".tv-embed-wrap"); const frame=$("#tvEmbedFrame"); try { if(document.fullscreenElement){ await document.exitFullscreen(); } else if(wrap?.requestFullscreen){ await wrap.requestFullscreen(); } else { window.open(frame.src, "_blank", "noopener"); } } catch (_) { window.open(frame.src, "_blank", "noopener"); } });
  $("#importTvChannels")?.addEventListener("click",()=>$("#tvImportFile").click());
  $("#tvImportFile")?.addEventListener("change",event=>{importTvJson(event.target.files?.[0]);event.target.value="";});
  $("#tvChannelForm")?.addEventListener("submit",async event=>{event.preventDefault();const name=$("#tvName").value.trim(),category=$("#tvGenre").value.trim()||"Outros",url=normalizeEmbedInput($("#tvUrl").value),logo=$("#tvLogo").value.trim();if(adminSession?.user?.id!==ADMIN_UID){showToast("Entre como administrador para cadastrar canais compartilhados.");return;}if(!name||!validHttpsUrl(url)||(logo&&!validHttpsUrl(logo))){showToast("Informe o nome e uma URL HTTPS válida ou cole o iframe completo.");return;}const existing=tvChannels.find(c=>c.url===url);if(existing){showToast("Este endereço já está cadastrado.");return;}tvChannels.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),name,category,url,logo});const ok=await saveTvChannels();if(ok){closeModal("tvChannel");} });
  $("#year").textContent=new Date().getFullYear();
  // Sem catálogo após alguns segundos, a grade de carregamento dá lugar à mensagem de vazio.
  window.setTimeout(endCatalogLoading, 7000);
  const initialRoute = viewFromHash(location.hash);
  if (initialRoute.title) applyRoute(location.hash, {initial: true});
  else navigate(initialRoute.view || "home", {updateRoute: false, scroll: false});
  // Inicia o fallback em paralelo à descoberta online; ele só entra se o catálogo continuar vazio.
  loadBundledCatalogFallback();
  if (!catalog.length && !tmdbCredential) {
    const status = $("#catalogStatus");
    if (status) status.textContent = "Sua biblioteca ainda está vazia. Conecte o TMDB para descobrir títulos ou adicione conteúdos licenciados pelo painel administrativo.";
  }
  // Renderiza o cache local dos canais; os dados compartilhados são buscados ao abrir TV ao Vivo.
  renderTvChannels();
  // Os serviços de nuvem serão iniciados em segundo plano após a interface local.
  if (tmdbCredential) {
    const loadButton = $("#loadMoreTitles");
    loadButton.classList.remove("hidden");
    $("#catalogStatus").textContent = "Conectado ao TMDB. Carregando títulos populares…";
    window.setTimeout(() => { if (!document.hidden) loadPopularTitles(true); }, LOW_POWER_DEVICE ? 1500 : 900);
  }
  const startCloudLoad = () => loadSupabaseInBackground();
  window.setTimeout(startCloudLoad, LOW_POWER_DEVICE ? 1800 : 350);
})();