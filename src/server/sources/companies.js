import * as cheerio from "cheerio";
import {
  fetchWithTimeout,
  normalizeJob,
  tokenize,
  normalizeText,
  parseLooseDate,
} from "../util.js";
import { detectLocation } from "../geo.js";
import { detectAts, findAtsInPage, fetchAtsCandidates, extractSuccessFactorsRows } from "./ats.js";
import { SOPHIA_COMPANIES, CRAWLABLE_COMPANIES, careerSitesOf, companyNames, findCompany } from "../../data/companies.js";

// Chemins fréquents de pages carrières à tester en fallback (si la découverte auto échoue).
const CAREER_PATHS = [
  "/careers",
  "/carrieres",
  "/carriere",
  "/jobs",
  "/recrutement",
  "/nous-rejoindre",
  "/join-us",
  "/fr/carrieres",
  "/fr/jobs",
];

// Mots indiquant un lien vers une PAGE carrières/emploi (pas une offre précise).
const CAREER_HINTS = [
  "career", "careers", "carriere", "carrieres", "emploi", "emplois",
  "recrut", "nous rejoindre", "rejoignez", "join us", "join-us",
  "nos offres", "offres d'emploi", "jobs", "we're hiring", "hiring",
  "travailler chez", "work with us", "postes",
];

// Garde-fous : nombre d'offres retenues et de pages parcourues par entreprise.
const MAX_OFFERS_PER_COMPANY = 40;
const MAX_PAGES_PER_COMPANY = 6;

const STOPWORDS = new Set([
  "de", "du", "la", "le", "les", "des", "un", "une", "et", "en", "au", "aux",
  "pour", "sur", "dans", "par", "avec", "chez", "the", "of", "and", "for",
]);

// Marqueurs d'intitulé d'offre, testés sur des mots entiers : en sous-chaîne,
// « microsoft.com/fr » passait pour un « m/f » et « at any stage » pour un stage.
const GENDER_MARKER_RE =
  /(?:^|[^a-z0-9])(?:[hf]\s*[/-]\s*[hf]|[mfw]\s*\/\s*[mfw])(?:\s*\/\s*(?:x|d|nb))?(?![a-z0-9])/;
const CONTRACT_WORDS =
  "cdi|cdd|stage|stagiaire|alternance|alternant|apprentissage|apprenti|freelance|internship|intern|interim";
const CONTRACT_MARKER_RE = new RegExp(`\\b(?:${CONTRACT_WORDS})\\b`);
const CONTRACT_MARKER_ALL_RE = new RegExp(`\\b(?:${CONTRACT_WORDS})\\b`, "g");

// Mots de rubrique : « Stage et alternance » ou « Offres de stage » sont des catégories.
const CATEGORY_WORDS = new Set([
  "offre", "offres", "nos", "poste", "postes", "emploi", "emplois", "job", "jobs",
  "opportunites", "opportunities", "programme", "program", "etudiants", "students",
  "jeunes", "diplomes", "graduates", "candidature", "candidatures", "contrat", "contrats",
]);

// Libellés d'action ou de rubrique en début de lien (jamais des intitulés d'offre).
const GENERIC_START_RE =
  /^(?:explore[rz]?|discover|decouvr\w*|rechercher|see|view|voir|learn|en savoir|lire|read|meet|rencontr\w*|our|nos|notre|why|pourquoi|how|comment|life at|la vie|working at|travailler|join|rejoign\w*|apply|postuler|candidature|spontan\w*|all jobs|toutes les offres|tous les postes|retour|suivant|precedent|filtr\w*|trier|open positions|domaines? d)\b/;
// Contenus éditoriaux des sites carrières (témoignages, FAQ, avantages…).
const NOISE_RE =
  /\b(?:stor(?:y|ies)|temoignages?|faq|blog|podcasts?|webinars?|conseils|tips|benefits|avantages|culture|values|valeurs|diversite|diversity|inclusion|locations|newsletter|cookies?|privacy|confidentialite|mentions legales|login|sign in|connexion|inscription|alertes?|subscribe|abonne\w*|rss|ma selection)\b/;
const LISTING_COUNT_RE = /\b\d+\s+(?:offres?|job openings?|jobs?|vacanc(?:y|ies)|postes?)\b/;

