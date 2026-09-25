import { icon, hydrateIcons, escapeHtml, safeUrl, fmt, apiFetch, store, avatar } from "/ui.js";

hydrateIcons();

// ---------------------------------------------------------------------------
// Éléments de la page
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const tabs = { search: el("tab-search"), companies: el("tab-companies") };
const form = el("search-form");
const input = el("query");
const searchBtn = el("search-btn");
const statusEl = el("status");
const resultsEl = el("results");
const toolbar = el("results-toolbar");
const resultsCount = el("results-count");
const resultsContext = el("results-context");
const exportBtn = el("export-btn");
const filtersEl = el("filters");
const filterLevel = el("filter-level");
const filterContract = el("filter-contract");
const sortBy = el("sort-by");
const hideIgnored = el("hide-ignored");
const resetFilters = el("reset-filters");
const companyBanner = el("company-banner");
const moreLinks = el("more-links");
const heroStats = el("hero-stats");
const crawlBanner = el("crawl-banner");
const crawlLabel = el("crawl-label");
const crawlBar = el("crawl-bar");
const companyCount = el("company-count");
const alertToggle = el("alert-toggle");
const alertPanel = el("alert-panel");
const alertSubject = el("alert-subject");
const alertPush = el("alert-push");
const pushHint = el("push-hint");
const pushChannel = el("push-channel");
const emailToggle = el("alert-email-toggle");
const alertEmail = el("alert-email");
const emailHint = el("email-hint");
const emailChannel = el("email-channel");
const alertCreateBtn = el("alert-create-btn");
const alertFeedback = el("alert-feedback");
const bellBtn = el("bell-btn");
const bellBadge = el("bell-badge");
const drawer = el("drawer");
const alertsList = el("alerts-list");
const channelsEl = el("channels");
const howtoIntro = el("howto-intro");
const featuredEl = el("featured-companies");
const companyFilter = el("company-filter");

const DEFAULT_PLACEHOLDER = input.placeholder;

const state = {
  // Capacités du serveur (canaux d'alerte disponibles), cf. /api/config.
  config: { emailEnabled: false, pushEnabled: false, vapidPublicKey: null, alertsCheckMinutes: 30 },
  query: "",
  company: "",
  profile: null,
  allJobs: [],
  viewJobs: [],
  newUrls: new Set(),
  searchKey: null, // recherche affichée (évite de la relancer au retour sur l'onglet)
  searchUrl: "/", // dernière URL de l'onglet Offres
  searchSeq: 0, // numéro de requête : les réponses obsolètes sont ignorées
  featured: null,
  featuredAt: 0,
};

const configReady = apiFetch("/api/config")
  .then((c) => Object.assign(state.config, c))
  .catch(() => {});

// --- Service worker (PWA : installation, hors ligne, notifications) ---
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ---------------------------------------------------------------------------
// Utilitaires d'affichage
// ---------------------------------------------------------------------------
const normalize = (s = "") => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const plural = (n, word, many = `${word}s`) => `${n} ${n > 1 ? many : word}`;

function searchHref({ q = "", company = "" } = {}) {
  const p = new URLSearchParams();
  if (company) p.set("company", company);
  if (q) p.set("q", q);
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

function alertLabel(a) {
  if (a.company && a.query) return `« ${a.query} » chez ${a.company}`;
  if (a.company) return `les offres de ${a.company}`;
  return `« ${a.query} »`;
}

const joinFr = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`);

function relativeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 0) return d.toLocaleDateString("fr-FR");
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days} jours`;
  if (days < 30) return `Il y a ${plural(Math.floor(days / 7), "semaine")}`;
  if (days < 180) return `Il y a ${Math.floor(days / 30)} mois`;
  return d.toLocaleDateString("fr-FR");
}

function relativeTime(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return "";
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 1440) return `il y a ${Math.round(minutes / 60)} h`;
  return `le ${d.toLocaleDateString("fr-FR")}`;
}

function setStatus(msg, type = "info") {
  if (!msg) {
    statusEl.hidden = true;
    statusEl.innerHTML = "";
    return;
  }
  statusEl.className = `notice notice-${type}`;
  statusEl.innerHTML = `${icon(type === "error" ? "alert" : "info")}<span>${escapeHtml(msg)}</span>`;
  statusEl.hidden = false;
}

// ---------------------------------------------------------------------------
// Statut des offres (vue / candidaté / ignorée), stocké sur l'appareil
// ---------------------------------------------------------------------------
const JOB_STATUS_KEY = "sophia-jobs:job-status";
const STATUS_INFO = {
  read: { label: "Vue", icon: "eye" },
  applied: { label: "Candidaté", icon: "check-circle" },
  ignored: { label: "Ignorée", icon: "eye-off" },
};

let jobStatuses = store.get(JOB_STATUS_KEY, {});

// Les simples « vues » anciennes sont oubliées (candidatures et offres ignorées restent).
(function pruneStatuses() {
  const limit = Date.now() - 180 * 86400000;
  let changed = false;
  for (const [url, s] of Object.entries(jobStatuses)) {
    if (s?.status === "read" && new Date(s.at).getTime() < limit) {
      delete jobStatuses[url];
      changed = true;
    }
  }
  if (changed) store.set(JOB_STATUS_KEY, jobStatuses);
})();

const getJobStatus = (url) => jobStatuses[url] || null;

function setJobStatus(url, status) {
  jobStatuses = store.get(JOB_STATUS_KEY, {});
  if (status) jobStatuses[url] = { status, at: new Date().toISOString() };
  else delete jobStatuses[url];
  store.set(JOB_STATUS_KEY, jobStatuses);
}

// Un autre onglet a modifié les statuts : on se resynchronise.
window.addEventListener("storage", (e) => {
  if (e.key === JOB_STATUS_KEY) {
    jobStatuses = store.get(JOB_STATUS_KEY, {});
    if (state.allJobs.length) renderJobs();
  }
});

