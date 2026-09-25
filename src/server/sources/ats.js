import { fetchWithTimeout, normalizeText } from "../util.js";
import { isLocalPlace } from "../geo.js";

/**
 * Connecteurs pour les ATS (logiciels de recrutement) dont les pages ne sont pas
 * exploitables par le crawler HTML générique (applications JavaScript). Tous
 * utilisent l'API JSON publique qu'appelle le navigateur du candidat.
 *
 * Chaque connecteur renvoie des candidats { title, url, location, date } déjà
 * restreints aux Alpes-Maritimes.
 */

function safeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function requestJson(url, options = {}) {
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

const postJson = (url, body) =>
  requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const firstSegment = (u) => u.pathname.split("/").filter(Boolean)[0] || null;

// --- Workday (*.myworkdayjobs.com) -------------------------------------------
//   POST https://{host}/wday/cxs/{tenant}/{site}/jobs

const WORKDAY_PAGE_SIZE = 20;

/** Décompose une URL Workday publique en { origin, tenant, site, prefix }. */
export function parseWorkdayUrl(url) {
  const u = safeUrl(url);
  if (!u || !/\.myworkdayjobs\.com$/i.test(u.hostname)) return null;
  const segments = u.pathname.split("/").filter(Boolean);
  // Segment de langue optionnel : /fr-FR/jobs, /en-US/careers…
  const localeOffset = segments[0] && /^[a-z]{2}-[a-z]{2}$/i.test(segments[0]) ? 1 : 0;
  const site = segments[localeOffset];
  if (!site) return null;
  return {
    origin: u.origin,
    tenant: u.hostname.split(".")[0],
    site,
    prefix: `/${segments.slice(0, localeOffset + 1).join("/")}`,
  };
}

/**
 * Parcourt l'arbre de facettes Workday et regroupe, par paramètre, les valeurs de
 * localisation situées dans les Alpes-Maritimes (ex. "Nice", "Sophia Antipolis").
 */
function localFacetValues(facets, parentParam = null, out = new Map()) {
  for (const facet of facets || []) {
    const param = facet.facetParameter || parentParam;
    for (const value of facet.values || []) {
      if (Array.isArray(value.values)) {
        localFacetValues([value], param, out);
      } else if (value.id && isLocalPlace(value.descriptor)) {
        if (!out.has(param)) out.set(param, []);
        out.get(param).push({ id: value.id, label: value.descriptor, count: value.count || 0 });
      }
    }
  }
  return out;
}

async function fetchWorkday(wd, { maxJobs }) {
  const api = `${wd.origin}/wday/cxs/${wd.tenant}/${wd.site}/jobs`;
  const first = await postJson(api, { appliedFacets: {}, limit: 1, offset: 0, searchText: "" });
  const byParam = localFacetValues(first.facets);
  if (!byParam.size) return [];

  // Les facettes de paramètres différents se combinent en ET : on n'en garde qu'une,
  // celle qui couvre le plus d'offres (les valeurs d'un même paramètre sont en OU) ;
  // à égalité, la plus précise (« Valbonne » plutôt que « Alpes-Maritimes »).
  const total = (values) => values.reduce((s, v) => s + v.count, 0);
  const regional = (values) => (values.every((v) => /alpes.maritimes|cote.d.azur/.test(normalizeText(v.label))) ? 1 : 0);
  const [param, values] = [...byParam.entries()].sort(
    (a, b) => total(b[1]) - total(a[1]) || regional(a[1]) - regional(b[1])
  )[0];
  const appliedFacets = { [param]: values.map((v) => v.id) };
  const defaultLocation = values[0].label;

  const candidates = [];
  let available = Infinity;
  for (let offset = 0; offset < available && candidates.length < maxJobs; offset += WORKDAY_PAGE_SIZE) {
    const page = await postJson(api, { appliedFacets, limit: WORKDAY_PAGE_SIZE, offset, searchText: "" });
    available = Number(page.total) || 0;
    const postings = page.jobPostings || [];
    if (!postings.length) break;
    for (const p of postings) {
      if (!p.title || !p.externalPath) continue;
      // "2 Locations" / "3 emplacements" : la facette appliquée garantit la zone.
      const multi = /^\d+\s/.test(p.locationsText || "");
      candidates.push({
        title: p.title,
        url: `${wd.origin}${wd.prefix}${p.externalPath}`,
        location: multi ? defaultLocation : p.locationsText || defaultLocation,
        date: p.postedOn || null,
      });
    }
  }
  return candidates;
}

// --- Greenhouse (boards.greenhouse.io/{board}) -------------------------------

export function parseGreenhouseUrl(url) {
  const u = safeUrl(url);
  if (!u || !/(^|\.)greenhouse\.io$/i.test(u.hostname)) return null;
  const segments = u.pathname.split("/").filter(Boolean);
  // boards.greenhouse.io/{board}, …/embed/job_board?for={board}, boards-api…/v1/boards/{board}/jobs
  const board =
    u.searchParams.get("for") || (segments[0] === "v1" && segments[1] === "boards" ? segments[2] : segments[0]);
  if (!board || board === "embed" || board === "v1") return null;
  return { board };
}

async function fetchGreenhouse({ board }) {
  const data = await requestJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`
  );
  return (data.jobs || []).map((j) => ({
    title: j.title,
    url: j.absolute_url,
    location: j.location?.name || "",
    date: j.first_published || j.updated_at || null,
  }));
}

// --- Lever (jobs.lever.co/{company}) ----------------------------------------

export function parseLeverUrl(url) {
  const u = safeUrl(url);
  if (!u || !/^jobs\.(eu\.)?lever\.co$/i.test(u.hostname)) return null;
  const company = firstSegment(u);
  return company ? { company, eu: /\.eu\./i.test(u.hostname) } : null;
}

async function fetchLever({ company, eu }) {
  const data = await requestJson(
    `https://api${eu ? ".eu" : ""}.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`
  );
  return (Array.isArray(data) ? data : []).map((p) => ({
    title: p.text,
    url: p.hostedUrl,
    location: [p.categories?.location, ...(p.categories?.allLocations || [])].filter(Boolean).join(" / "),
    date: p.createdAt ? new Date(p.createdAt).toISOString() : null,
  }));
}