// Mots de navigation à exclure des faux intitulés.
const NAV_NOISE = [
  "accueil", "home", "contact", "blog", "actualite", "actualites", "news",
  "mentions legales", "politique", "cookies", "connexion", "login", "panier",
  "a propos", "about", "produits", "solutions", "services", "demo", "newsletter",
  "linkedin", "twitter", "facebook", "instagram", "youtube", "plan du site",
  "cgv", "cgu", "faq", "partenaires", "clients", "equipe", "team", "nos valeurs",
];

// Chemins d'offre individuelle (/jobs/developpeur-java, /offre/12345, /offres/details/DevOps_8,
// /offres-emploi/78/developpeur-php.htm…).
const OFFER_PATH_RE =
  /\/(?:jobs?|offres?|offres?-(?:d-)?emplois?|emplois?|postes?|careers?|carrieres?|job-offer|job-details|vacanc(?:y|ies)|vacature|opportunit(?:y|ies)|positions?|annonces?)\/(?:(?:details?|view|show|fiche|\d+)\/)?(?:[^/?#]*-[^/?#]*|[^/?#]*\d{4,}[^/?#]*|[^/?#]+_\d+)/;
const OFFER_SLUG_RE =
  /(?:^|[^a-z0-9])(?:h-f|f-h|hf|fh|m-f|cdi|cdd|alternance|stage|stagiaire|internship)(?:[^a-z0-9]|$)/;
// Chemins de rubriques (listes, catégories, contenus) qui ne sont pas des offres.
const LISTING_PATH_RE =
  /\/(?:search|recherche|categor(?:y|ies)|locations?|teams?|departments?|students?|graduates?|faq|benefits|culture|blog|news|events?|stories|about|contact|login|alerts?|saved|favorites)(?:\/|$)/;

// Pagination et variantes de langue d'une même page de résultats.
const PAGINATION_PATH_RE = /\/page\/\d+\/?$/i;
const PAGINATION_QUERY_RE = /[?&](?:page|paged|p|pg|startrow|start|offset|from)=\d+/i;
const LOCALE_RE = /[?&](?:locale|lang|language|hl)=[a-z]{2}(?:[_-][a-z]{2})?(?:&|$)/i;
// Liens de filtres (« CDI (65) », « France (84) ») des moteurs de recherche d'offres.
const FACET_QUERY_RE = /[?&](?:changefacet|facet_[a-z]+|facets?|refine|filters?)=/i;
const FACET_COUNT_RE = /\(\d+\)$/;

function normalize(s) {
  return normalizeText(s);
}

const padWords = (t) => ` ${t.replace(/[^a-z0-9]+/g, " ").trim()} `;

// Certaines pages (catalogues, SPA) pèsent plusieurs Mo : les charger entièrement
// dans cheerio, à 12 en parallèle, suffit à faire tomber le conteneur sur un NAS.
// On lit donc le corps en streaming avec un budget d'octets.
const MAX_HTML_BYTES = 1_500_000;

/**
 * Décode le HTML avec le jeu de caractères annoncé (en-tête HTTP ou balise meta).
 * Forcer l'UTF-8 transformait les accents des sites en windows-1252 en « � ».
 */
function decodeHtml(buf, contentType) {
  const declared = (
    /charset=["']?([\w-]+)/i.exec(contentType || "")?.[1] ||
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString("latin1"))?.[1] ||
    ""
  ).toLowerCase();
  const decode = (encoding) => {
    try {
      return new TextDecoder(encoding).decode(buf);
    } catch {
      return null;
    }
  };
  const text = (declared && decode(declared)) || decode("utf-8");
  // Page latin-1 servie sans charset (ou annoncée à tort en UTF-8).
  if ((!declared || /utf-?8/.test(declared)) && (text.match(/\uFFFD/g) || []).length > 3) {
    return decode("windows-1252") || text;
  }
  return text;
}

async function readHtmlCapped(res) {
  if (!res.body) return (await res.text()).slice(0, MAX_HTML_BYTES);
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (bytes < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    // Libère la connexion même si on s'arrête avant la fin du document.
    reader.cancel().catch(() => {});
  }
  return decodeHtml(Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES), res.headers.get("content-type"));
}

/** Charge une page HTML ; ne lève jamais d'exception. */
async function loadPage(url) {
  try {
    const res = await fetchWithTimeout(url);
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.includes("html")) {
      res.body?.cancel().catch(() => {});
      return { ok: false, error: res.ok ? "contenu non HTML" : `HTTP ${res.status}` };
    }
    const html = await readHtmlCapped(res);
    return { ok: true, url: res.url || url, $: cheerio.load(html) };
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? "timeout" : err.message };
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function withoutHash(url) {
  return url.split("#")[0];
}

/** Chemin décodé d'une URL (les slugs portent souvent la ville : /job/Valbonne-…). */
function urlPath(url) {
  try {
    const { pathname } = new URL(url);
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  } catch {
    return "";
  }
}

/**
 * Gabarit d'URL : premier segment, puis nature des suivants (numérique « # »,
 * avec identifiant « x# », texte « x ») :
 *   /offres-emploi/78/developpeur-php.htm → "offres-emploi/#/x"
 *   /offre-de-emploi/emploi-testeur_5447.aspx → "offre-de-emploi/x#"
 */
function urlShape(url) {
  const segments = urlPath(url).toLowerCase().split("/").filter(Boolean);
  if (segments.length < 2) return "";
  const kind = (s) => (/^\d+$/.test(s) ? "#" : /\d/.test(s) ? "x#" : "x");
  return [segments[0], ...segments.slice(1).map(kind)].join("/");
}

function isCareerLink(text, href) {
  const t = normalize(text);
  const h = normalize(href);
  return CAREER_HINTS.some((k) => t.includes(k) || h.includes(k));
}

/** L'intitulé porte-t-il un marqueur d'offre (H/F, CDI, stage…) ? */
function looksLikeOffer(text) {
  const t = normalize(text);
  return GENDER_MARKER_RE.test(t) || CONTRACT_MARKER_RE.test(t);
}

function hasNavNoise(t) {
  // Menus et pieds de page : libellés courts (« Nos solutions », « Services »). Un
  // intitulé long peut contenir ces mots (« … - Digital Platform Services - Biot »).
  const words = t.split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w));
  if (words.length > 4) return false;
  const padded = padWords(t);
  return NAV_NOISE.some((n) => padded.includes(` ${n} `));
}