// ---------------------------------------------------------------------------
// Cartes d'offres
// ---------------------------------------------------------------------------
const LEVEL_LABELS = { debutant: "Débutant", confirme: "Confirmé", expert: "Expert" };

function sourceLabel(job) {
  const s = job.source || "";
  if (s.startsWith("Entreprise:")) return "Site carrières de l'entreprise";
  return s ? `via ${s}` : "";
}

function relevance(job) {
  if (!state.query || job.score == null) return null;
  if (job.score >= 70) return { label: "Très pertinent", cls: "top" };
  if (job.score >= 45) return { label: "Pertinent", cls: "good" };
  return null;
}

function jobCard(job) {
  const status = getJobStatus(job.url);
  const isNew = state.newUrls.has(job.url);
  const company = job.company && job.company !== "N/C" ? job.company : "";
  const rel = relevance(job);

  const tags = [];
  if (job.contractType) tags.push(`<span class="tag tag-contract">${escapeHtml(job.contractType)}</span>`);
  const level = LEVEL_LABELS[job.experienceLevel];
  const exp = [level, job.experience].filter(Boolean).join(" · ");
  if (exp) tags.push(`<span class="tag">${icon("award")}${escapeHtml(exp)}</span>`);
  const when = relativeDate(job.date);
  if (when) tags.push(`<span class="tag" title="Date de publication">${icon("clock")}${escapeHtml(when)}</span>`);

  const statusPill = status
    ? `<span class="pill pill-${status.status}">${icon(STATUS_INFO[status.status].icon)}${STATUS_INFO[status.status].label}${
        status.status === "applied" && status.at ? ` le ${new Date(status.at).toLocaleDateString("fr-FR")}` : ""
      }</span>`
    : "";

  const actions = [
    status?.status !== "applied"
      ? `<button type="button" class="btn-chip" data-action="applied" title="Marquer comme candidaté">${icon("check")}Candidaté</button>`
      : "",
    status?.status !== "ignored"
      ? `<button type="button" class="btn-chip" data-action="ignored" title="Griser cette offre">${icon("eye-off")}Ignorer</button>`
      : "",
    status
      ? `<button type="button" class="btn-chip" data-action="clear" title="Effacer le statut">${icon("rotate-ccw")}Rétablir</button>`
      : "",
  ].join("");

  return `
    <article class="job${status ? ` is-${status.status}` : ""}${isNew ? " is-new" : ""}" data-url="${escapeHtml(job.url)}">
      ${avatar(company)}
      <div class="job-main">
        <div class="job-head">
          <a class="job-title" href="${safeUrl(job.url)}" target="_blank" rel="noopener" data-open>${escapeHtml(job.title)}</a>
          <div class="job-badges">
            ${isNew ? `<span class="pill pill-new">Nouveau</span>` : ""}
            ${rel ? `<span class="pill pill-${rel.cls}">${rel.label}</span>` : ""}
          </div>
        </div>
        <div class="job-sub">
          ${
            company
              ? `<button type="button" class="job-company" data-company="${escapeHtml(company)}" title="Toutes les offres de ${escapeHtml(company)}">${escapeHtml(company)}</button>`
              : ""
          }
          ${job.location ? `<span class="job-loc">${icon("map-pin")}${escapeHtml(job.location)}</span>` : ""}
        </div>
        ${tags.length ? `<div class="job-tags">${tags.join("")}</div>` : ""}
        ${job.description ? `<p class="job-desc">${escapeHtml(job.description)}</p>` : ""}
        <div class="job-foot">
          <span class="job-source">${escapeHtml(sourceLabel(job))}</span>
          ${statusPill}
          <div class="job-actions">${actions}</div>
        </div>
      </div>
    </article>`;
}

const skeletons = (n) =>
  Array.from(
    { length: n },
    () =>
      `<div class="job skeleton" aria-hidden="true"><span class="avatar"></span><div class="job-main"><span class="sk sk-title"></span><span class="sk sk-line"></span><span class="sk sk-line sk-short"></span></div></div>`
  ).join("");

// ---------------------------------------------------------------------------
// Filtres, tri et rendu de la liste (instantané, sans requête réseau)
// ---------------------------------------------------------------------------
hideIgnored.checked = store.get("sophia-jobs:hide-ignored", false);

function filteredJobs() {
  const level = filterLevel.value;
  const contract = filterContract.value;
  const sort = sortBy.value;

  let jobs = state.allJobs.filter((j) => {
    if (level === "inconnu" && j.experienceLevel) return false;
    if (level && level !== "inconnu" && j.experienceLevel !== level) return false;
    if (contract === "inconnu" && j.contractType) return false;
    if (contract && contract !== "inconnu" && j.contractType !== contract) return false;
    return true;
  });

  let hidden = 0;
  if (hideIgnored.checked) {
    const kept = jobs.filter((j) => getJobStatus(j.url)?.status !== "ignored");
    hidden = jobs.length - kept.length;
    jobs = kept;
  }

  const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1);
  if (sort === "date") {
    const time = (j) => {
      const t = j.date ? new Date(j.date).getTime() : NaN;
      return Number.isNaN(t) ? -Infinity : t;
    };
    jobs = [...jobs].sort((a, b) => time(b) - time(a) || byScore(a, b));
  } else if (sort === "company") {
    jobs = [...jobs].sort((a, b) => (a.company || "").localeCompare(b.company || "", "fr") || byScore(a, b));
  } else {
    // Pertinence : les nouveautés d'une alerte d'abord.
    const isNew = (j) => (state.newUrls.has(j.url) ? 1 : 0);
    jobs = [...jobs].sort((a, b) => isNew(b) - isNew(a) || byScore(a, b));
  }
  return { jobs, hidden };
}

