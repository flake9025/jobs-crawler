const crawlState = document.getElementById("crawl-state");
const crawlBar = document.getElementById("crawl-bar");
const crawlCurrent = document.getElementById("crawl-current");
const statsGrid = document.getElementById("stats-grid");
const coverageEl = document.getElementById("coverage");
const topCompaniesEl = document.getElementById("top-companies");
const refreshBtn = document.getElementById("refresh-btn");

const dirSearch = document.getElementById("dir-search");
const dirStatus = document.getElementById("dir-status");
const dirBody = document.getElementById("dir-body");
const directoryCount = document.getElementById("directory-count");
const pageInfo = document.getElementById("page-info");
const prevPage = document.getElementById("prev-page");
const nextPage = document.getElementById("next-page");

const PAGE_SIZE = 50;
let page = 1;
let totalPages = 1;

const STATUS_LABELS = {
  ok: "Offres détectées",
  "no-offer": "Aucune offre publiée",
  unreachable: "Site injoignable",
  error: "Erreur",
  pending: "Pas encore analysée",
  "no-site": "Sans site connu",
};

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

function statCard(label, value, hint = "") {
  return `
    <div class="stat-card">
      <span class="stat-value">${escapeHtml(fmt(value))}</span>
      <span class="stat-label">${escapeHtml(label)}</span>
      ${hint ? `<span class="stat-hint">${escapeHtml(hint)}</span>` : ""}
    </div>`;
}

function renderCoverage(status, total) {
  const order = ["ok", "no-offer", "unreachable", "error", "pending", "no-site"];
  const rows = order
    .filter((k) => status[k])
    .map((k) => {
      const pct = total ? Math.round((status[k] / total) * 100) : 0;
      return `
        <div class="coverage-row">
          <span class="coverage-label"><span class="badge ${k}">${escapeHtml(STATUS_LABELS[k])}</span></span>
          <span class="bar"><span class="bar-fill ${k}" style="width:${pct}%"></span></span>
          <span class="coverage-value">${fmt(status[k])} (${pct} %)</span>
        </div>`;
    });
  coverageEl.innerHTML = rows.join("") || `<p class="muted">Aucun crawl effectué pour l'instant.</p>`;
}

async function loadStatus() {
  const data = await fetch("/api/status").then((r) => r.json());
  const { cache, directory, crawl, offers, topCompanies, sources } = data;
  const progress = cache.progress || {};

  if (cache.refreshing && progress.total) {
    const pct = Math.round((progress.done / progress.total) * 100);
    crawlState.textContent = `Crawl en cours — ${fmt(progress.done)} / ${fmt(progress.total)} entreprises (${pct} %)`;
    crawlBar.style.width = `${pct}%`;
    crawlBar.classList.add("running");
    crawlCurrent.textContent = progress.current?.length
      ? `En cours : ${progress.current.slice(0, 6).join(", ")}`
      : "";
  } else {
    const updated = cache.updatedAt ? new Date(cache.updatedAt).toLocaleString("fr-FR") : "jamais";
    crawlState.textContent = `Aucun crawl en cours — dernière mise à jour : ${updated}`;
    crawlBar.style.width = cache.updatedAt ? "100%" : "0%";
    crawlBar.classList.remove("running");
    crawlCurrent.textContent = "";
  }

  statsGrid.innerHTML = [
    statCard("entreprises dans l'annuaire", directory.total, "sophia-antipolis.fr, Valbonne, OSM"),
    statCard("sites web crawlés", directory.crawlable, `${fmt(directory.withoutSite)} sans site connu`),
    statCard("offres en catalogue", offers.total, "issues des sites d'entreprises"),
    statCard("offres avec niveau d'xp", offers.withExperience, `${fmt(offers.withContract)} avec type de contrat`),
  ].join("");

  // La couverture se lit par rapport aux entreprises réellement crawlables :
  // les entreprises sans site connu sont comptées à part, elles ne sont jamais analysées.
  const byStatus = { ...crawl.byStatus };
  delete byStatus["no-site"];
  const pending = Math.max(0, directory.crawlable - (crawl.analysed || 0));
  renderCoverage({ ...byStatus, pending }, directory.crawlable);

  topCompaniesEl.innerHTML =
    topCompanies.map(
      (c) =>
        `<a class="chip" href="${escapeHtml(c.site || "#")}" target="_blank" rel="noopener">${escapeHtml(
          c.name
        )} · ${c.jobs}</a>`
    ).join("") || `<p class="muted">Aucune offre détectée pour l'instant.</p>`;

  if (!sources.scrapers) {
    crawlCurrent.textContent = "⚠ Scrapers désactivés (ENABLE_SCRAPERS=false) : aucun crawl ne sera lancé.";
  }

  return cache.refreshing;
}

async function loadDirectory() {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (dirSearch.value.trim()) params.set("search", dirSearch.value.trim());
  if (dirStatus.value) params.set("status", dirStatus.value);

  const data = await fetch(`/api/companies?${params}`).then((r) => r.json());
  totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  directoryCount.textContent = `${fmt(data.total)} entreprise(s)`;
  pageInfo.textContent = `Page ${data.page} / ${fmt(totalPages)}`;
  prevPage.disabled = data.page <= 1;
  nextPage.disabled = data.page >= totalPages;

  dirBody.innerHTML =
    data.companies
      .map((c) => {
        const site = c.site
          ? `<a href="${escapeHtml(c.careerUrl || c.site)}" target="_blank" rel="noopener">${escapeHtml(
              c.site.replace(/^https?:\/\/(www\.)?/, "")
            )}</a>`
          : `<span class="muted">—</span>`;
        const checked = c.checkedAt ? new Date(c.checkedAt).toLocaleString("fr-FR") : "—";
        const error = c.error ? `<span class="muted small"> (${escapeHtml(c.error)})</span>` : "";
        return `
          <tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${site}</td>
            <td><span class="badge ${escapeHtml(c.status)}">${escapeHtml(
              STATUS_LABELS[c.status] || c.status
            )}</span>${error}</td>
            <td class="num">${c.jobs || ""}</td>
            <td class="muted small">${escapeHtml(checked)}</td>
          </tr>`;
      })
      .join("") || `<tr><td colspan="5" class="empty">Aucune entreprise ne correspond.</td></tr>`;
}

// --- Interactions ---
let debounce;
dirSearch.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    page = 1;
    loadDirectory();
  }, 250);
});

dirStatus.addEventListener("change", () => {
  page = 1;
  loadDirectory();
});

prevPage.addEventListener("click", () => {
  if (page > 1) {
    page--;
    loadDirectory();
  }
});

nextPage.addEventListener("click", () => {
  if (page < totalPages) {
    page++;
    loadDirectory();
  }
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "⟳ Crawl lancé…";
  try {
    await fetch("/api/cache/refresh", { method: "POST" });
    await loadStatus();
  } finally {
    setTimeout(() => {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "⟳ Relancer le crawl";
    }, 3000);
  }
});

// Rafraîchissement périodique : rapide pendant un crawl, lent sinon.
async function tick() {
  let refreshing = false;
  try {
    refreshing = await loadStatus();
  } catch {
    /* le serveur redémarre peut-être */
  }
  setTimeout(tick, refreshing ? 2000 : 15000);
}

tick();
loadDirectory();
