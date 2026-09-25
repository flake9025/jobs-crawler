import { escapeHtml, safeUrl, fmt, apiFetch, hydrateIcons, icon } from "/ui.js";

hydrateIcons();

const $ = (id) => document.getElementById(id);
const crawlState = $("crawl-state");
const crawlBar = $("crawl-bar");
const crawlCurrent = $("crawl-current");
const statsGrid = $("stats-grid");
const coverageEl = $("coverage");
const topCompaniesEl = $("top-companies");
const refreshBtn = $("refresh-btn");
const refreshLabel = $("refresh-label");
const apiError = $("api-error");

const dirSearch = $("dir-search");
const dirStatus = $("dir-status");
const dirBody = $("dir-body");
const directoryCount = $("directory-count");
const pageInfo = $("page-info");
const prevPage = $("prev-page");
const nextPage = $("next-page");

const PAGE_SIZE = 50;
let page = 1;
let totalPages = 1;

const STATUS_LABELS = {
  ok: "Offres détectées",
  "no-offer": "Aucune offre publiée",
  unreachable: "Site injoignable",
  error: "Erreur",
  pending: "Pas encore analysée",
  "link-only": "Consultation sur leur site",
  "no-site": "Sans site connu",
};

/** Nombre d'offres ; « 40+ » quand la liste de l'entreprise a été plafonnée. */
const jobsLabel = (c) => (c.jobs ? `${fmt(c.jobs)}${c.truncated ? "+" : ""}` : "");
const companyHref = (name) => `/?company=${encodeURIComponent(name)}`;
const dateTime = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

// Une erreur par source (statut / annuaire) : l'une ne masque pas l'autre.
const errors = {};
function setError(key, err) {
  errors[key] = err ? err.message || String(err) : null;
  const message = Object.values(errors).find(Boolean);
  apiError.innerHTML = message ? `${icon("alert")}<span>${escapeHtml(message)}</span>` : "";
  apiError.hidden = !message;
}

function statCard(label, value, hint = "") {
  return `
    <div class="stat-card">
      <span class="stat-value">${escapeHtml(fmt(value))}</span>
      <span class="stat-label">${escapeHtml(label)}</span>
      ${hint ? `<span class="stat-hint">${escapeHtml(hint)}</span>` : ""}
    </div>`;
}

function renderCoverage(status, total) {
  const order = ["ok", "no-offer", "unreachable", "error", "pending"];
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
  const data = await apiFetch("/api/status");
  const { cache, directory, crawl, offers, topCompanies, sources } = data;
  const progress = cache.progress || {};

  if (cache.refreshing && progress.total) {
    const pct = Math.round((progress.done / progress.total) * 100);
    crawlState.textContent = `Crawl en cours — ${fmt(progress.done)} / ${fmt(progress.total)} entreprises (${pct} %)`;
    crawlBar.style.width = `${pct}%`;
    crawlBar.classList.add("running");
    crawlCurrent.textContent = progress.current?.length ? `En cours : ${progress.current.slice(0, 6).join(", ")}` : "";
  } else {
    const updated = cache.updatedAt ? dateTime(cache.updatedAt) : "jamais";
    crawlState.textContent = `Aucun crawl en cours — dernière mise à jour : ${updated}`;
    crawlBar.style.width = cache.updatedAt ? "100%" : "0%";
    crawlBar.classList.remove("running");
    crawlCurrent.textContent = "";
  }

  statsGrid.innerHTML = [
    statCard("entreprises dans l'annuaire", directory.total, "sophia-antipolis.fr, Valbonne, OSM, sélection"),
    statCard(
      "sites carrières analysés",
      directory.crawlable,
      `${fmt(directory.withoutSite)} sans site connu · ${fmt(directory.linkOnly)} à consulter sur leur site`
    ),
    statCard("offres en catalogue", offers.total, "issues des sites d'entreprises"),
    statCard("offres avec niveau d'expérience", offers.withExperience, `${fmt(offers.withContract)} avec type de contrat`),
  ].join("");

  // La couverture se lit par rapport aux entreprises réellement analysables : celles
  // sans site connu ou à consulter sur leur site sont comptées à part.
  const byStatus = { ...crawl.byStatus };
  delete byStatus["no-site"];
  delete byStatus["link-only"];
  const pending = Math.max(0, directory.crawlable - (crawl.analysed || 0));
  renderCoverage({ ...byStatus, pending }, directory.crawlable);

  topCompaniesEl.innerHTML =
    topCompanies
      .map(
        (c) =>
          `<a class="chip" href="${companyHref(c.name)}" title="Voir les offres de ${escapeHtml(c.name)}">${escapeHtml(
            c.name
          )} <strong>${jobsLabel(c)}</strong></a>`
      )
      .join("") || `<p class="muted">Aucune offre détectée pour l'instant.</p>`;

  if (!sources.scrapers) {
    crawlCurrent.innerHTML = `${icon("alert")} Scrapers désactivés (ENABLE_SCRAPERS=false) : aucun crawl ne sera lancé.`;
  }

  return cache.refreshing;
}

function siteCell(c) {
  const href = c.careerUrl || c.site;
  if (!href) return `<span class="muted">—</span>`;
  const label = (c.site || href).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return `<a href="${safeUrl(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

async function loadDirectory() {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (dirSearch.value.trim()) params.set("search", dirSearch.value.trim());
  if (dirStatus.value) params.set("status", dirStatus.value);

  let data;
  try {
    data = await apiFetch(`/api/companies?${params}`);
    setError("directory", null);
  } catch (err) {
    setError("directory", err);
    return;
  }
  totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  directoryCount.textContent = `${fmt(data.total)} entreprise(s)`;
  pageInfo.textContent = `Page ${data.page} / ${fmt(totalPages)}`;
  prevPage.disabled = data.page <= 1;
  nextPage.disabled = data.page >= totalPages;

  dirBody.innerHTML =
    data.companies
      .map((c) => {
        const star = c.featured
          ? `<span class="featured-star" title="À la une dans l'onglet Entreprises">${icon("star")}</span>`
          : "";
        const error = c.error ? `<span class="muted small"> (${escapeHtml(c.error)})</span>` : "";
        return `
          <tr>
            <td><a href="${companyHref(c.name)}" title="Voir les offres">${escapeHtml(c.name)}</a>${star}</td>
            <td>${siteCell(c)}</td>
            <td><span class="badge ${escapeHtml(c.status)}">${escapeHtml(STATUS_LABELS[c.status] || c.status)}</span>${error}</td>
            <td class="num">${jobsLabel(c)}</td>
            <td class="muted small">${c.checkedAt ? escapeHtml(dateTime(c.checkedAt)) : "—"}</td>
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
  refreshLabel.textContent = "Crawl lancé…";
  try {
    await apiFetch("/api/cache/refresh", { method: "POST" });
    setError("status", null);
    await loadStatus();
  } catch (err) {
    setError("status", err);
  } finally {
    setTimeout(() => {
      refreshBtn.disabled = false;
      refreshLabel.textContent = "Relancer le crawl";
    }, 3000);
  }
});

// Rafraîchissement périodique : rapide pendant un crawl, lent sinon.
async function tick() {
  let refreshing = false;
  try {
    refreshing = await loadStatus();
    setError("status", null);
  } catch (err) {
    setError("status", err);
  }
  setTimeout(tick, refreshing ? 2000 : 15000);
}

tick();
loadDirectory();