function renderJobs() {
  const { jobs, hidden } = filteredJobs();
  state.viewJobs = jobs;

  resultsEl.innerHTML = jobs.length
    ? jobs.map(jobCard).join("")
    : `<div class="empty">${icon("filter", "empty-icon")}<h3>Aucune offre avec ces filtres</h3><p>Élargissez les critères ou réinitialisez les filtres.</p></div>`;

  const total = state.allJobs.length;
  const context = [];
  if (state.query) context.push(`pour « ${state.query} »`);
  if (state.company) context.push(`chez ${state.company}`);
  if (jobs.length !== total) context.push(`sur ${total}`);
  const fresh = state.allJobs.filter((j) => state.newUrls.has(j.url)).length;
  if (fresh) context.push(`· ${plural(fresh, "nouvelle")}`);
  if (hidden) context.push(`· ${plural(hidden, "ignorée masquée", "ignorées masquées")}`);

  resultsCount.textContent = plural(jobs.length, "offre");
  resultsContext.textContent = context.join(" ");
  exportBtn.disabled = jobs.length === 0;
  resetFilters.hidden = !(filterLevel.value || filterContract.value || sortBy.value !== "score");
}

/** Décompte par option, pour guider le choix des filtres. */
function updateFilterCounts() {
  const count = (predicate) => state.allJobs.filter(predicate).length;
  const label = (option, n) => {
    option.dataset.label ||= option.textContent;
    option.textContent = `${option.dataset.label} (${n})`;
  };
  for (const option of filterLevel.options) {
    if (!option.value) label(option, state.allJobs.length);
    else if (option.value === "inconnu") label(option, count((j) => !j.experienceLevel));
    else label(option, count((j) => j.experienceLevel === option.value));
  }
  for (const option of filterContract.options) {
    if (!option.value) label(option, state.allJobs.length);
    else if (option.value === "inconnu") label(option, count((j) => !j.contractType));
    else label(option, count((j) => j.contractType === option.value));
  }
}

for (const node of [filterLevel, filterContract, sortBy]) node.addEventListener("change", renderJobs);

hideIgnored.addEventListener("change", () => {
  store.set("sophia-jobs:hide-ignored", hideIgnored.checked);
  renderJobs();
});

resetFilters.addEventListener("click", () => {
  filterLevel.value = "";
  filterContract.value = "";
  sortBy.value = "score";
  renderJobs();
});

// ---------------------------------------------------------------------------
// Bandeau « Offres chez … » (mode entreprise)
// ---------------------------------------------------------------------------
function companyCountLabel(c) {
  if (c.jobs > 0) return `${c.truncated ? `${c.jobs}+` : c.jobs} offre${c.jobs > 1 ? "s" : ""} sur leur site carrières`;
  if (!c.crawled) return "Site carrières à consulter directement";
  if (!c.status || c.status === "pending") return "Site carrières en cours d'analyse";
  if (c.status === "unreachable" || c.status === "error") return "Site carrières momentanément injoignable";
  return "Aucune offre locale sur leur site en ce moment";
}

function renderCompanyBanner(profile) {
  if (!profile) {
    companyBanner.hidden = true;
    companyBanner.innerHTML = "";
    return;
  }
  const career = profile.careerUrl || profile.site;
  const apply = profile.applyUrl || career;
  const note =
    !profile.loading && !profile.crawled
      ? `<p class="banner-note">${icon("info")}<span>Le site carrières de ${escapeHtml(profile.name)} ne peut pas être analysé automatiquement (application web ou protection anti-robot) : voici ses offres relayées par les job boards. Pensez à consulter aussi son site.</span></p>`
      : "";

  companyBanner.innerHTML = `
    <div class="banner-main">
      ${avatar(profile.name, "xl")}
      <div class="banner-text">
        <p class="eyebrow">Offres chez</p>
        <h2>${escapeHtml(profile.name)}</h2>
        ${profile.tagline ? `<p class="banner-tagline">${escapeHtml(profile.tagline)}</p>` : ""}
        ${profile.loading ? "" : `<p class="banner-count">${icon("briefcase")}${escapeHtml(companyCountLabel(profile))}</p>`}
      </div>
      <button type="button" class="icon-btn banner-close" data-leave-company title="Revenir à toutes les entreprises" aria-label="Revenir à toutes les entreprises">${icon("x")}</button>
    </div>
    <div class="banner-actions">
      ${career ? `<a class="btn btn-ghost" href="${safeUrl(career)}" target="_blank" rel="noopener">${icon("external-link")}Site carrières</a>` : ""}
      ${apply ? `<a class="btn btn-accent" href="${safeUrl(apply)}" target="_blank" rel="noopener">${icon("send")}Candidature spontanée</a>` : ""}
    </div>
    ${note}`;
  companyBanner.hidden = false;
}

companyBanner.addEventListener("click", (e) => {
  if (e.target.closest("[data-leave-company]")) go(searchHref({ q: state.query }));
});

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------
function renderLinks(data) {
  const links = data.searchLinks || [];
  const companies = data.companyLinks || [];
  el("search-links").innerHTML = links
    .map((l) => `<a class="chip" href="${safeUrl(l.url)}" target="_blank" rel="noopener">${icon("external-link")}${escapeHtml(l.source)}</a>`)
    .join("");
  el("company-links").innerHTML = companies
    .map((c) => `<button type="button" class="chip" data-company="${escapeHtml(c.company)}">${escapeHtml(c.company)}</button>`)
    .join("");
  el("links-block").hidden = !links.length;
  el("company-links-block").hidden = !companies.length;
  moreLinks.hidden = !links.length && !companies.length;
}

function emptyState(data) {
  const what = [state.query ? `pour « ${state.query} »` : "", state.company ? `chez ${state.company}` : ""]
    .filter(Boolean)
    .join(" ");
  let hint = "Essayez un intitulé plus court ou un synonyme — ou créez une alerte pour être prévenu dès qu'une offre paraît.";
  if (state.profile && !state.profile.crawled) {
    hint = `Le site carrières de ${state.profile.name} ne peut pas être analysé automatiquement : consultez-le directement, ou créez une alerte.`;
  }
  if (!data.franceTravailEnabled) hint += " (L'API France Travail n'est pas configurée sur ce serveur.)";
  return `<div class="empty">${icon("search", "empty-icon")}<h3>Aucune offre ${escapeHtml(what)} pour le moment</h3><p>${escapeHtml(hint)}</p></div>`;
}