/**
 * Qualifie le texte d'un lien : "offer" (marqueur explicite), "maybe" (à confirmer
 * par l'URL) ou "reject" (navigation, FAQ, témoignage, rubrique…).
 */
function classifyTitle(text) {
  const t = normalize(text);
  if (FACET_COUNT_RE.test(t)) return "reject";
  // Compteurs de listes (« Ma sélection : 0 offre(s) », « Selection: 0 job opening(s) »).
  if (LISTING_COUNT_RE.test(t) && t.split(/\s+/).length <= 6) return "reject";
  if (GENDER_MARKER_RE.test(t)) return "offer";
  if (/[?!]$/.test(t) || t.split(/\s+/).length > 14) return "reject";
  if (GENERIC_START_RE.test(t) || NOISE_RE.test(t) || hasNavNoise(t)) return "reject";
  if (CONTRACT_MARKER_RE.test(t)) {
    const rest = t
      .replace(CONTRACT_MARKER_ALL_RE, " ")
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !CATEGORY_WORDS.has(w));
    return rest.length ? "offer" : "reject";
  }
  return "maybe";
}

function plausibleTitle(text) {
  // Les séparateurs isolés (« - », « & ») ne comptent pas comme des mots.
  const words = text.split(" ").filter((w) => /[\p{L}\d]/u.test(w));
  return (
    words.length <= 12 &&
    /[a-zA-ZÀ-ÿ]{3,}/.test(text) &&
    !isCareerLink(text, "")
  );
}

/**
 * Texte d'un nœud avec un espace entre éléments : `.text()` colle les blocs
 * (« CDI » + « Ile-de-France » → « CDIIle-de-France ») et masque le lieu.
 */
function spacedText(node) {
  const parts = [];
  const walk = (el) => {
    for (const child of el.children || []) {
      if (child.type === "text") parts.push(child.data);
      else if (child.type === "tag") walk(child);
    }
  };
  node.each((_, el) => walk(el));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Texte du plus petit bloc englobant le lien (carte d'offre : lieu, contrat…). */
function linkContext($, el) {
  let node = $(el).parent();
  let context = "";
  for (let depth = 0; depth < 4 && node.length; depth++) {
    const text = spacedText(node);
    if (text.length > 400) break;
    context = text;
    node = node.parent();
  }
  return context;
}

/**
 * Étape 1 : à partir du HTML de la home, découvre les URLs des pages carrières.
 */
function discoverCareerUrls($, baseUrl) {
  const urls = new Set();
  $("a[href]").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    const href = $(el).attr("href");
    if (!href) return;
    if (isCareerLink(text, href)) {
      try {
        urls.add(new URL(href, baseUrl).href);
      } catch {
        /* ignore */
      }
    }
  });
  return [...urls];
}

