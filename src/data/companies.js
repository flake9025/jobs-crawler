import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_COMPANIES } from "./companies-seed.js";
import { FEATURED_COMPANIES } from "./featured-companies.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Annuaire complet des entreprises de la technopole.
 *
 * Trois sources fusionnées, par ordre de priorité :
 *  1. FEATURED_COMPANIES : fiches vedettes de l'onglet « Entreprises »
 *                          (page d'offres vérifiée, alias, réglages de crawl).
 *  2. SEED_COMPANIES     : liste curatée (sites vérifiés à la main).
 *  3. companies.json     : annuaire généré depuis les annuaires publics
 *                          (sophia-antipolis.fr, ville-valbonne.fr, OpenStreetMap)
 *                          via `npm run fetch:companies`.
 *
 * Chaque entrée : { name, site, careerSite?, city?, sectors?, sources?,
 *                   aliases?, offerUrlFilter?, localOnly?, crawl?, featured? }
 *  - `careerSite` : page d'offres (ou ATS) crawlée à la place du site ; une liste
 *    d'URLs quand l'employeur publie sur plusieurs sites (voir careerSitesOf).
 *  - `aliases` : autres raisons sociales ; les entrées de l'annuaire portant l'un
 *    de ces noms sont rattachées à la fiche (« Cie Ibm France » → IBM).
 *  - `offerUrlFilter` : fragment d'URL des offres propres à l'entreprise, quand le
 *    site d'offres est partagé par plusieurs enseignes d'un groupe.
 *  - `localOnly` : ne garder que les offres explicitement situées dans le 06.
 *  - `crawl: false` : site inexploitable, fiche consultable mais jamais crawlée.
 * `site` peut être null : l'entreprise reste listée (liens de recherche ciblés,
 * rapprochement par nom sur les offres France Travail / agrégateurs) mais n'est
 * pas crawlée directement.
 */
function loadDirectory() {
  const file = path.join(__dirname, "companies.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : parsed.companies || [];
  } catch {
    return [];
  }
}

export function companyKey(name = "") {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Formes juridiques et suffixes qui créent de faux doublons.
    .replace(/\b(sas|sasu|sarl|eurl|sa|snc|sci|scop|group|groupe|france|technologies?|solutions?)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Fusionne les listes : la première occurrence d'une entreprise (par nom ou alias)
 * fait foi, les suivantes ne font que compléter les champs manquants.
 */
function merge(lists) {
  const byKey = new Map();
  const entries = [];
  for (const list of lists) {
    for (const c of list) {
      if (!c || !c.name) continue;
      const keys = [...new Set([c.name, ...(c.aliases || [])].map(companyKey).filter(Boolean))];
      if (!keys.length) continue;
      const existing = keys.map((k) => byKey.get(k)).find(Boolean);
      if (!existing) {
        const entry = { ...c, sources: [...new Set(c.sources || [])] };
        entries.push(entry);
        for (const k of keys) byKey.set(k, entry);
        continue;
      }
      // Complète l'entrée existante sans écraser une donnée déjà vérifiée.
      existing.site = existing.site || c.site || null;
      existing.careerSite = existing.careerSite || c.careerSite || null;
      existing.city = existing.city || c.city || null;
      existing.sectors = existing.sectors?.length ? existing.sectors : c.sectors || [];
      existing.sources = [...new Set([...(existing.sources || []), ...(c.sources || [])])];
      for (const k of keys) if (!byKey.has(k)) byKey.set(k, existing);
    }
  }
  return entries;
}

export const SOPHIA_COMPANIES = merge([
  FEATURED_COMPANIES.map((c) => ({ ...c, sources: ["featured"] })),
  SEED_COMPANIES.map((c) => ({ ...c, sources: ["curated"] })),
  loadDirectory(),
]);

/** Sous-ensemble réellement crawlable (site web ou page d'offres connus). */
export const CRAWLABLE_COMPANIES = SOPHIA_COMPANIES.filter(
  (c) => (c.site || c.careerSite) && c.crawl !== false
);

/** Pages d'offres crawlées d'une entreprise (`careerSite` : URL ou liste d'URLs). */
export function careerSitesOf(company) {
  const sites = company?.careerSite;
  return (Array.isArray(sites) ? sites : [sites]).filter(Boolean);
}

/** Appellations connues d'une entreprise de l'annuaire (nom + alias). */
const NAMES_BY_COMPANY = new Map(SOPHIA_COMPANIES.map((c) => [c.name, [c.name, ...(c.aliases || [])]]));

export function companyNames(name) {
  return NAMES_BY_COMPANY.get(name) || (name ? [name] : []);
}

const COMPANY_BY_NAME = new Map(SOPHIA_COMPANIES.map((c) => [c.name, c]));
const COMPANY_BY_KEY = new Map();
for (const c of SOPHIA_COMPANIES) {
  for (const n of [c.name, ...(c.aliases || [])]) {
    const key = companyKey(n);
    if (key && !COMPANY_BY_KEY.has(key)) COMPANY_BY_KEY.set(key, c);
  }
}

/** Entreprise de l'annuaire désignée par son nom exact ou l'un de ses alias. */
export function findCompany(name = "") {
  return COMPANY_BY_NAME.get(name) || COMPANY_BY_KEY.get(companyKey(name)) || null;
}

// Communes considérées comme "zone Sophia Antipolis" pour le filtrage géographique.
export const SOPHIA_GEO = {
  // code INSEE de la commune de Valbonne (Sophia Antipolis) pour l'API France Travail
  franceTravailCommune: "06152",
  // rayon de recherche en km autour de la commune
  distanceKm: 20,
  // termes de localisation utilisés dans les URLs de scraping / filtrage texte
  locationTerms: [
    "sophia antipolis",
    "sophia-antipolis",
    "valbonne",
    "biot",
    "antibes",
    "mougins",
    "vallauris",
    "06560",
    "06410",
    "06600",
    "06250",
  ],
};