function resetSearchView() {
  state.searchSeq++;
  Object.assign(state, { query: "", company: "", profile: null, allJobs: [], viewJobs: [], searchKey: null });
  state.newUrls = new Set();
  document.body.classList.remove("has-results");
  input.value = "";
  input.placeholder = DEFAULT_PLACEHOLDER;
  resultsEl.innerHTML = "";
  for (const node of [toolbar, filtersEl, moreLinks, alertPanel]) node.hidden = true;
  renderCompanyBanner(null);
  setStatus(null);
  searchBtn.disabled = false;
}

/**
 * Lance une recherche (mots-clés et/ou entreprise) et affiche les résultats.
 * `newUrls`/`extraJobs` : nouveautés d'une alerte, mises en avant (badge « Nouveau »).
 */
async function runSearch({ q = "", company = "", newUrls = [], extraJobs = [] } = {}) {
  const seq = ++state.searchSeq;
  const local = findLocalAlert(q, company);
  Object.assign(state, { query: q, company, profile: null, allJobs: [], viewJobs: [], searchKey: `${company}\u0000${q}` });
  state.newUrls = new Set([...newUrls, ...(local?.pendingUrls || [])]);

  document.body.classList.add("has-results");
  input.value = q;
  input.placeholder = company ? `Filtrer les offres de ${company} (optionnel)` : DEFAULT_PLACEHOLDER;
  for (const node of [toolbar, filtersEl, moreLinks, alertPanel]) node.hidden = true;
  renderCompanyBanner(company ? { name: company, loading: true } : null);
  setStatus(null);
  resultsEl.innerHTML = skeletons(4);
  searchBtn.disabled = true;

  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (company) params.set("company", company);
    const data = await apiFetch(`/api/search?${params}`);
    if (seq !== state.searchSeq) return;

    state.profile = data.company || null;
    if (state.profile) renderCompanyBanner(state.profile);
    const known = new Set(data.jobs.map((j) => j.url));
    state.allJobs = [...extraJobs.filter((j) => j.url && !known.has(j.url)), ...data.jobs];
    renderLinks(data);
    toolbar.hidden = false;

    if (!state.allJobs.length) {
      resultsCount.textContent = "0 offre";
      resultsContext.textContent = "";
      exportBtn.disabled = true;
      resultsEl.innerHTML = emptyState(data);
    } else {
      updateFilterCounts();
      renderJobs();
      filtersEl.hidden = false;
    }
    acknowledgeLocalAlert(q, company);
  } catch (err) {
    if (seq !== state.searchSeq) return;
    resultsEl.innerHTML = "";
    setStatus(err.message || "Erreur lors de la recherche.", "error");
  } finally {
    if (seq === state.searchSeq) searchBtn.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q && !state.company) {
    input.focus();
    return;
  }
  input.blur();
  go(searchHref({ q, company: state.company }));
});

el("suggestions").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-q]");
  if (chip) go(searchHref({ q: chip.dataset.q }));
});

el("company-links").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-company]");
  if (chip) go(searchHref({ q: state.query, company: chip.dataset.company }));
});

// Délégation d'événements sur les cartes (regénérées à chaque rendu).
function markRead(card) {
  const url = card?.dataset.url;
  if (!url || getJobStatus(url)) return;
  setJobStatus(url, "read");
  // Après la navigation : remplacer le lien pendant le clic pourrait l'annuler.
  setTimeout(() => refreshCard(card), 200);
}

function refreshCard(card) {
  const job = state.viewJobs.find((j) => j.url === card.dataset.url);
  if (job && card.isConnected) card.outerHTML = jobCard(job);
}

resultsEl.addEventListener("click", (e) => {
  const link = e.target.closest("[data-open]");
  if (link) return markRead(link.closest(".job"));

  const companyBtn = e.target.closest("[data-company]");
  if (companyBtn) return go(searchHref({ company: companyBtn.dataset.company }));

  const action = e.target.closest("[data-action]");
  if (!action) return;
  const card = action.closest(".job");
  const url = card?.dataset.url;
  if (!url) return;
  const act = action.dataset.action;
  setJobStatus(url, act === "clear" ? null : act);
  if (act === "ignored" && hideIgnored.checked) renderJobs();
  else refreshCard(card);
});

// Clic molette (ouverture dans un nouvel onglet) : l'offre est aussi marquée « vue ».
resultsEl.addEventListener("auxclick", (e) => {
  const link = e.target.closest("[data-open]");
  if (link && e.button === 1) markRead(link.closest(".job"));
});