/**
 * Pages suivantes et variantes de langue d'une page de résultats (même chemin).
 * Les liens de facettes (autres villes, tris…) sont volontairement ignorés : ils
 * sortent du périmètre de la recherche pré-filtrée.
 */
function listingVariants($, pageUrl) {
  const listingPath = (p) => p.replace(/\/page\/\d+\/?$/i, "/").replace(/\/+$/, "") || "/";
  let base;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  base.hash = "";
  const basePath = listingPath(base.pathname);
  const found = new Map();
  $("a[href]").each((_, el) => {
    let u;
    try {
      u = new URL($(el).attr("href"), base);
    } catch {
      return;
    }
    u.hash = "";
    if (u.hostname !== base.hostname || listingPath(u.pathname) !== basePath) return;
    if (u.href === base.href || found.has(u.href)) return;
    if (PAGINATION_PATH_RE.test(u.pathname) || PAGINATION_QUERY_RE.test(u.search)) found.set(u.href, 0);
    else if (LOCALE_RE.test(u.search)) found.set(u.href, 1);
  });
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([href]) => href);
}

/**
 * Étape 2 : sur une page, extrait les liens candidats (intitulé + URL + contexte).
 * @param {boolean} isCareerPage true si la page est identifiée comme une page carrières
 *        (dans ce cas un lien sans marqueur est accepté si son URL désigne une offre).
 */
function extractCandidates($, pageUrl, isCareerPage) {
  const successFactors = extractSuccessFactorsRows($, pageUrl);
  if (successFactors) return successFactors;

  const pageHost = hostOf(pageUrl);
  const pageKey = withoutHash(pageUrl);
  const candidates = [];
  $("a[href]").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (!text || text.length < 4 || text.length > 130) return;
    // Rejette les artefacts (code CSS/JS capté dans le texte du lien).
    if (/[{}<>;]|fill:|\.st\d|function|var\s|=>/.test(text)) return;
    const href = $(el).attr("href");
    if (!href || /^(?:mailto|tel|javascript):/i.test(href)) return;

    let full;
    try {
      full = new URL(href, pageUrl).href;
    } catch {
      return;
    }
    if (withoutHash(full) === pageKey) return;

    const kind = classifyTitle(text);
    if (kind === "reject") return;
    const path = normalize(urlPath(full));
    if (LISTING_PATH_RE.test(path) || FACET_QUERY_RE.test(full)) return;
    let weak = false;
    if (kind === "maybe") {
      // Sans marqueur : uniquement sur une page carrières, vers le même site. Sans
      // chemin d'offre reconnaissable, le lien reste "faible" : il n'est retenu que
      // s'il suit le gabarit d'URL d'offres confirmées de la même page.
      if (!(isCareerPage && hostOf(full) === pageHost && plausibleTitle(text))) return;
      weak = !(OFFER_PATH_RE.test(path) || OFFER_SLUG_RE.test(path));
    }

    candidates.push({ title: text, url: full, context: linkContext($, el), weak });
  });
  return candidates;
}

/**
 * Étape 3 : transforme les candidats en offres normalisées.
 *  - filtre de marque (sites de groupe multi-enseignes),
 *  - exclusion des offres explicitement situées hors des Alpes-Maritimes,
 *  - déduplication par intitulé (un même poste publié dans plusieurs langues),
 *  - priorité aux offres "confirmées" (marqueur H/F, CDI…) sur les liens incertains.
 */
