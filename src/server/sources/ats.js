import * as cheerio from "cheerio";
import { fetchWithTimeout, normalizeText } from "../util.js";
import { isLocalPlace } from "../geo.js";

/**
 * Connecteurs pour les ATS (logiciels de recrutement) dont les pages ne sont pas
 * exploitables par le crawler HTML générique (applications JavaScript). Tous
 * utilisent l'API publique qu'appelle le navigateur du candidat, ou les données
 * de recherche embarquées dans la page.
 *
 * Chaque connecteur renvoie des candidats { title, url, location, date,
 * contractType?, experience? }, restreints ensuite aux Alpes-Maritimes.
 */

function safeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function request(url, options = {}) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

async function requestJson(url, options = {}) {
  const res = await request(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  return res.json();
}

const requestText = async (url, options) => (await request(url, options)).text();

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

// --- Yello ({tenant}.yello.co/job_boards/{board}) -------------------------------
// Job boards campus (EY…). La page du board liste les valeurs de ses filtres (ville
// du bureau…) ; la recherche renvoie les résultats en fragment HTML :
//   GET {origin}/job_boards/{board}/search?filters={id}&page_number={n}

const YELLO_MAX_PAGES = 10;

export function parseYelloUrl(url) {
  const u = safeUrl(url);
  if (!u || !/(^|\.)yello\.co$/i.test(u.hostname)) return null;
  const [kind, board] = u.pathname.split("/").filter(Boolean);
  if (kind !== "job_boards" || !board) return null;
  return { origin: u.origin, board, locale: u.searchParams.get("locale") || "fr" };
}

/**
 * Valeurs de filtre situées dans la zone, pour le champ qui en compte le plus
 * (« Emplacement du bureau (ville) ») : des champs différents se combineraient en ET.
 * Les libellés portent un préfixe pays : « FRA-Nice », « MCO-Monaco ».
 */
function yelloLocalFilters($) {
  let best = [];
  $("defined-field-answers-filter-container").each((_, el) => {
    let values;
    try {
      values = JSON.parse($(el).attr("v-bind:filters") || "[]");
    } catch {
      return;
    }
    const local = (Array.isArray(values) ? values : [])
      .map((v) => ({ id: v?.id, label: String(v?.label || "").replace(/^[A-Z]{2,3}-/, "").trim() }))
      .filter((v) => v.id && isLocalPlace(v.label));
    if (local.length > best.length) best = local;
  });
  return best;
}

async function fetchYello(y, { maxJobs }) {
  const board = `${y.origin}/job_boards/${encodeURIComponent(y.board)}`;
  const locale = encodeURIComponent(y.locale);
  const places = yelloLocalFilters(cheerio.load(await requestText(`${board}?locale=${locale}`)));
  const byUrl = new Map();
  // Une recherche par lieu : les résultats n'indiquent pas la ville de l'offre.
  for (const place of places) {
    for (let page = 1; page <= YELLO_MAX_PAGES && byUrl.size < maxJobs; page++) {
      const data = await requestJson(
        `${board}/search?locale=${locale}&query=&filters=${encodeURIComponent(place.id)}` +
          (page > 1 ? `&page_number=${page}` : ""),
        { headers: { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" } }
      );
      const $ = cheerio.load(data.html || "");
      let added = 0;
      $("li.search-results__item").each((_, item) => {
        const link = $(item).find("a.search-results__req_title").first();
        const title = link.text().replace(/\s+/g, " ").trim();
        const href = link.attr("href");
        let url;
        try {
          url = href && new URL(href, y.origin).href;
        } catch {
          return;
        }
        if (!title || !url || byUrl.has(url)) return;
        byUrl.set(url, {
          title,
          url,
          location: place.label,
          // « 8 septembre » (sans année) ou « NOUVEAU ».
          date: $(item).find(".search-results__post-time").first().text().trim() || null,
        });
        added++;
      });
      if (!data.more_requisitions || !added) break;
    }
  }
  return [...byUrl.values()];
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

// --- Sites d'offres propres à un employeur ---------------------------------------
// Utilisés seulement comme `careerSite` de leur fiche : un lien vers ces sites depuis
// la page d'une autre entreprise ne désigne pas les offres de celle-ci.

// Abylsen (jobs.abylsen.com) : application Angular adossée à une API Laravel.
//   POST {origin}/backendLaravel/public/api/jobs/v1/counts            offres par lieu
//   POST {origin}/backendLaravel/public/api/jobs/v1/search?from=&nb=  offres

const ABYLSEN_PAGE_SIZE = 50;

export function parseAbylsenUrl(url) {
  const u = safeUrl(url);
  if (!u || !/^jobs\.abylsen\.com$/i.test(u.hostname)) return null;
  const lang = /^\/(fr|en)(?:\/|$)/i.exec(u.pathname)?.[1].toLowerCase() || "fr";
  return { origin: u.origin, lang, brand: "Abylsen" };
}

/** Segment d'URL d'une offre, calculé comme l'application : « Chef de projet R&D X/ F/H » → chef-de-projet-r&d-x-f-h. */
function abylsenSlug(title) {
  const slug = title
    .replace(/\//g, " ")
    .replace(/\s\s+/g, " ")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/’/g, "-");
  return encodeURIComponent(slug).replace(/%26/g, "&");
}

async function fetchAbylsen(ab, { maxJobs }) {
  const api = `${ab.origin}/backendLaravel/public/api/jobs/v1`;
  const criteria = (locations) => ({
    language: "",
    title: "",
    typesOfContract: [],
    sectors: [],
    countries: [],
    locations,
    companies: [ab.brand],
  });
  const counts = (await postJson(`${api}/counts?lg=${ab.lang}`, criteria([])))?.locations || {};
  const local = Object.keys(counts).filter((place) => counts[place] > 0 && isLocalPlace(place));
  if (!local.length) return [];

  const candidates = [];
  for (let from = 0; candidates.length < maxJobs; from += ABYLSEN_PAGE_SIZE) {
    const jobs = await postJson(`${api}/search?from=${from}&nb=${ABYLSEN_PAGE_SIZE}&lg=${ab.lang}`, criteria(local));
    if (!Array.isArray(jobs) || !jobs.length) break;
    for (const j of jobs) {
      if (!j?.title || !j.uid) continue;
      candidates.push({
        title: j.title.replace(/\s+/g, " ").trim(),
        url: `${ab.origin}/job/${abylsenSlug(j.title)}/${encodeURIComponent(j.uid)}`,
        location: j.location || "",
        date: j.startDate || null,
        contractType: j.contractType || null,
        experience: j.experience || null,
      });
    }
    if (jobs.length < ABYLSEN_PAGE_SIZE) break;
  }
  return candidates;
}

// Randstad Digital (randstaddigital.fr) : chaque page de résultats embarque la réponse
// du moteur de recherche, 30 offres par page (les suivantes sous …/page-2/, …/page-3/) :
//   window.__ROUTE_DATA__ = { searchResults: { hits: { total, hits: [{ _source }] } } }

const RANDSTAD_MAX_PAGES = 10;

export function parseRandstadUrl(url) {
  const u = safeUrl(url);
  if (!u || !/^(www\.)?randstaddigital\.fr$/i.test(u.hostname)) return null;
  const m = /^(.*?\/toutes-nos-offres\/)(.*?)(?:page-\d+\/?)?$/.exec(u.pathname);
  if (!m) return null;
  return { origin: u.origin, root: m[1], listing: `${m[1]}${m[2]}`.replace(/\/?$/, "/") };
}

/** Objet JSON affecté à une variable par un script inline (`window.__ROUTE_DATA__ = {…}`). */
function embeddedJson(html, marker) {
  const at = html.indexOf(marker);
  const start = at < 0 ? -1 : html.indexOf("{", at + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function fetchRandstad(rd) {
  const byUrl = new Map();
  let fetched = 0;
  let total = Infinity;
  for (let page = 1; page <= RANDSTAD_MAX_PAGES && fetched < total; page++) {
    const html = await requestText(`${rd.origin}${rd.listing}${page > 1 ? `page-${page}/` : ""}`);
    const hits = embeddedJson(html, "window.__ROUTE_DATA__")?.searchResults?.hits;
    const list = Array.isArray(hits?.hits) ? hits.hits : [];
    if (!list.length) break;
    fetched += list.length;
    total = Number(hits.total?.value ?? hits.total) || 0;
    for (const hit of list) {
      const s = hit?._source || {};
      const title = s.JobInformation?.Title || s.BlueXJobData?.Title;
      const id = s.JobIdentity?.DovaJobId || hit._id;
      const slug = s.BlueXSanitized || {};
      if (!title || !id || !slug.Title) continue;
      // Même URL que les cartes de la page : /toutes-nos-offres/{titre}_{ville}_{id}/
      const url = `${rd.origin}${rd.root}${[slug.Title, slug.City, id].filter(Boolean).join("_")}/`;
      const loc = s.JobLocation || {};
      byUrl.set(url, {
        title: title.replace(/\s+/g, " ").trim(),
        url,
        location: [loc.City || loc.DerivedCity, loc.Postcode].filter(Boolean).join(" "),
        date: s.JobDates?.DateCreated || null,
        contractType: s.JobInformation?.JobType || null,
      });
    }
  }
  return [...byUrl.values()];
}

// --- Dispatcher ---------------------------------------------------------------

const CONNECTORS = [
  // Workday filtre déjà côté serveur (facette de localisation).
  { id: "workday", parse: parseWorkdayUrl, fetch: fetchWorkday, filtered: true },
  { id: "greenhouse", parse: parseGreenhouseUrl, fetch: fetchGreenhouse },
  { id: "lever", parse: parseLeverUrl, fetch: fetchLever },
  { id: "recruitee", parse: parseRecruiteeUrl, fetch: fetchRecruitee },
  { id: "smartrecruiters", parse: parseSmartRecruitersUrl, fetch: fetchSmartRecruiters },
  // Yello interroge un lieu de la zone à la fois.
  { id: "yello", parse: parseYelloUrl, fetch: fetchYello, filtered: true },
  { id: "abylsen", parse: parseAbylsenUrl, fetch: fetchAbylsen, ownSite: true },
  { id: "randstad-digital", parse: parseRandstadUrl, fetch: fetchRandstad, ownSite: true },
];

/** Reconnaît une URL d'ATS pris en charge. */
export function detectAts(url) {
  for (const connector of CONNECTORS) {
    const params = connector.parse(url);
    if (params) return { connector, params, url };
  }
  return null;
}

/** ATS référencé par le lien d'une page (hors sites d'offres propres à un employeur). */
function detectLinkedAts(url) {
  const ats = detectAts(url);
  return ats && !ats.connector.ownSite ? ats : null;
}

// URL d'ATS citée dans un script inline ou un attribut data-* (widgets chargés en JS).
const ATS_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:greenhouse\.io|lever\.co|recruitee\.com|smartrecruiters\.com|myworkdayjobs\.com|yello\.co)\/[^\s"'<>\\)]*/gi;

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
    found = detectLinkedAts(full);
    if (found) return false;
  });
  if (found) return found;
  const html = $.html().replace(/\\\//g, "/");
  for (const [url] of html.matchAll(ATS_URL_RE)) {
    found = detectLinkedAts(url.replace(/&amp;/g, "&"));
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
  // Une offre multi-sites n'affiche que son premier lieu (« Marseille, FR +1 more… ») ;
  // la recherche par lieu (?locationsearch=Nice) garantit que l'un des autres correspond.
  const searched = safeUrl(pageUrl)?.searchParams.get("locationsearch")?.trim() || "";
  const searchedIsLocal = isLocalPlace(searched);
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
    const cell = $(row).find(".jobLocation").first();
    let location = cell.text().replace(/\s+/g, " ").trim();
    if (searchedIsLocal && /\+\s*\d+/.test(cell.find("small").text())) location = `${searched} / ${location}`;
    candidates.push({
      title,
      url,
      location,
      date: $(row).find(".jobDate").first().text().replace(/\s+/g, " ").trim(),
      context: "",
      trusted: true,
    });
  });
  return candidates;
}