// --- Export Excel (XLSX via SheetJS) ---
exportBtn.addEventListener("click", () => {
  if (!state.viewJobs.length || typeof XLSX === "undefined") return;
  const rows = state.viewJobs.map((j) => ({
    "Intitulé": j.title || "",
    "Entreprise": j.company && j.company !== "N/C" ? j.company : "",
    "Lieu": j.location || "",
    "Contrat": j.contractType || "",
    "Niveau": LEVEL_LABELS[j.experienceLevel] || "",
    "Expérience": j.experience || "",
    "Date": j.date ? new Date(j.date).toLocaleDateString("fr-FR") : "",
    "Pertinence (%)": j.score ?? "",
    "Statut": STATUS_INFO[getJobStatus(j.url)?.status]?.label || "",
    "Source": j.source || "",
    "Lien pour postuler": j.url || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [45, 24, 20, 14, 12, 16, 12, 14, 12, 22, 55].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Offres");
  const name = normalize([state.company, state.query].filter(Boolean).join(" ") || "recherche")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  XLSX.writeFile(wb, `sophia-jobs_${name}_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// ---------------------------------------------------------------------------
// Alertes « nouvelles offres »
// Le serveur vérifie les alertes ; ce navigateur garde la liste de SES alertes
// (l'identifiant aléatoire sert de clé d'accès, aucun compte n'est nécessaire).
// ---------------------------------------------------------------------------
const ALERTS_KEY = "sophia-jobs:alerts";
const getRegistry = () => store.get(ALERTS_KEY, []);
const saveRegistry = (list) => store.set(ALERTS_KEY, list);

const alertFields = (remote) => ({
  query: remote.query || "",
  company: remote.company || "",
  email: remote.email || null,
  hasPush: Boolean(remote.hasPush),
  lastCheckedAt: remote.lastCheckedAt || null,
  pending: (remote.pending || []).length,
  pendingUrls: (remote.pending || []).map((p) => p.url),
});

function upsertAlert(remote) {
  const list = getRegistry();
  const entry = { id: remote.id, createdAt: remote.createdAt, ...alertFields(remote) };
  const i = list.findIndex((a) => a.id === entry.id);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
  saveRegistry(list);
  return entry;
}

const findLocalAlert = (q, company) =>
  getRegistry().find((a) => (a.query || "") === (q || "") && (a.company || "") === (company || "")) || null;

function updateBadge() {
  const total = getRegistry().reduce((sum, a) => sum + (a.pending || 0), 0);
  bellBadge.hidden = total === 0;
  bellBadge.textContent = total > 99 ? "99+" : String(total);
  bellBtn.classList.toggle("has-new", total > 0);
  bellBtn.title = total ? `${plural(total, "nouvelle offre", "nouvelles offres")} — Mes alertes` : "Mes alertes";
  // Pastille sur l'icône de l'application installée (PWA), si le système la gère.
  if ("setAppBadge" in navigator) {
    (total ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => {});
  }
}

/** Ce qui empêche (ou non) les notifications du navigateur, en clair. */
function pushSupport() {
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason:
        "Indisponibles ici : les navigateurs n'autorisent les notifications que sur un site sécurisé (HTTPS). Ce site est ouvert en HTTP, c'est pourquoi rien ne vous est proposé.",
    };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return {
      ok: false,
      reason: ios
        ? "Sur iPhone/iPad : ajoutez d'abord Sophia Jobs à l'écran d'accueil (Partager → Sur l'écran d'accueil)."
        : "Ce navigateur ne gère pas les notifications push.",
    };
  }
  if (!state.config.pushEnabled || !state.config.vapidPublicKey) {
    return { ok: false, reason: "Pas encore activées sur ce serveur (clés VAPID à configurer par l'administrateur)." };
  }
  if (Notification.permission === "denied") {
    return {
      ok: false,
      reason: "Bloquées pour ce site : autorisez-les dans les réglages du navigateur (icône à gauche de l'adresse).",
    };
  }
  return {
    ok: true,
    reason:
      Notification.permission === "granted"
        ? "Autorisées sur cet appareil, même onglet fermé."
        : "Le navigateur vous demandera l'autorisation, puis vous préviendra même onglet fermé.",
  };
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const raw = atob((base64String + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

async function subscribePush(alertId, permission) {
  if (permission !== "granted") {
    return { ok: false, reason: "Notifications non autorisées : l'alerte reste visible ici, sur la cloche." };
  }
  try {
    const reg = await withTimeout(navigator.serviceWorker.ready, 8000);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.config.vapidPublicKey),
      });
    }
    await apiFetch(`/api/alerts/${encodeURIComponent(alertId)}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return { ok: true };
  } catch (err) {
    console.warn("Abonnement push impossible :", err);
    return {
      ok: false,
      reason: "Le navigateur n'a pas pu s'abonner aux notifications (réseau d'entreprise ou proxy ?).",
    };
  }
}

function feedback(message) {
  if (!message) {
    alertFeedback.hidden = true;
    return;
  }
  alertFeedback.className = `small feedback feedback-${message.type}`;
  alertFeedback.textContent = message.text;
  alertFeedback.hidden = false;
}

async function openAlertPanel() {
  await configReady;
  alertSubject.textContent = `Pour ${alertLabel({ query: state.query, company: state.company })}.`;

  const push = pushSupport();
  alertPush.disabled = !push.ok;
  alertPush.checked = push.ok;
  pushHint.textContent = push.reason;
  pushChannel.classList.toggle("is-disabled", !push.ok);

  const mail = state.config.emailEnabled;
  emailToggle.disabled = !mail;
  emailToggle.checked = false;
  alertEmail.hidden = true;
  emailHint.textContent = mail
    ? "Un récapitulatif à chaque nouveauté."
    : "Indisponible : l'envoi d'emails n'est pas configuré sur ce serveur.";
  emailChannel.classList.toggle("is-disabled", !mail);

  const existing = findLocalAlert(state.query, state.company);
  alertCreateBtn.disabled = Boolean(existing);
  feedback(existing ? { type: "info", text: "Vous suivez déjà cette recherche : retrouvez-la dans « Mes alertes » (cloche)." } : null);

  alertPanel.hidden = false;
  alertPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

alertToggle.addEventListener("click", () => (alertPanel.hidden ? openAlertPanel() : (alertPanel.hidden = true)));
el("alert-close").addEventListener("click", () => (alertPanel.hidden = true));

emailToggle.addEventListener("change", () => {
  alertEmail.hidden = !emailToggle.checked;
  if (emailToggle.checked) alertEmail.focus();
});

alertCreateBtn.addEventListener("click", async () => {
  const wantPush = alertPush.checked && !alertPush.disabled;
  const email = emailToggle.checked ? alertEmail.value.trim() : "";
  if (emailToggle.checked && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    feedback({ type: "error", text: "Adresse email invalide." });
    alertEmail.focus();
    return;
  }

  // La demande d'autorisation doit partir directement du clic, avant tout appel
  // réseau : sinon certains navigateurs l'ignorent silencieusement.
  const permission =
    wantPush && Notification.permission === "default"
      ? Notification.requestPermission()
      : Promise.resolve(wantPush ? Notification.permission : "default");

  alertCreateBtn.disabled = true;
  feedback({ type: "info", text: "Création de l'alerte…" });
  try {
    const created = await apiFetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: state.query, company: state.company, email }),
    });
    const channels = ["dans l'application"];
    if (email) channels.push("par email");
    let pushNote = "";
    if (wantPush) {
      const res = await subscribePush(created.id, await permission);
      if (res.ok) channels.push("par notification");
      else pushNote = ` ${res.reason}`;
      created.hasPush = res.ok;
    }
    upsertAlert(created);
    updateBadge();
    feedback({ type: "success", text: `Alerte créée : vous serez prévenu ${joinFr(channels)}.${pushNote}` });
  } catch (err) {
    feedback({ type: "error", text: err.message });
    alertCreateBtn.disabled = false;
  }
});

/** Affiche une notification locale (onglet ouvert en arrière-plan, sans abonnement push). */
async function localNotify(alert, count) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const title = `${plural(count, "nouvelle offre", "nouvelles offres")} — ${alertLabel(alert)}`;
  const body = alert.pending
    .slice(0, 3)
    .map((p) => `${p.title}${p.company ? " · " + p.company : ""}`)
    .join("\n");
  const options = { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: `alert-${alert.id}`, data: { url: `/?alert=${encodeURIComponent(alert.id)}` } };
  try {
    const reg = await withTimeout(navigator.serviceWorker.ready, 3000);
    await reg.showNotification(title, options);
  } catch {
    try {
      new Notification(title, options);
    } catch {
      /* notifications indisponibles */
    }
  }
}