// --- Recruitee ({company}.recruitee.com) -------------------------------------

export function parseRecruiteeUrl(url) {
  const u = safeUrl(url);
  const m = u && /^([a-z0-9-]+)\.recruitee\.com$/i.exec(u.hostname);
  return m ? { company: m[1] } : null;
}

async function fetchRecruitee({ company }) {
  const data = await requestJson(`https://${company}.recruitee.com/api/offers/`);
  return (data.offers || [])
    .filter((o) => !o.status || o.status === "published")
    .map((o) => ({
      title: o.title,
      url: o.careers_url || o.careers_apply_url,
      location: [o.city, o.location].filter(Boolean).join(" / "),
      date: o.published_at || o.created_at || null,
    }));
}

// --- SmartRecruiters (careers.smartrecruiters.com/{company}) -----------------

export function parseSmartRecruitersUrl(url) {
  const u = safeUrl(url);
  if (!u || !/^(careers|jobs)\.smartrecruiters\.com$/i.test(u.hostname)) return null;
  const company = firstSegment(u);
  return company ? { company } : null;
}

async function fetchSmartRecruiters({ company }) {
  const data = await requestJson(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`
  );
  return (data.content || []).map((p) => ({
    title: p.name,
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${p.id}`,
    location: [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(", "),
    date: p.releasedDate || null,
  }));
}

// --- Phenom (orange.jobs, careers.thalesgroup.com…) ----------------------------
// Domaines personnalisés : l'ATS se reconnaît au HTML (objet `phApp`), pas à l'URL.
//   POST {origin}/widgets { ddoKey: "refineSearch", selected_fields: { city: […] } }

const PHENOM_PAGE_SIZE = 50;

/** Paramètres Phenom d'une page ({ origin, baseUrl, locale, country, siteType }), ou null. */
export function parsePhenomPage(html, pageUrl) {
  if (!/\bphApp\b/.test(html) || !/"refNum"\s*:/.test(html)) return null;
  const pick = (key) => html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1] || "";
  const locale = pick("locale");
  const base = safeUrl(pick("baseUrl")) || safeUrl(pageUrl);
  if (!base || !locale) return null;
  return {
    origin: base.origin,
    baseUrl: base.href.replace(/\/?$/, "/"),
    locale,
    country: pick("country") || "global",
    siteType: pick("siteType") || "external",
  };
}

