import * as cheerio from "cheerio";
import { config } from "../config.js";
import { fetchWithTimeout, normalizeJob, tokenize, normalizeText } from "../util.js";
import { SOPHIA_COMPANIES, CRAWLABLE_COMPANIES } from "../../data/companies.js";

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

// Marqueurs typiques d'un intitulé d'offre.
const OFFER_MARKERS = [
  "h/f", "f/h", "m/f", "(h/f)", "(f/h)", "w/m",
  "cdi", "cdd", "stage", "alternance", "apprentissage", "freelance",
  "internship", "stagiaire", "apprenti",
];

function normalize(s) {
  return normalizeText(s);
}

// Certaines pages (catalogues, SPA) pèsent plusieurs Mo : les charger entièrement
// dans cheerio, à 12 en parallèle, suffit à faire tomber le conteneur sur un NAS.
// On lit donc le corps en streaming avec un budget d'octets.
const MAX_HTML_BYTES = 1_500_000;

async function readHtmlCapped(res) {
  if (!res.body) return (await res.text()).slice(0, MAX_HTML_BYTES);
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let out = "";
  let bytes = 0;
  try {
    while (bytes < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    // Libère la connexion même si on s'arrête avant la fin du document.
    reader.cancel().catch(() => {});
  }
  return out;
}

function isCareerLink(text, href) {
  const t = normalize(text);
  const h = normalize(href);
  return CAREER_HINTS.some((k) => t.includes(k) || h.includes(k));
}

function looksLikeOffer(text) {
  const t = normalize(text);
  // Faux amis à exclure (ex: "internal" contient "intern").
  if (/internal|international|internaute|alternative/.test(t)) {
    // On n'exclut que si aucun autre marqueur fort n'est présent.
    const strong = /(h\/f|f\/h|\(h\/f\)|\(f\/h\)|cdi|cdd|alternance|apprentissage|stagiaire|freelance)/.test(t);
    if (!strong) return false;
  }
  if (OFFER_MARKERS.some((m) => t.includes(m))) return true;
  return false;
}

// Mots de navigation à exclure des faux intitulés.
const NAV_NOISE = [
  "accueil", "home", "contact", "blog", "actualite", "actualites", "news",
  "mentions legales", "politique", "cookies", "connexion", "login", "panier",
  "a propos", "about", "produits", "solutions", "services", "demo", "newsletter",
  "linkedin", "twitter", "facebook", "instagram", "youtube", "plan du site",
  "cgv", "cgu", "faq", "partenaires", "clients", "equipe", "team", "nos valeurs",
];

function isNavNoise(text) {
  const t = normalize(text);
  return NAV_NOISE.some((n) => t === n || t.includes(n));
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
 * Étape 2 : sur une page, extrait les liens d'offres.
 * @param {boolean} isCareerPage true si la page est identifiée comme une page carrières
 *        (dans ce cas on est plus permissif ; sinon on exige un marqueur d'offre).
 */
function extractOffers($, pageUrl, companyName, seen, isCareerPage) {
  const jobs = [];
  $("a[href]").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (!text || text.length < 4 || text.length > 130) return;
    if (isNavNoise(text)) return;
    // Rejette les artefacts (code CSS/JS capté dans le texte du lien).
    if (/[{}<>;]|fill:|\.st\d|function|var\s|=>/.test(text)) return;
    // Rejette les libellés génériques de page carrières (pas des offres).
    if (/^(open positions|view open positions|nos offres|voir les offres|candidatures? spontan|retour|domaines? d|la vie chez|notre culture|etre divers|developpement des|people ?&|support every)/i.test(normalize(text))) return;
    const href = $(el).attr("href");
    if (!href) return;

    let full;
    try {
      full = new URL(href, pageUrl).href;
    } catch {
      return;
    }

    // On ignore les liens externes (réseaux sociaux, maps, plateformes tierces bruitées).
    let sameDomain = false;
    try {
      sameDomain = new URL(full).hostname === new URL(pageUrl).hostname;
    } catch {
      return;
    }

    const offer = looksLikeOffer(text);
    // Titre plausible : court, avec lettres, pas un lien "carrières" générique.
    const plausibleTitle =
      text.split(" ").length <= 10 &&
      /[a-zA-ZÀ-ÿ]{3,}/.test(text) &&
      !isCareerLink(text, "");

    // L'URL pointe-t-elle vers une offre individuelle ? (slug type /jobs/xxx, /offre/xxx, .../poste-h-f)
    const urlLooksLikeOffer =
      /\/(jobs?|offres?|postes?|careers?|carrieres?|job-offer|job-details|vacancy|vacature)\/[a-z0-9]/i.test(full) ||
      /h-f|f-h|-hf|cdi|cdd|alternance|stage|stagiaire/i.test(full);

    // Règle :
    //  - marqueur d'offre dans le texte (H/F, CDI…) => toujours accepté
    //  - sinon, sur une page carrières identifiée : accepté seulement si l'URL
    //    ressemble à une offre individuelle (évite le bruit de navigation).
    let keep = false;
    if (offer) keep = true;
    else if (isCareerPage && plausibleTitle && sameDomain && urlLooksLikeOffer) keep = true;

    if (!keep) return;
    if (seen.has(full)) return;
    seen.add(full);

    jobs.push(
      normalizeJob({
        title: text,
        company: companyName,
        location: "Sophia Antipolis",
        url: full,
        source: `Entreprise: ${companyName}`,
      })
    );
  });
  return jobs;
}

/**
 * Collecte les offres d'une entreprise :
 *  1. charge la home, découvre les pages carrières,
 *  2. charge chaque page carrières (+ fallback chemins devinés),
 *  3. extrait les offres, en privilégiant celles avec marqueurs (H/F, CDI…).
 *
 * @returns {Promise<{jobs: Array, status: string, careerUrls: string[], error: string|null, tookMs: number}>}
 */
async function scrapeCompany(company) {
  const started = Date.now();
  const result = {
    name: company.name,
    site: company.site || null,
    jobs: [],
    status: "no-site",
    careerUrls: [],
    error: null,
    tookMs: 0,
    checkedAt: new Date().toISOString(),
  };

  if (!company.site) return result;

  // Les grands employeurs peuvent publier leurs offres sur un ATS externe.
  // `site` reste le domaine corporate de l'annuaire, `careerSite` est la
  // source réellement parcourue.
  const base = (company.careerSite || company.site).replace(/\/$/, "");
  const seen = new Set();
  let careerUrls = [];
  let homeReached = false;

  // 1. Home -> découverte des pages carrières.
  try {
    const res = await fetchWithTimeout(base);
    if (res.ok && (res.headers.get("content-type") || "").includes("html")) {
      homeReached = true;
      const $ = cheerio.load(await readHtmlCapped(res));
      careerUrls = discoverCareerUrls($, base);
    } else if (!res.ok) {
      result.error = `HTTP ${res.status}`;
    }
  } catch (err) {
    result.error = err.name === "AbortError" ? "timeout" : err.message;
  }

  // 2. Ajoute les chemins devinés en complément (dédupliqués).
  const guessed = company.careerSite ? [] : CAREER_PATHS.map((p) => base + p);
  const careerSet = new Set(careerUrls);
  const pagesToScan = [...new Set([...careerUrls, ...guessed])]
    // On reste sur le même domaine pour éviter de scraper LinkedIn/WTTJ ici.
    .filter((u) => {
      try {
        return new URL(u).hostname === new URL(base).hostname;
      } catch {
        return false;
      }
    })
    .slice(0, 6);

  const withMarker = [];
  const withoutMarker = [];

  // Une URL est "page carrières" si découverte via lien carrières OU si son chemin
  // contient un mot-clé carrières (career, carriere, emploi, jobs, recrut…).
  const looksLikeCareerUrl = (u) => {
    if (careerSet.has(u)) return true;
    if (company.careerSite && u === company.careerSite) return true;
    const p = normalize(u);
    return /career|carriere|emploi|jobs|recrut|rejoindre/.test(p);
  };

  if (company.careerSite && !pagesToScan.includes(company.careerSite)) {
    pagesToScan.unshift(company.careerSite);
  }

  // 3. Scan des pages carrières.
  for (const url of pagesToScan) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      if (!(res.headers.get("content-type") || "").includes("html")) continue;
      homeReached = true;
      result.careerUrls.push(url);
      const $ = cheerio.load(await readHtmlCapped(res));
      const found = extractOffers($, url, company.name, seen, looksLikeCareerUrl(url));
      for (const o of found) {
        if (looksLikeOffer(o.title)) withMarker.push(o);
        else withoutMarker.push(o);
      }
    } catch {
      /* ignore */
    }
    if (withMarker.length >= 15) break;
  }

  // Priorité aux offres "confirmées" (marqueur H/F, CDI…), puis compléments.
  const offers = withMarker.length ? withMarker : withoutMarker;
  result.jobs = offers.slice(0, 15);
  result.tookMs = Date.now() - started;
  result.careerUrls = result.careerUrls.slice(0, 5);

  if (result.jobs.length) result.status = "ok";
  else if (homeReached) result.status = "no-offer";
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

  // Les entreprises sans site ne sont pas crawlables : on les trace quand même
  // pour que le catalogue affiche une couverture honnête.
  for (const c of SOPHIA_COMPANIES) {
    if (!c.site) {
      stats.push({
        name: c.name,
        site: null,
        status: "no-site",
        jobs: 0,
        careerUrls: [],
        error: null,
        tookMs: 0,
        checkedAt: null,
      });
    }
  }

  return { jobs, stats };
}

/**
 * Recherche dans le cache d'offres d'entreprises (filtre en mémoire, instantané).
 * On ignore les mots vides pour éviter les faux positifs (ex: "de", "chef DE projet").
 */
const STOPWORDS = new Set([
  "de", "du", "la", "le", "les", "des", "un", "une", "et", "en", "au", "aux",
  "pour", "sur", "dans", "par", "avec", "chez", "the", "of", "and", "for",
]);

export function searchCompanyCache(cachedJobs, query) {
  const tokens = tokenize(query).filter((t) => !STOPWORDS.has(t));
  if (tokens.length === 0) return [];
  return cachedJobs.filter((j) => {
    const t = normalizeText(j.title);
    // Toutes les portions significatives de la requête doivent apparaître.
    return tokens.every((tok) => t.includes(tok));
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