let lastPoll = 0;
async function pollAlerts({ notify = true } = {}) {
  lastPoll = Date.now();
  const updates = new Map();
  const gone = new Set();
  for (const a of getRegistry()) {
    const fetchedAt = Date.now();
    try {
      const remote = await apiFetch(`/api/alerts/${encodeURIComponent(a.id)}`);
      const count = remote.pending.length;
      if (notify && count > (a.pending || 0) && document.hidden && !remote.hasPush) localNotify(remote, count);
      updates.set(a.id, { fields: alertFields(remote), fetchedAt });
    } catch (err) {
      if (err.status === 404) gone.add(a.id); // alerte supprimée (désinscription par email)
    }
  }
  if (updates.size || gone.size) {
    // Liste relue à la fin : une alerte créée, supprimée ou acquittée pendant le sondage
    // (clic, autre onglet) ne doit pas être écrasée par la copie prise au départ.
    saveRegistry(
      getRegistry()
        .filter((a) => !gone.has(a.id))
        .map((a) => {
          const update = updates.get(a.id);
          if (!update) return a;
          const merged = { ...a, ...update.fields };
          if ((a.ackedAt || 0) > update.fetchedAt) Object.assign(merged, { pending: 0, pendingUrls: [] });
          return merged;
        })
    );
  }
  updateBadge();
  if (!drawer.hidden) renderDrawer();
}

/** Les nouveautés d'une recherche viennent d'être affichées : on les acquitte. */
async function acknowledgeLocalAlert(q, company) {
  const a = findLocalAlert(q, company);
  if (!a?.pending) return;
  try {
    await apiFetch(`/api/alerts/${encodeURIComponent(a.id)}/ack`, { method: "POST" });
  } catch {
    return;
  }
  const ackedAt = Date.now();
  saveRegistry(getRegistry().map((x) => (x.id === a.id ? { ...x, pending: 0, pendingUrls: [], ackedAt } : x)));
  updateBadge();
}

/** Ouverture depuis une notification / un email : `/?alert=<id>`. */
async function openAlert(id) {
  try {
    const remote = await apiFetch(`/api/alerts/${encodeURIComponent(id)}`);
    upsertAlert(remote);
    const url = searchHref({ q: remote.query, company: remote.company || "" });
    history.replaceState(null, "", url);
    state.searchUrl = url;
    await runSearch({
      q: remote.query,
      company: remote.company || "",
      newUrls: remote.pending.map((p) => p.url),
      extraJobs: remote.pending.map((p) => ({ ...p, score: null })),
    });
  } catch (err) {
    history.replaceState(null, "", "/");
    resetSearchView();
    setStatus(err.status === 404 ? "Cette alerte n'existe plus (elle a peut-être été supprimée)." : err.message, "error");
  }
}

// --- Tiroir « Mes alertes » ---
function alertItem(a) {
  const channels = [`<span>${icon("monitor")}Application</span>`];
  if (a.email) channels.push(`<span>${icon("mail")}${escapeHtml(a.email)}</span>`);
  if (a.hasPush) channels.push(`<span>${icon("smartphone")}Notifications</span>`);
  const label = alertLabel(a);
  return `
    <article class="alert-item${a.pending ? " has-new" : ""}" data-id="${escapeHtml(a.id)}">
      <div class="alert-item-head">
        <strong>${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</strong>
        ${a.pending ? `<span class="pill pill-new">${plural(a.pending, "nouvelle")}</span>` : ""}
      </div>
      <p class="alert-item-channels">${channels.join("")}</p>
      <p class="muted small">${a.lastCheckedAt ? `Vérifiée ${relativeTime(a.lastCheckedAt)}` : "Première vérification à venir"}</p>
      <div class="alert-item-actions">
        <button type="button" class="btn btn-soft btn-sm" data-alert-open>Voir les offres</button>
        <button type="button" class="btn btn-link btn-sm btn-danger" data-alert-delete>${icon("trash")}Supprimer</button>
      </div>
    </article>`;
}

function channelRow(ok, iconName, title, text) {
  return `<li class="${ok ? "is-on" : "is-off"}">${icon(iconName)}<div><strong>${escapeHtml(title)}</strong><span class="state">${
    ok ? "disponible" : "indisponible"
  }</span><p>${escapeHtml(text)}</p></div></li>`;
}

