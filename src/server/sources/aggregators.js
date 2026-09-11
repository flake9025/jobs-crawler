import * as cheerio from "cheerio";
import { config } from "../config.js";
import { fetchWithTimeout, normalizeJob } from "../util.js";

const SOPHIA_LOC = "Sophia Antipolis";

/**
 * Chaque agrégateur est décrit par une fonction qui construit l'URL de recherche
 * puis une fonction de parsing du HTML. Le scraping est "best effort" : les sites
 * changent souvent leur HTML et certains (LinkedIn, Indeed) bloquent agressivement.
 * En cas d'échec, on retombe sur un lien de recherche direct (voir searchLinks()).
 */

async function scrape(url, parseFn, source) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const jobs = parseFn($, url).slice(0, config.maxPerSource);
    return jobs;
  } catch (err) {
    console.error(`[${source}]`, err.message);
    return [];
  }
}

// --- WELCOME TO THE JUNGLE (via son API Algolia publique est complexe; on parse le HTML) ---
async function wttj(query) {
  const url = `https://www.welcometothejungle.com/fr/jobs?query=${encodeURIComponent(
    query
  )}&aroundQuery=Sophia%20Antipolis`;
  return scrape(
    url,
    ($) => {
      const jobs = [];
      $('a[href*="/companies/"][href*="/jobs/"]').each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).text().trim();
        if (title && href) {
          jobs.push(
            normalizeJob({
              title,
              company: "",
              location: SOPHIA_LOC,
              url: href.startsWith("http")
                ? href
                : `https://www.welcometothejungle.com${href}`,
              source: "Welcome to the Jungle",
            })
          );
        }
      });
      return jobs;
    },
    "Welcome to the Jungle"
  );
}

// --- HELLOWORK ---
async function hellowork(query) {
  const url = `https://www.hellowork.com/fr-fr/emploi/recherche.html?k=${encodeURIComponent(
    query
  )}&l=Sophia+Antipolis`;
  return scrape(
    url,
    ($) => {
      const jobs = [];
      $("[data-id-storage-target='item']").each((_, el) => {
        const $el = $(el);
        const link = $el.find("a[href]").first().attr("href");
        const title = $el.find("h3, [class*='title']").first().text().trim();
        const company = $el.find("[class*='company'], [class*='Company']").first().text().trim();
        if (title && link) {
          jobs.push(
            normalizeJob({
              title,
              company,
              location: SOPHIA_LOC,
              url: link.startsWith("http") ? link : `https://www.hellowork.com${link}`,
              source: "HelloWork",
            })
          );
        }
      });
      return jobs;
    },
    "HelloWork"
  );
}

// --- APEC (cadres) ---
async function apec(query) {
  const url = `https://www.apec.fr/candidat/recherche-emploi.html/emploi?motsCles=${encodeURIComponent(
    query
  )}&lieux=595&sortsType=DATE`;
  return scrape(
    url,
    ($) => {
      const jobs = [];
      $("a.card-offer, a[href*='/detail-offre/']").each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href");
        const title = $el.find("h2, .card-title").first().text().trim();
        if (title && href) {
          jobs.push(
            normalizeJob({
              title,
              company: $el.find(".card-offer__company, .company").first().text().trim(),
              location: SOPHIA_LOC,
              url: href.startsWith("http") ? href : `https://www.apec.fr${href}`,
              source: "APEC",
            })
          );
        }
      });
      return jobs;
    },
    "APEC"
  );
}

/**
 * Retourne toujours, pour chaque grande source, un "lien de recherche" cliquable
 * pointant vers la page de résultats du site. Ceci garantit à l'utilisateur un
 * accès direct même quand le scraping est bloqué (LinkedIn / Indeed notamment).
 */
export function searchLinks(query) {
  const q = encodeURIComponent(query);
  const loc = encodeURIComponent("Sophia Antipolis");
  return [
    {
      source: "LinkedIn Jobs",
      url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${loc}`,
    },
    {
      source: "Indeed",
      url: `https://fr.indeed.com/jobs?q=${q}&l=${loc}`,
    },
    {
      source: "Welcome to the Jungle",
      url: `https://www.welcometothejungle.com/fr/jobs?query=${q}&aroundQuery=${loc}`,
    },
    {
      source: "HelloWork",
      url: `https://www.hellowork.com/fr-fr/emploi/recherche.html?k=${q}&l=Sophia+Antipolis`,
    },
    {
      source: "APEC",
      url: `https://www.apec.fr/candidat/recherche-emploi.html/emploi?motsCles=${q}`,
    },
    {
      source: "France Travail",
      url: `https://candidat.francetravail.fr/offres/recherche?motsCles=${q}&lieux=06152&rayon=20`,
    },
  ];
}

/** Lance tous les scrapers agrégateurs en parallèle. */
export async function searchAggregators(query) {
  if (!config.enableScrapers) return [];
  const results = await Promise.allSettled([
    wttj(query),
    hellowork(query),
    apec(query),
  ]);
  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);
}
