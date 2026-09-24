import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_COMPANIES } from "./companies-seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Annuaire complet des entreprises de la technopole.
 *
 * Deux sources fusionnées :
 *  1. SEED_COMPANIES  : liste curatée (sites vérifiés à la main).
 *  2. companies.json  : annuaire généré depuis les annuaires publics
 *                       (sophia-antipolis.fr, ville-valbonne.fr) via
 *                       `npm run fetch:companies`.
 *
 * Chaque entrée : { name, site, careerSite?, sources?, sectors?, city? }
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

/** Fusionne les listes en privilégiant les entrées qui possèdent un site web. */
function merge(lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const c of list) {
      if (!c || !c.name) continue;
      const key = companyKey(c.name);
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...c, sources: [...new Set(c.sources || [])] });
        continue;
      }
      // Complète l'entrée existante sans écraser une donnée déjà vérifiée.
      existing.site = existing.site || c.site || null;
      existing.careerSite = existing.careerSite || c.careerSite || null;
      existing.city = existing.city || c.city || null;
      existing.sectors = existing.sectors?.length ? existing.sectors : c.sectors || [];
      existing.sources = [...new Set([...(existing.sources || []), ...(c.sources || [])])];
    }
  }
  return [...byKey.values()];
}

export const SOPHIA_COMPANIES = merge([
  SEED_COMPANIES.map((c) => ({ ...c, sources: ["curated"] })),
  loadDirectory(),
]);

/** Sous-ensemble réellement crawlable (site web connu). */
export const CRAWLABLE_COMPANIES = SOPHIA_COMPANIES.filter((c) => c.site);

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