function buildOffers(candidates, company) {
  let pool = company.offerUrlFilter
    ? candidates.filter((c) => c.url.includes(company.offerUrlFilter))
    : candidates;
  const isConfirmed = (c) => c.trusted || looksLikeOffer(c.title);
  if (pool.some(isConfirmed)) {
    // Liens sans marqueur H/F conservés s'ils suivent le gabarit d'URL des offres
    // confirmées de la page (/offres-emploi/8/embarque.htm comme /offres-emploi/78/…-h-f.htm).
    // Les offres d'API d'ATS ne servent pas de modèle : leurs URLs ne disent rien du menu du site.
    const shapes = new Set(
      pool.filter((c) => !c.trusted && looksLikeOffer(c.title)).map((c) => urlShape(c.url)).filter(Boolean)
    );
    pool = pool.filter((c) => isConfirmed(c) || shapes.has(urlShape(c.url)));
  } else {
    pool = pool.filter((c) => !c.weak);
  }

  const located = pool.map((c) => {
    const parts = [c.location, c.title, urlPath(c.url), c.context];
    return { c, parts, place: detectLocation(parts) };
  });
  // Liste multi-sites (ESN, grands groupes) : dès qu'une part notable des offres est
  // située hors zone, une offre sans lieu local explicite peut être n'importe où.
  // `localOnly` force ce mode pour les employeurs connus pour publier nationalement.
  const distant = located.filter((x) => x.place.verdict === "distant").length;
  const multiSite = Boolean(company.localOnly) || distant >= Math.max(2, located.length * 0.25);
  const fallbackLocation = detectLocation([company.city]).label || "Sophia Antipolis";
  const byTitle = new Map();
  for (const { c, parts, place } of located) {
    if (place.verdict === "distant") continue;
    // Lieu limité à « Provence-Alpes-Côte d'Azur » : accepté, sauf localOnly.
    const regional = place.region && !company.localOnly;
    if (multiSite && place.verdict !== "local" && !regional && !c.trusted) continue;
    const key = normalize(c.title).replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || byTitle.has(key)) continue;
    byTitle.set(
      key,
      normalizeJob({
        title: c.title,
        company: company.name,
        location: preciseLocalLabel(place, parts) || fallbackLocation,
        url: c.url,
        source: `Entreprise: ${company.name}`,
        date: parseLooseDate(c.date),
        // Fournis par certains ATS ; à défaut, déduits de l'intitulé.
        contractType: c.contractType || null,
        experience: c.experience || null,
      })
    );
  }
  return [...byTitle.values()];
}

/** « Valbonne » plutôt que « Alpes-Maritimes » quand un autre indice précise la commune. */
function preciseLocalLabel(place, parts) {
  if (place.verdict !== "local") return null;
  if (place.label && place.label !== "Alpes-Maritimes") return place.label;
  for (const part of parts) {
    const found = detectLocation([part]);
    if (found.verdict === "local" && found.label && found.label !== "Alpes-Maritimes") return found.label;
  }
  return place.label;
}

/** Page carrières connue (souvent une recherche déjà filtrée sur la zone). */
async function scanCareerSite(careerSite, result) {
  const first = await loadPage(careerSite);
  if (!first.ok) {
    result.error = result.error || first.error;
    return { candidates: [], reached: false };
  }
  result.careerUrls.push(careerSite);
  const candidates = extractCandidates(first.$, first.url, true);
  // Page carrières "vitrine" qui intègre un ATS (widget Greenhouse, lien Workday…).
  const ats = findAtsInPage(first.$, first.url);
  if (ats) {
    try {
      candidates.push(...(await fetchAtsCandidates(ats, { maxJobs: MAX_OFFERS_PER_COMPANY + 1 })));
    } catch (err) {
      result.error = `${ats.connector.id} : ${err.message}`;
    }
  }
  for (const url of listingVariants(first.$, first.url).slice(0, MAX_PAGES_PER_COMPANY - 1)) {
    if (candidates.filter((c) => !c.weak).length >= MAX_OFFERS_PER_COMPANY * 3) break;
    const page = await loadPage(url);
    if (!page.ok) continue;
    result.careerUrls.push(url);
    candidates.push(...extractCandidates(page.$, page.url, true));
  }
  return { candidates, reached: true };
}