function renderDrawer() {
  const list = getRegistry();
  alertsList.innerHTML = list.length
    ? list.map(alertItem).join("")
    : `<div class="empty empty-small">${icon("bell", "empty-icon")}<h3>Aucune alerte</h3><p>Lancez une recherche (ou ouvrez une entreprise) puis cliquez sur « Créer une alerte ».</p></div>`;

  const push = pushSupport();
  howtoIntro.textContent = `Le serveur relance vos recherches toutes les ${state.config.alertsCheckMinutes} minutes et après chaque mise à jour du catalogue. Les nouvelles offres vous sont signalées :`;
  channelsEl.innerHTML = [
    channelRow(true, "monitor", "Dans l'application", "Pastille sur la cloche et badge « Nouveau » sur les offres. Rien à configurer."),
    channelRow(
      state.config.emailEnabled,
      "mail",
      "Par email",
      state.config.emailEnabled
        ? "Renseignez votre adresse en créant l'alerte. Chaque email contient un lien de désinscription."
        : "L'envoi d'emails (SMTP) n'est pas configuré sur ce serveur."
    ),
    channelRow(push.ok, "smartphone", "Notifications du navigateur", push.reason),
  ].join("");
}

async function openDrawer() {
  await configReady;
  renderDrawer();
  drawer.hidden = false;
  document.body.classList.add("no-scroll");
  drawer.querySelector(".drawer-panel").focus();
  pollAlerts({ notify: false });
}

function closeDrawer() {
  drawer.hidden = true;
  document.body.classList.remove("no-scroll");
}

bellBtn.addEventListener("click", openDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !drawer.hidden) closeDrawer();
});

