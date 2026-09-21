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
    const data = await fetch("/api/status").then((r) => r.json());
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

const LEVEL_LABELS = {
  debutant: "Débutant",
  confirme: "Confirmé",
  expert: "Expert",
};

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

  return `
    <a class="job-card" href="${escapeHtml(job.url)}" target="_blank" rel="noopener">
      <div class="job-top">
        <h3 class="job-title">${escapeHtml(job.title)}</h3>
        <span class="job-score" title="Pertinence">${job.score}%</span>
      </div>
      <div class="job-meta">${meta.join("")}</div>
      ${job.description ? `<p class="job-desc">${escapeHtml(job.description)}</p>` : ""}
      <span class="job-source">${escapeHtml(job.source)}</span>
    </a>`;
}

function renderLinks(container, links, panel) {
  container.innerHTML = links
    .map((l) => `<a class="chip" href="${escapeHtml(l.url || l.searchUrl)}" target="_blank" rel="noopener">${escapeHtml(l.source || l.company)}</a>`)
    .join("");
  panel.hidden = links.length === 0;
}

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
  allJobs = [];
  currentJobs = [];
  currentQuery = query;
  setStatus("Recherche en cours sur toutes les sources…");

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error((await res.json()).error || "Erreur serveur");
    const data = await res.json();

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
