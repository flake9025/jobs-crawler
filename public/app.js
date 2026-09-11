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

// Résultats de la recherche courante (pour l'export).
let currentJobs = [];
let currentQuery = "";

// --- Enregistrement du service worker (PWA) ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Nombre d'entreprises suivies (affiché en footer).
fetch("/api/companies")
  .then((r) => r.json())
  .then((d) => { companyCount.textContent = `${d.count} entreprises de Sophia suivies`; })
  .catch(() => {});

function setStatus(msg, isError = false) {
  if (!msg) { statusEl.hidden = true; return; }
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function jobCard(job) {
  const meta = [];
  if (job.company && job.company !== "N/C") meta.push(`<span class="company">${escapeHtml(job.company)}</span>`);
  if (job.location) meta.push(`<span>${escapeHtml(job.location)}</span>`);
  if (job.contractType) meta.push(`<span>${escapeHtml(job.contractType)}</span>`);
  if (job.experience) meta.push(`<span class="exp">🎓 ${escapeHtml(job.experience)}</span>`);
  if (job.date) {
    const d = new Date(job.date);
    if (!isNaN(d)) meta.push(`<span>${d.toLocaleDateString("fr-FR")}</span>`);
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

async function search(query) {
  btn.disabled = true;
  resultsEl.innerHTML = "";
  linksPanel.hidden = true;
  companyPanel.hidden = true;
  resultsToolbar.hidden = true;
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
    resultsEl.innerHTML = data.jobs.map(jobCard).join("");

    // Mémorise les résultats et affiche le bouton d'export.
    currentJobs = data.jobs;
    resultsSummary.textContent = `${data.count} offre(s) pour « ${query} »`;
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
    "Expérience": j.experience || "",
    "Pertinence (%)": j.score ?? "",
    "Source": j.source || "",
    "Lien pour postuler": j.url || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  // Largeurs de colonnes lisibles.
  ws["!cols"] = [
    { wch: 45 }, { wch: 24 }, { wch: 20 }, { wch: 14 },
    { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 55 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Offres");

  const safeQuery = (currentQuery || "recherche").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `sophia-jobs_${safeQuery}_${date}.xlsx`);
}

exportBtn.addEventListener("click", exportToExcel);

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