drawer.addEventListener("click", async (e) => {
  if (e.target.closest("[data-close]")) return closeDrawer();
  const item = e.target.closest(".alert-item");
  if (!item) return;
  const id = item.dataset.id;

  if (e.target.closest("[data-alert-open]")) {
    closeDrawer();
    go(`/?alert=${encodeURIComponent(id)}`);
  } else if (e.target.closest("[data-alert-delete]")) {
    const a = getRegistry().find((x) => x.id === id);
    if (!confirm(`Supprimer l'alerte ${a ? alertLabel(a) : ""} ?`)) return;
    try {
      await apiFetch(`/api/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (err) {
      if (err.status !== 404) return alert(err.message);
    }
    saveRegistry(getRegistry().filter((x) => x.id !== id));
    updateBadge();
    renderDrawer();
    if (!alertPanel.hidden) openAlertPanel();
  }
});

// ---------------------------------------------------------------------------
// Onglet « Entreprises » : grands employeurs, startups, ESN
// ---------------------------------------------------------------------------
const CATEGORY_ICONS = { top15: "star", startups: "zap", "esn-majeures": "layers", "esn-montantes": "trending-up" };

function companyLine(c) {
  if (c.jobs > 0) return { cls: "ok", icon: "briefcase", text: `${c.truncated ? `${c.jobs}+` : c.jobs} offre${c.jobs > 1 ? "s" : ""} sur leur site` };
  if (!c.crawled) return { cls: "link", icon: "globe", text: "Offres à consulter sur leur site" };
  if (c.status === "pending") return { cls: "wait", icon: "clock", text: "Analyse de leur site en cours" };
  if (c.status === "unreachable" || c.status === "error") return { cls: "wait", icon: "alert", text: "Site momentanément injoignable" };
  return { cls: "none", icon: "clock", text: "Pas d'offre locale en ce moment" };
}

function companyCard(c) {
  const line = companyLine(c);
  const career = c.careerUrl || c.site;
  const apply = c.applyUrl || career;
  return `
    <article class="company-card">
      <div class="company-head">
        ${avatar(c.name, "lg")}
        <div class="company-id">
          <h3>${escapeHtml(c.name)}</h3>
          ${c.tagline ? `<p class="company-tagline">${escapeHtml(c.tagline)}</p>` : ""}
        </div>
        ${
          career
            ? `<a class="icon-btn icon-btn-sm" href="${safeUrl(career)}" target="_blank" rel="noopener" title="Site carrières" aria-label="Site carrières de ${escapeHtml(c.name)}">${icon("external-link")}</a>`
            : ""
        }
      </div>
      <p class="company-line is-${line.cls}">${icon(line.icon)}${escapeHtml(line.text)}</p>
      <div class="company-actions">
        <button type="button" class="btn btn-primary btn-sm" data-company="${escapeHtml(c.name)}">Voir les offres${icon("arrow-right")}</button>
        ${apply ? `<a class="btn btn-soft btn-sm" href="${safeUrl(apply)}" target="_blank" rel="noopener">${icon("send")}Candidature spontanée</a>` : ""}
      </div>
    </article>`;
}

function renderFeatured() {
  const filter = normalize(companyFilter.value.trim());
  const html = state.featured
    .map((cat) => {
      const companies = cat.companies.filter((c) => !filter || normalize(`${c.name} ${c.tagline || ""}`).includes(filter));
      if (!companies.length) return "";
      return `
        <section class="category">
          <header class="category-head">
            <span class="category-icon">${icon(CATEGORY_ICONS[cat.id] || "briefcase")}</span>
            <div>
              <h2>${escapeHtml(cat.label)}</h2>
              ${cat.description ? `<p class="muted">${escapeHtml(cat.description)}</p>` : ""}
            </div>
            <span class="category-count">${companies.length}</span>
          </header>
          <div class="company-grid">${companies.map(companyCard).join("")}</div>
        </section>`;
    })
    .join("");
  featuredEl.innerHTML =
    html || `<div class="empty">${icon("search", "empty-icon")}<h3>Aucune entreprise ne correspond</h3><p>Essayez un autre nom.</p></div>`;
}

// Liste partagée par l'onglet Entreprises et l'accueil. Les compteurs évoluent avec
// le crawl : elle est rechargée au-delà de 2 minutes.
let featuredRequest = null;
function fetchFeatured() {
  if (state.featured && Date.now() - state.featuredAt < 120000) return Promise.resolve(state.featured);
  featuredRequest ||= apiFetch("/api/featured-companies")
    .then(({ categories }) => {
      state.featured = categories;
      state.featuredAt = Date.now();
      return categories;
    })
    .finally(() => {
      featuredRequest = null;
    });
  return featuredRequest;
}

let featuredRenderedAt = 0;
async function loadFeatured() {
  if (!state.featured) {
    featuredEl.innerHTML = `<div class="company-grid">${Array.from({ length: 6 }, () => `<div class="company-card skeleton"><span class="sk sk-title"></span><span class="sk sk-line"></span><span class="sk sk-line sk-short"></span></div>`).join("")}</div>`;
  }
  try {
    await fetchFeatured();
  } catch (err) {
    if (!state.featured) {
      featuredEl.innerHTML = `<div class="notice notice-error">${icon("alert")}<span>${escapeHtml(err.message)}</span></div>`;
    }
    return;
  }
  if (featuredRenderedAt !== state.featuredAt) {
    featuredRenderedAt = state.featuredAt;
    renderFeatured();
  }
}

featuredEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-company]");
  if (btn) go(searchHref({ company: btn.dataset.company }));
});

companyFilter.addEventListener("input", () => {
  if (state.featured) renderFeatured();
});

// --- Accueil : les entreprises vedettes qui publient le plus d'offres ---
function homeTile(c) {
  const count = c.jobs > 0 ? `${c.truncated ? `${c.jobs}+` : c.jobs} offre${c.jobs > 1 ? "s" : ""}` : "Voir les offres";
  return `
    <button type="button" class="home-tile" data-company="${escapeHtml(c.name)}">
      ${avatar(c.name)}
      <span><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(count)}</small></span>
      ${icon("arrow-right")}
    </button>`;
}

async function loadHome() {
  let categories;
  try {
    categories = await fetchFeatured();
  } catch {
    return; // l'accueil reste utilisable sans cette liste
  }
  let list = categories
    .flatMap((cat) => cat.companies)
    .filter((c) => c.jobs > 0)
    .sort((a, b) => b.jobs - a.jobs);
  // Juste après un déploiement (crawl en cours) : les grands employeurs, sans compteur.
  if (!list.length) list = categories[0]?.companies || [];
  el("home-companies").innerHTML = list.slice(0, 8).map(homeTile).join("");
  el("home-recruiters").hidden = !list.length;
}

el("home").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-company]");
  if (btn) go(searchHref({ company: btn.dataset.company }));
});

// ---------------------------------------------------------------------------
// Chiffres du catalogue + progression du crawl
// ---------------------------------------------------------------------------
async function refreshStats() {
  try {
    const { directory, cache, offers } = await apiFetch("/api/status");
    heroStats.innerHTML = [
      `<span><strong>${fmt(directory.total)}</strong> entreprises suivies</span>`,
      `<span><strong>${fmt(directory.crawlable)}</strong> sites carrières analysés</span>`,
      `<span><strong>${fmt(offers.total)}</strong> offres en catalogue</span>`,
    ].join("");
    companyCount.textContent = `${fmt(directory.total)} entreprises de Sophia suivies`;

    const p = cache.progress || {};
    if (cache.refreshing && p.total) {
      const pct = Math.round((p.done / p.total) * 100);
      crawlLabel.textContent = `Mise à jour du catalogue : ${fmt(p.done)} / ${fmt(p.total)} sites analysés`;
      crawlBar.style.width = `${pct}%`;
      crawlBanner.hidden = false;
    } else {
      crawlBanner.hidden = true;
    }
    return cache.refreshing;
  } catch {
    return false;
  }
}

(async function statsLoop() {
  const refreshing = await refreshStats();
  setTimeout(statsLoop, refreshing ? 5000 : 60000);
})();

// ---------------------------------------------------------------------------
// Navigation : ?q=, ?company=, ?alert=, #entreprises (historique du navigateur)
// ---------------------------------------------------------------------------
function readRoute() {
  const p = new URLSearchParams(location.search);
  return {
    tab: location.hash === "#entreprises" ? "companies" : "search",
    q: (p.get("q") || "").trim(),
    company: (p.get("company") || "").trim(),
    alert: (p.get("alert") || "").trim(),
  };
}

let currentTab = null;
function showTab(name) {
  if (currentTab !== name) window.scrollTo(0, 0);
  currentTab = name;
  for (const [key, node] of Object.entries(tabs)) node.hidden = key !== name;
  for (const a of document.querySelectorAll(".segmented [data-nav]")) {
    a.classList.toggle("active", a.dataset.nav === name);
    a.setAttribute("aria-current", a.dataset.nav === name ? "page" : "false");
  }
  document.title = name === "companies" ? "Entreprises qui recrutent — Sophia Jobs" : "Sophia Jobs — Emploi à Sophia Antipolis";
}

function route() {
  const r = readRoute();
  showTab(r.tab);
  if (r.tab === "companies") return loadFeatured();

  state.searchUrl = location.pathname + location.search;
  if (r.alert) return openAlert(r.alert);
  if (r.q || r.company) {
    if (`${r.company}\u0000${r.q}` !== state.searchKey) {
      window.scrollTo(0, 0);
      runSearch({ q: r.q, company: r.company });
    }
  } else {
    resetSearchView();
    loadHome();
  }
}

function go(url) {
  if (url !== location.pathname + location.search + location.hash) history.pushState(null, "", url);
  route();
}

window.addEventListener("popstate", route);

// Clic sur une notification alors que l'application est déjà ouverte : le service
// worker nous transmet l'URL à afficher, sans recharger la page.
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type !== "navigate" || typeof e.data.url !== "string") return;
  const target = new URL(e.data.url, location.origin);
  if (target.origin === location.origin) go(target.pathname + target.search + target.hash);
});

for (const link of document.querySelectorAll("[data-nav]")) {
  link.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const target = link.dataset.nav;
    if (target === "companies") go("/#entreprises");
    else if (target === "home") go("/");
    else go(state.searchUrl || "/");
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
route();
updateBadge();
setTimeout(() => pollAlerts({ notify: false }), 1500);
setInterval(() => pollAlerts(), 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastPoll > 60000) pollAlerts({ notify: false });
});