async function fetchPhenom(ph, { maxJobs }) {
  const search = (selected, from, size) =>
    postJson(`${ph.origin}/widgets`, {
      lang: ph.locale,
      deviceType: "desktop",
      country: ph.country,
      pageName: "search-results",
      ddoKey: "refineSearch",
      sortBy: "",
      subsearch: "",
      from,
      jobs: true,
      counts: true,
      all_fields: ["city"],
      size,
      clearAll: false,
      jdsource: "facets",
      isSliderEnable: false,
      pageId: "page20",
      siteType: ph.siteType,
      keywords: "",
      global: true,
      selected_fields: selected,
      locationData: {},
    }).then((data) => data.refineSearch || {});

  // Première requête : facettes de villes, pour ne demander que celles de la zone.
  const first = await search({}, 0, 1);
  const cities = first.data?.aggregations?.find((a) => a.field === "city")?.value || {};
  const local = Object.keys(cities).filter((city) => cities[city] > 0 && isLocalPlace(city));
  if (!local.length) return [];

  const candidates = [];
  for (let from = 0; candidates.length < maxJobs; from += PHENOM_PAGE_SIZE) {
    const page = await search({ city: local }, from, PHENOM_PAGE_SIZE);
    const jobs = page.data?.jobs || [];
    for (const j of jobs) {
      if (!j.title || !j.jobId) continue;
      candidates.push({
        title: j.title,
        url: `${ph.baseUrl}job/${encodeURIComponent(j.jobId)}`,
        location: j.city || local[0],
        date: j.postedDate || null,
      });
    }
    if (jobs.length < PHENOM_PAGE_SIZE || from + PHENOM_PAGE_SIZE >= (Number(page.totalHits) || 0)) break;
  }
  return candidates;
}

const PHENOM = { id: "phenom", parse: () => null, fetch: fetchPhenom, filtered: true };

// --- Dispatcher ---------------------------------------------------------------

const CONNECTORS = [
  // Workday filtre déjà côté serveur (facette de localisation).
  { id: "workday", parse: parseWorkdayUrl, fetch: fetchWorkday, filtered: true },
  { id: "greenhouse", parse: parseGreenhouseUrl, fetch: fetchGreenhouse },
  { id: "lever", parse: parseLeverUrl, fetch: fetchLever },
  { id: "recruitee", parse: parseRecruiteeUrl, fetch: fetchRecruitee },
  { id: "smartrecruiters", parse: parseSmartRecruitersUrl, fetch: fetchSmartRecruiters },
];

/** Reconnaît une URL d'ATS pris en charge. */
export function detectAts(url) {
  for (const connector of CONNECTORS) {
    const params = connector.parse(url);
    if (params) return { connector, params, url };
  }
  return null;
}

// URL d'ATS citée dans un script inline ou un attribut data-* (widgets chargés en JS).
const ATS_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:greenhouse\.io|lever\.co|recruitee\.com|smartrecruiters\.com|myworkdayjobs\.com)\/[^\s"'<>\\)]*/gi;

/** Premier ATS pris en charge référencé par une page (liens, iframes, scripts d'intégration). */
export function findAtsInPage($, pageUrl) {
  const phenom = parsePhenomPage($.html(), pageUrl);
  if (phenom) return { connector: PHENOM, params: phenom, url: pageUrl };
  let found = null;
  $("a[href], iframe[src], script[src]").each((_, el) => {
    const raw = $(el).attr("href") || $(el).attr("src");
    if (!raw) return;
    let full;
    try {
      full = new URL(raw, pageUrl).href;
    } catch {
      return;
    }
    found = detectAts(full);
    if (found) return false;
  });
  if (found) return found;
  const html = $.html().replace(/\\\//g, "/");
  for (const [url] of html.matchAll(ATS_URL_RE)) {
    found = detectAts(url.replace(/&amp;/g, "&"));
    if (found) return found;
  }
  return null;
}

/** Offres d'un ATS, restreintes aux Alpes-Maritimes. */
export async function fetchAtsCandidates(ats, { maxJobs = 60 } = {}) {
  const raw = await ats.connector.fetch(ats.params, { maxJobs });
  return raw
    .filter((c) => c.title && c.url)
    .filter((c) => ats.connector.filtered || isLocalPlace(c.location))
    .slice(0, maxJobs)
    .map((c) => ({ ...c, context: "", trusted: true }));
}

// --- SAP SuccessFactors (jobs.atos.net…) ----------------------------------------
// Les résultats de recherche sont rendus côté serveur dans un tableau :
//   <tr class="data-row"> <a class="jobTitle-link"> … <span class="jobLocation"> …

/** Lignes d'offres d'une page de résultats SuccessFactors, ou null si absente. */
export function extractSuccessFactorsRows($, pageUrl) {
  const rows = $("tr.data-row");
  if (!rows.length) return null;
  const candidates = [];
  rows.each((_, row) => {
    const link = $(row).find("a.jobTitle-link").first();
    const href = link.attr("href");
    const title = link.text().replace(/\s+/g, " ").trim();
    if (!href || !title) return;
    let url;
    try {
      url = new URL(href, pageUrl).href;
    } catch {
      return;
    }
    candidates.push({
      title,
      url,
      location: $(row).find(".jobLocation").first().text().replace(/\s+/g, " ").trim(),
      date: $(row).find(".jobDate").first().text().replace(/\s+/g, " ").trim(),
      context: "",
      trusted: true,
    });
  });
  return candidates;
}