/** Site corporate : découverte des pages carrières depuis la home (+ chemins devinés). */
async function scanCorporateSite(company, result) {
  const base = company.site.replace(/\/$/, "");
  let reached = false;
  let discovered = [];
  // Beaucoup de startups renvoient vers un ATS (Lever, Greenhouse…) : on interroge
  // alors directement son API plutôt que la page JavaScript.
  let ats = null;

  const home = await loadPage(base);
  if (home.ok) {
    reached = true;
    discovered = discoverCareerUrls(home.$, home.url);
    ats = findAtsInPage(home.$, home.url);
  } else {
    result.error = home.error;
  }

  const careerSet = new Set(discovered);
  const siteHost = hostOf(home.ok ? home.url : base);
  const guessed = CAREER_PATHS.map((p) => base + p);
  const pagesToScan = [...new Set([...discovered, ...guessed])]
    // On reste sur le même domaine pour éviter de scraper LinkedIn/WTTJ ici.
    .filter((u) => hostOf(u) === siteHost)
    .slice(0, MAX_PAGES_PER_COMPANY);

  const candidates = [];
  for (const url of pagesToScan) {
    const page = await loadPage(url);
    if (!page.ok) continue;
    reached = true;
    result.careerUrls.push(url);
    ats = ats || findAtsInPage(page.$, page.url);
    // Une URL est "page carrières" si découverte via un lien carrières OU si son
    // chemin contient un mot-clé carrières (career, carriere, emploi, jobs, recrut…).
    const isCareerPage =
      careerSet.has(url) || /career|carriere|emploi|jobs|recrut|rejoindre/.test(normalize(url));
    candidates.push(...extractCandidates(page.$, page.url, isCareerPage));
    if (candidates.filter((c) => looksLikeOffer(c.title)).length >= MAX_OFFERS_PER_COMPANY) break;
  }

  if (ats) {
    try {
      candidates.push(...(await fetchAtsCandidates(ats, { maxJobs: MAX_OFFERS_PER_COMPANY + 1 })));
      result.careerUrls.unshift(ats.url);
    } catch (err) {
      result.error = result.error || `${ats.connector.id} : ${err.message}`;
    }
  }
  return { candidates, reached };
}

/**
 * Collecte les offres d'une entreprise :
 *  - ATS pris en charge (Workday, Greenhouse, Lever…) : API JSON publique,
 *  - page carrières connue (`careerSite`) : cette page, sa pagination et ses langues,
 *  - sinon : découverte des pages carrières depuis le site corporate.
 * Plusieurs `careerSite` (ex. EY : jeunes diplômés et expérimentés) sont cumulés.
 *
 * @returns {Promise<{jobs: Array, truncated: boolean, status: string, careerUrls: string[], error: string|null, tookMs: number}>}
 */
export async function scrapeCompany(company) {
  const started = Date.now();
  const result = {
    name: company.name,
    site: company.site || null,
    jobs: [],
    // Plus d'offres que le plafond par entreprise : l'IHM affiche « 40+ ».
    truncated: false,
    status: "no-site",
    careerUrls: [],
    error: null,
    tookMs: 0,
    checkedAt: new Date().toISOString(),
  };

  const careerSites = careerSitesOf(company);
  if (!company.site && !careerSites.length) return result;

  const describe = (err) => (err.name === "AbortError" ? "timeout" : err.message);
  let candidates = [];
  let reached = false;
  try {
    for (const careerSite of careerSites) {
      // Une source en échec n'empêche pas de lire les suivantes.
      try {
        const ats = detectAts(careerSite);
        if (ats) {
          candidates.push(...(await fetchAtsCandidates(ats, { maxJobs: MAX_OFFERS_PER_COMPANY + 1 })));
          reached = true;
          result.careerUrls.push(careerSite);
        } else {
          const scan = await scanCareerSite(careerSite, result);
          candidates.push(...scan.candidates);
          reached = reached || scan.reached;
        }
      } catch (err) {
        result.error = result.error || describe(err);
      }
    }
    if (!careerSites.length) ({ candidates, reached } = await scanCorporateSite(company, result));
  } catch (err) {
    result.error = describe(err);
  }

  const offers = buildOffers(candidates, company);
  result.truncated = offers.length > MAX_OFFERS_PER_COMPANY;
  result.jobs = offers.slice(0, MAX_OFFERS_PER_COMPANY);
  result.tookMs = Date.now() - started;
  result.careerUrls = result.careerUrls.slice(0, 5);

  if (result.jobs.length) result.status = "ok";
  else if (reached) result.status = "no-offer";
  else result.status = "unreachable";

  return result;
}

/**
 * Scrape l'ensemble des entreprises (par lots) pour alimenter le cache.
 *
 * @param {object} options
 * @param {(done:number,total:number,current:string[]) => void} [options.onProgress]
 * @param {(jobs:Array,stats:Array) => Promise<void>} [options.onCheckpoint] appelé
 *        périodiquement pour persister le travail déjà effectué.
 * @param {number} [options.checkpointEvery] nombre d'entreprises entre deux sauvegardes
 * @param {number} [options.concurrency] nombre d'entreprises traitées en parallèle
 * @returns {Promise<{jobs: Array, stats: Array}>} offres détectées + statut par entreprise
 */
