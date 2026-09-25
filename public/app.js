const form = document.getElementById("search-form");
const input = document.getElementById("query");
const btn = document.getElementById("search-btn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const linksPanel = document.getElementById("links-panel");
const searchLinksEl = document.getElementById("search-links");
const companyPanel = document.getElementById("company-panel");
const companyLinksEl = document.getElementById("company-links");
const companyCount = document.getElementById("company-count");
const resultsToolbar = document.getElementById("results-toolbar");
const resultsSummary = document.getElementById("results-summary");
const exportBtn = document.getElementById("export-btn");
const filtersEl = document.getElementById("filters");
const filterLevel = document.getElementById("filter-level");
const filterContract = document.getElementById("filter-contract");
const sortBy = document.getElementById("sort-by");
const resetFilters = document.getElementById("reset-filters");
const crawlBanner = document.getElementById("crawl-banner");
const crawlBannerLabel = document.getElementById("crawl-banner-label");
const crawlBannerCount = document.getElementById("crawl-banner-count");
const crawlBannerBar = document.getElementById("crawl-banner-bar");
const alertPanel = document.getElementById("alert-panel");
const alertEmail = document.getElementById("alert-email");
const alertCreateBtn = document.getElementById("alert-create-btn");
const alertStatus = document.getElementById("alert-status");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = { search: document.getElementById("tab-search"), companies: document.getElementById("tab-companies") };
const featuredCompaniesEl = document.getElementById("featured-companies");

// Résultats de la recherche courante (bruts + après filtres, pour l'export).
let allJobs = [];
let currentJobs = [];
let currentQuery = "";

// --- Enregistrement du service worker (PWA) ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// --- Bandeau de progression du crawl + compteur d'entreprises ---
async function refreshCrawlBanner() {
  try {
    const data = await apiFetch("/api/status");
    const { directory, cache, offers } = data;

    companyCount.textContent =
      `${directory.total.toLocaleString("fr-FR")} entreprises de Sophia suivies ` +
      `(${directory.crawlable.toLocaleString("fr-FR")} sites crawlés, ` +
      `${offers.total.toLocaleString("fr-FR")} offres en catalogue)`;

    const progress = cache.progress || {};
    if (cache.refreshing && progress.total) {
      const pct = Math.round((progress.done / progress.total) * 100);
      crawlBanner.hidden = false;
      crawlBannerLabel.textContent = "Analyse des sites d'entreprises en cours…";
      crawlBannerCount.textContent = `${progress.done} / ${progress.total} (${pct} %)`;
      crawlBannerBar.style.width = `${pct}%`;
    } else {
      crawlBanner.hidden = true;
    }
    return cache.refreshing;
  } catch {
    return false;
  }
}

refreshCrawlBanner();
setInterval(refreshCrawlBanner, 5000);

function setStatus(msg, isError = false) {
  if (!msg) { statusEl.hidden = true; return; }
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Fetch + parse JSON en gérant proprement les cas d'échec réseau/proxy :
 * sans ça, un backend injoignable (proxy d'entreprise, coupure réseau) renvoie
 * souvent une page HTML ou vide, et `res.json()` lève une erreur JSON illisible
 * ("Unexpected token < in JSON…") au lieu d'un message compréhensible.
 */
async function apiFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error("Erreur technique : API injoignable (connexion ou proxy).");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("Erreur technique : API injoignable (connexion ou proxy).");
  }

  if (!res.ok) throw new Error(data?.error || "Erreur technique : API injoignable (connexion ou proxy).");
  return data;
}

const LEVEL_LABELS = {
  debutant: "Débutant",
  confirme: "Confirmé",
  expert: "Expert",
};

// --- Statut des offres (lu / candidaté / ignoré), stocké en local (localStorage) ---
const JOB_STATUS_KEY = "sophia-jobs:job-status";
const JOB_STATUS_LABELS = { read: "👁 Vue", applied: "✅ Candidaté", ignored: "🚫 Ignorée" };

function loadJobStatuses() {
  try {
    return JSON.parse(localStorage.getItem(JOB_STATUS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveJobStatuses(map) {
  try {
    localStorage.setItem(JOB_STATUS_KEY, JSON.stringify(map));
  } catch {
    /* stockage plein ou indisponible : on ignore silencieusement */
  }
}

function getJobStatus(url) {
  return loadJobStatuses()[url]?.status || null;
}

/** Enregistre (ou efface, si status=null) le statut d'une offre par son URL. */
function setJobStatus(url, status) {
  const map = loadJobStatuses();
  if (status) map[url] = { status, at: new Date().toISOString() };
  else delete map[url];
  saveJobStatuses(map);
}

function jobCard(job) {
  const meta = [];
  if (job.company && job.company !== "N/C") meta.push(`<span class="company">${escapeHtml(job.company)}</span>`);
  if (job.location) meta.push(`<span>${escapeHtml(job.location)}</span>`);
  if (job.contractType) meta.push(`<span class="tag contract">${escapeHtml(job.contractType)}</span>`);
  if (job.experienceLevel) {
    const label = LEVEL_LABELS[job.experienceLevel] || job.experienceLevel;
    const detail = job.experience ? ` · ${job.experience}` : "";
    meta.push(`<span class="exp">🎓 ${escapeHtml(label + detail)}</span>`);
  } else if (job.experience) {
    meta.push(`<span class="exp">🎓 ${escapeHtml(job.experience)}</span>`);
  }
  if (job.date) {
    const d = new Date(job.date);
    if (!isNaN(d)) meta.push(`<span title="Date de publication">🗓 ${d.toLocaleDateString("fr-FR")}</span>`);
  }

  const status = getJobStatus(job.url);
  const statusClass = status ? ` job-status-${status}` : "";
  const statusBadge = status ? `<span class="job-status-badge ${status}">${JOB_STATUS_LABELS[status]}</span>` : "";
  const url = escapeHtml(job.url);

  return `
    <div class="job-card${statusClass}" data-job-url="${url}">
      <a class="job-link" href="${url}" target="_blank" rel="noopener" data-track-read="1">
        <div class="job-top">
          <h3 class="job-title">${escapeHtml(job.title)}</h3>
          <span class="job-score" title="Pertinence">${job.score}%</span>
        </div>
        <div class="job-meta">${meta.join("")}</div>
        ${job.description ? `<p class="job-desc">${escapeHtml(job.description)}</p>` : ""}
      </a>
      <div class="job-footer">
        <span class="job-source">${escapeHtml(job.source)}</span>
        ${statusBadge}
        <div class="job-actions">
          <button type="button" class="job-action-btn" data-action="applied" title="Marquer comme candidaté(e)">✅ Candidaté</button>
          <button type="button" class="job-action-btn" data-action="ignored" title="Ignorer cette offre">🚫 Ignorer</button>
          ${status ? `<button type="button" class="job-action-btn" data-action="clear" title="Réinitialiser le statut">↺</button>` : ""}
        </div>
      </div>
    </div>`;
}

function renderLinks(container, links, panel) {
  container.innerHTML = links
    .map((l) => `<a class="chip" href="${escapeHtml(l.url || l.searchUrl)}" target="_blank" rel="noopener">${escapeHtml(l.source || l.company)}</a>`)
    .join("");
  panel.hidden = links.length === 0;
}

// Délégation d'événements : les cartes sont regénérées à chaque rendu, un seul
// listener suffit pour marquer une offre comme candidatée/ignorée/vue.
resultsEl.addEventListener("click", (e) => {
  const link = e.target.closest("[data-track-read]");
  if (link) {
    const card = link.closest(".job-card");
    if (card && !getJobStatus(card.dataset.jobUrl)) {
      setJobStatus(card.dataset.jobUrl, "read");
      card.classList.add("job-status-read");
    }
    return;
  }

  const actionBtn = e.target.closest("[data-action]");
  if (!actionBtn) return;
  e.preventDefault();
  const card = actionBtn.closest(".job-card");
  const url = card?.dataset.jobUrl;
  if (!url) return;

  const action = actionBtn.dataset.action;
  setJobStatus(url, action === "clear" ? null : action);
  // Remplace uniquement la carte concernée (évite de perdre le scroll/filtre en cours).
  const job = currentJobs.find((j) => j.url === url);
  if (job) card.outerHTML = jobCard(job);
});



/**
 * Applique les filtres (niveau d'expérience, type de contrat) et le tri
 * sur les résultats déjà reçus : instantané, aucune requête réseau.
 */
function applyFiltersAndRender() {
  const level = filterLevel.value;
  const contract = filterContract.value;
  const sort = sortBy.value;

  let jobs = allJobs.filter((j) => {
    if (level === "inconnu" && j.experienceLevel) return false;
    if (level && level !== "inconnu" && j.experienceLevel !== level) return false;
    if (contract === "inconnu" && j.contractType) return false;
    if (contract && contract !== "inconnu" && j.contractType !== contract) return false;
    return true;
  });

  if (sort === "date") {
    // Fraîcheur : les offres datées d'abord (plus récentes en tête),
    // puis celles sans date, classées par pertinence.
    jobs = [...jobs].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : NaN;
      const db = b.date ? new Date(b.date).getTime() : NaN;
      const va = Number.isNaN(da) ? -Infinity : da;
      const vb = Number.isNaN(db) ? -Infinity : db;
      if (va !== vb) return vb - va;
      return b.score - a.score;
    });
  } else if (sort === "company") {
    jobs = [...jobs].sort(
      (a, b) => (a.company || "").localeCompare(b.company || "", "fr") || b.score - a.score
    );
  } else {
    jobs = [...jobs].sort((a, b) => b.score - a.score);
  }

  currentJobs = jobs;

  if (!jobs.length) {
    resultsEl.innerHTML = `<p class="empty">Aucune offre ne correspond à ces filtres.</p>`;
  } else {
    resultsEl.innerHTML = jobs.map(jobCard).join("");
  }

  const filtered = jobs.length !== allJobs.length;
  resultsSummary.textContent = filtered
    ? `${jobs.length} offre(s) sur ${allJobs.length} pour « ${currentQuery} »`
    : `${jobs.length} offre(s) pour « ${currentQuery} »`;
  exportBtn.disabled = jobs.length === 0;
}

/** Ajoute le décompte par option pour guider l'utilisateur. */
function updateFilterCounts() {
  const count = (predicate) => allJobs.filter(predicate).length;

  for (const option of filterLevel.options) {
    const base = option.dataset.label || option.textContent;
    option.dataset.label = base;
    if (!option.value) option.textContent = `${base} (${allJobs.length})`;
    else if (option.value === "inconnu") option.textContent = `${base} (${count((j) => !j.experienceLevel)})`;
    else option.textContent = `${base} (${count((j) => j.experienceLevel === option.value)})`;
  }

  for (const option of filterContract.options) {
    const base = option.dataset.label || option.textContent;
    option.dataset.label = base;
    if (!option.value) option.textContent = `${base} (${allJobs.length})`;
    else if (option.value === "inconnu") option.textContent = `${base} (${count((j) => !j.contractType)})`;
    else option.textContent = `${base} (${count((j) => j.contractType === option.value)})`;
  }
}

async function search(query) {
  btn.disabled = true;
  resultsEl.innerHTML = "";
  linksPanel.hidden = true;
  companyPanel.hidden = true;
  resultsToolbar.hidden = true;
  filtersEl.hidden = true;
  alertPanel.hidden = true;
  alertStatus.hidden = true;
  allJobs = [];
  currentJobs = [];
  currentQuery = query;
  setStatus("Recherche en cours sur toutes les sources…");

  try {
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);

    // Liens directs toujours disponibles.
    renderLinks(searchLinksEl, data.searchLinks || [], linksPanel);
    renderLinks(companyLinksEl, data.companyLinks || [], companyPanel);

    if (!data.jobs.length) {
      setStatus(
        data.franceTravailEnabled
          ? `Aucune offre trouvée automatiquement pour « ${query} ». Utilisez les liens directs ci-dessous.`
          : `Aucune offre agrégée. L'API France Travail n'est pas configurée — utilisez les liens directs ci-dessous.`
      );
      resultsEl.innerHTML = `<p class="empty">Pas de résultat direct. Essayez les liens de recherche plus bas.</p>`;
      return;
    }

    setStatus(`${data.count} offre(s) trouvée(s) en ${(data.tookMs / 1000).toFixed(1)}s, classées par pertinence.`);

    allJobs = data.jobs;
    updateFilterCounts();
    applyFiltersAndRender();
    filtersEl.hidden = false;
    resultsToolbar.hidden = false;
    alertPanel.hidden = false;
  } catch (err) {
    setStatus(err.message || "Erreur lors de la recherche.", true);
  } finally {
    btn.disabled = false;
  }
}

// --- Export Excel (XLSX via SheetJS) ---
function exportToExcel() {
  if (!currentJobs.length || typeof XLSX === "undefined") return;

  const rows = currentJobs.map((j) => ({
    "Intitulé": j.title || "",
    "Entreprise": j.company && j.company !== "N/C" ? j.company : "",
    "Lieu": j.location || "",
    "Contrat": j.contractType || "",
    "Niveau": LEVEL_LABELS[j.experienceLevel] || "",
    "Expérience": j.experience || "",
    "Date": j.date ? new Date(j.date).toLocaleDateString("fr-FR") : "",
    "Pertinence (%)": j.score ?? "",
    "Source": j.source || "",
    "Lien pour postuler": j.url || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  // Largeurs de colonnes lisibles.
  ws["!cols"] = [
    { wch: 45 }, { wch: 24 }, { wch: 20 }, { wch: 14 }, { wch: 12 },
    { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 55 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Offres");

  const safeQuery = (currentQuery || "recherche").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `sophia-jobs_${safeQuery}_${date}.xlsx`);
}

exportBtn.addEventListener("click", exportToExcel);

for (const el of [filterLevel, filterContract, sortBy]) {
  el.addEventListener("change", applyFiltersAndRender);
}

resetFilters.addEventListener("click", () => {
  filterLevel.value = "";
  filterContract.value = "";
  sortBy.value = "score";
  applyFiltersAndRender();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) {
    history.replaceState(null, "", `?q=${encodeURIComponent(q)}`);
    search(q);
  }
});

// Recherche automatique si ?q= dans l'URL.
const params = new URLSearchParams(location.search);
if (params.get("q")) {
  input.value = params.get("q");
  search(params.get("q"));
}

// --- Onglets Recherche / Entreprises ---
tabButtons.forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    tabBtn.classList.add("active");
    for (const [key, panel] of Object.entries(tabPanels)) {
      panel.hidden = key !== tabBtn.dataset.tab;
    }
    if (tabBtn.dataset.tab === "companies" && !featuredCompaniesEl.dataset.loaded) {
      loadFeaturedCompanies();
    }
  });
});

// --- Alertes "nouvelles offres" (email + notifications push navigateur) ---
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Active les notifications push du navigateur et abonne l'alerte créée. */
async function subscribeAlertToPush(alertId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const { vapidPublicKey, pushEnabled } = await apiFetch("/api/alerts");
    if (!pushEnabled || !vapidPublicKey) return false;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    await apiFetch(`/api/alerts/${alertId}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription }),
    });
    return true;
  } catch (err) {
    console.warn("Abonnement push impossible :", err.message);
    return false;
  }
}

alertCreateBtn.addEventListener("click", async () => {
  if (!currentQuery) return;
  alertCreateBtn.disabled = true;
  alertStatus.hidden = false;
  alertStatus.textContent = "Création de l'alerte…";

  try {
    const { id } = await apiFetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: currentQuery, email: alertEmail.value.trim() }),
    });

    const pushed = await subscribeAlertToPush(id);
    const parts = [];
    if (alertEmail.value.trim()) parts.push("email");
    if (pushed) parts.push("notifications navigateur");
    alertStatus.textContent = parts.length
      ? `✅ Alerte créée pour « ${currentQuery} » (${parts.join(" + ")}).`
      : `✅ Alerte créée pour « ${currentQuery} ». Activez les notifications ou renseignez un email pour être prévenu.`;
  } catch (err) {
    alertStatus.textContent = err.message || "Erreur technique : impossible de créer l'alerte.";
  } finally {
    alertCreateBtn.disabled = false;
  }
});

// --- Onglet "Entreprises" : Top 15, startups, ESN majeures, ESN montantes ---
function companyCard(company) {
  const jobsHint = company.cachedJobs
    ? `<span class="company-jobs-hint">${company.cachedJobs} offre(s) en catalogue</span>`
    : "";
  return `
    <div class="company-card" data-company="${escapeHtml(company.name)}" data-career="${escapeHtml(company.careerUrl || company.site || "")}">
      <div class="company-card-head">
        <strong>${escapeHtml(company.name)}</strong>
        ${jobsHint}
      </div>
      <div class="company-card-jobs" hidden></div>
      <div class="company-card-actions">
        <button type="button" class="job-action-btn" data-company-action="offers">🔎 Voir les offres</button>
        <a class="job-action-btn" href="${escapeHtml(company.careerUrl || company.site || "#")}" target="_blank" rel="noopener">✉️ Candidature spontanée</a>
      </div>
    </div>`;
}

async function loadFeaturedCompanies() {
  featuredCompaniesEl.dataset.loaded = "1";
  featuredCompaniesEl.innerHTML = `<p class="muted">Chargement…</p>`;
  try {
    const { categories } = await apiFetch("/api/featured-companies");
    featuredCompaniesEl.innerHTML = categories
      .map(
        (cat) => `
      <section class="company-category">
        <h2>${escapeHtml(cat.label)}</h2>
        <p class="muted small">${escapeHtml(cat.description || "")}</p>
        <div class="company-grid">${cat.companies.map((c) => companyCard(c)).join("")}</div>
      </section>`
      )
      .join("");
  } catch (err) {
    featuredCompaniesEl.innerHTML = `<p class="empty">${escapeHtml(err.message || "Erreur technique : API injoignable.")}</p>`;
  }
}

featuredCompaniesEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-company-action='offers']");
  if (!btn) return;
  const card = btn.closest(".company-card");
  const jobsBox = card.querySelector(".company-card-jobs");
  const name = card.dataset.company;

  if (!jobsBox.hidden) {
    jobsBox.hidden = true;
    return;
  }

  jobsBox.hidden = false;
  jobsBox.innerHTML = `<p class="muted small">Recherche…</p>`;
  try {
    const { jobs } = await apiFetch(`/api/company-jobs?name=${encodeURIComponent(name)}`);
    if (jobs.length) {
      jobsBox.innerHTML = jobs
        .map((j) => `<a class="chip" href="${escapeHtml(j.url)}" target="_blank" rel="noopener">${escapeHtml(j.title)}</a>`)
        .join("");
    } else {
      const career = card.dataset.career;
      jobsBox.innerHTML = `<p class="muted small">Aucune offre en catalogue pour le moment. ${
        career ? `<a href="${escapeHtml(career)}" target="_blank" rel="noopener">Voir directement sur le site →</a>` : ""
      }</p>`;
    }
  } catch (err) {
    jobsBox.innerHTML = `<p class="muted small">${escapeHtml(err.message || "Erreur technique : API injoignable.")}</p>`;
  }
});