export async function crawlAllCompanies({
  onProgress,
  onCheckpoint,
  checkpointEvery = 200,
  concurrency = 12,
} = {}) {
  const targets = CRAWLABLE_COMPANIES;
  const jobs = [];
  const stats = [];
  let index = 0;
  let done = 0;
  const inFlight = new Set();

  const runner = async () => {
    while (index < targets.length) {
      const company = targets[index++];
      inFlight.add(company.name);
      try {
        const res = await scrapeCompany(company);
        jobs.push(...res.jobs);
        stats.push({
          name: res.name,
          site: res.site,
          status: res.status,
          jobs: res.jobs.length,
          truncated: res.truncated,
          careerUrls: res.careerUrls,
          error: res.error,
          tookMs: res.tookMs,
          checkedAt: res.checkedAt,
        });
      } catch (err) {
        stats.push({
          name: company.name,
          site: company.site,
          status: "error",
          jobs: 0,
          careerUrls: [],
          error: err.message,
          tookMs: 0,
          checkedAt: new Date().toISOString(),
        });
      } finally {
        inFlight.delete(company.name);
        done++;
        if (onProgress) onProgress(done, targets.length, [...inFlight]);
        if (onCheckpoint && done % checkpointEvery === 0) {
          try {
            await onCheckpoint(jobs, stats);
          } catch (err) {
            console.error("[crawl] checkpoint échoué :", err.message);
          }
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => runner())
  );

  // Les entreprises non crawlées (sans site, ou site inexploitable) sont tracées
  // quand même pour que le catalogue affiche une couverture honnête.
  const crawled = new Set(targets);
  for (const c of SOPHIA_COMPANIES) {
    if (crawled.has(c)) continue;
    stats.push({
      name: c.name,
      site: c.site || null,
      status: c.crawl === false ? "link-only" : "no-site",
      jobs: 0,
      careerUrls: c.careerUrl ? [c.careerUrl] : [],
      error: null,
      tookMs: 0,
      checkedAt: null,
    });
  }

  return { jobs, stats };
}

// Premiers mots trop vagues pour désigner seuls un employeur : articles, civilités,
// formes juridiques, lieux, types d'établissement, vocabulaire métier. L'employeur
// reste trouvable par son nom complet (« air france », « pro btp »).
const GENERIC_LEAD_WORDS = new Set([
  "les", "the", "chez", "all", "rsquo", "amp",
  "monsieur", "madame", "mme", "docteur", "maitre",
  "sarl", "sas", "sasu", "eurl", "snc", "scm", "sccv", "sci", "scp", "selarl", "selas", "gie",
  "soc", "societe", "ste", "ets", "etablissements", "cie", "compagnie", "indivision", "holding",
  "groupe", "group", "ass", "asso", "association", "comite", "club", "fondation", "federation",
  "azur", "cote", "sophia", "antipolis", "riviera", "valbonne", "biot", "antibes", "mougins",
  "vallauris", "cannes", "nice", "grasse", "mouans", "saint", "sainte", "sud", "provence",
  "mediterranee", "alpes", "france", "europe", "euro", "international", "global",
  "agence", "atelier", "auto", "banque", "boulangerie", "bureau", "cabinet", "cafe", "caisse",
  "camping", "centre", "center", "ctre", "chateau", "clinique", "college", "credit", "ecole",
  "ehpad", "fonciere", "financiere", "garage", "hotel", "hoteliere", "inst", "institut",
  "laboratoire", "laboratoires", "lycee", "mairie", "maison", "mediatheque", "mission", "musee",
  "mutuelle", "office", "parc", "park", "pharmacie", "residence", "restaurant", "studio", "villa",
  "air", "pro", "bus", "art", "conseil", "consulting", "data", "digital", "design", "info",
  "informatique", "services", "service", "software", "solutions", "systems", "tech", "web",
  "developpement", "formation", "ingenierie", "engineering", "securite", "security", "sante",
  "medical", "transport", "transports", "immobilier", "management", "marketing",
  "communication", "business", "innovation", "recherche", "research", "energie", "industrie",
  "environnement", "interim", "recrutement", "emploi", "travaux", "batiment", "construction",
  "logistique", "assurance", "assurances", "finance", "technologies", "technology", "media",
]);

// Appellations des employeurs exploitables dans une recherche, mémorisées par nom.
const employerNamesCache = new Map();

/**
 * Comment une recherche peut désigner un employeur :
 *  - `phrases` : ses noms et alias complets (« orange business services ») ;
 *  - `words`   : les mots qui le désignent seuls — nom ou alias d'un seul mot
 *    (« ausy », « nxp »), premier mot distinctif d'un nom composé (« sopra », « toyota »).
 * Les autres mots d'un nom ne suffisent pas : sinon chercher « santé » remontait toutes
 * les offres du GIEPS (« Asaf Ass Sante Action Familial »), « security » toutes celles
 * de Sopra Steria.
 */
function employerNames(name) {
  let names = employerNamesCache.get(name);
  if (names) return names;
  const entry = findCompany(name);
  const phrases = [];
  const words = new Set();
  for (const n of new Set([name, ...(entry ? companyNames(entry.name) : [])])) {
    const toks = tokenize(n);
    if (!toks.length) continue;
    if (toks.length > 1) phrases.push(toks);
    const lead = toks[0];
    const distinctive = toks.length === 1 || (lead.length >= 3 && !/^\d+$/.test(lead));
    if (distinctive && !GENERIC_LEAD_WORDS.has(lead)) words.add(lead);
  }
  names = { phrases, words };
  // Noms bruts des job boards : borne la mémoire sur un serveur qui tourne des mois.
  if (employerNamesCache.size > 5000) employerNamesCache.clear();
  employerNamesCache.set(name, names);
  return names;
}

/**
 * Positions des mots de la requête (issus de `tokenize`) qui désignent l'employeur :
 * « java amadeus » → {1} pour Amadeus, « orange business » → {0, 1} pour Orange.
 */
export function employerMatches(name, tokens) {
  const hits = new Set();
  if (!name || !tokens.length) return hits;
  const { phrases, words } = employerNames(name);
  tokens.forEach((t, i) => {
    if (words.has(t)) hits.add(i);
  });
  for (const p of phrases) {
    for (let i = 0; i + p.length <= tokens.length; i++) {
      if (p.every((w, k) => tokens[i + k] === w)) p.forEach((_, k) => hits.add(i + k));
    }
  }
  return hits;
}

/**
 * Recherche dans le cache d'offres d'entreprises (filtre en mémoire, instantané).
 * Chaque mot significatif doit apparaître dans l'intitulé ou désigner l'employeur
 * (« java amadeus », « sopra », « ausy », « orange business »). Les mots vides sont
 * ignorés pour éviter les faux positifs (ex: "de", "chef DE projet").
 */
export function searchCompanyCache(cachedJobs, query) {
  const tokens = tokenize(query);
  const significant = [...tokens.keys()].filter((i) => !STOPWORDS.has(tokens[i]));
  if (significant.length === 0) return [];
  return cachedJobs.filter((j) => {
    const title = normalizeText(j.title);
    const employer = employerMatches(j.company, tokens);
    return significant.every((i) => title.includes(tokens[i]) || employer.has(i));
  });
}

/**
 * Liens de recherche directs par entreprise (fallback).
 * L'annuaire compte plusieurs milliers d'entreprises : sans filtre on se limite
 * à un échantillon, sinon la réponse (et l'IHM) deviennent inexploitables.
 *
 * @param {string} query
 * @param {Set<string>} [onlyCompanies] si fourni, ne retourne que ces entreprises (par nom).
 * @param {number} [limit] nombre maximum de liens retournés.
 */
export function companySearchLinks(query, onlyCompanies = null, limit = 60) {
  return SOPHIA_COMPANIES
    .filter((c) => !onlyCompanies || onlyCompanies.has(c.name))
    .slice(0, limit)
    .map((c) => ({
      company: c.name,
      site: c.site,
      searchUrl: c.site
        ? `https://www.google.com/search?q=${encodeURIComponent(
            `${query} emploi site:${c.site.replace(/^https?:\/\//, "")}`
          )}`
        : `https://www.google.com/search?q=${encodeURIComponent(
            `${query} emploi "${c.name}" Sophia Antipolis`
          )}`,
    }));
}
