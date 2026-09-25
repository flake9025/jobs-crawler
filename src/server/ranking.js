import { normalizeText, tokenize } from "./util.js";
import { SOPHIA_GEO } from "../data/companies.js";
import { employerMatches } from "./sources/companies.js";

/**
 * Calcule un score de pertinence [0..100] d'une offre par rapport à la requête.
 * Critères :
 *  - correspondance des tokens de la requête dans le titre (fort poids), ou désignant
 *    l'employeur par son nom ou un alias (« java amadeus », « ausy »)
 *  - correspondance dans la description (poids moyen)
 *  - localisation dans la zone Sophia (bonus)
 *  - source directe entreprise (léger bonus, offre "au plus près")
 *  - fraîcheur de l'offre (bonus si date récente)
 */
export function scoreJob(job, query) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 50;

  const title = normalizeText(job.title);
  const desc = normalizeText(job.description);
  const loc = normalizeText(job.location);
  const employer = employerMatches(job.company, qTokens);

  let score = 0;

  // Titre : chaque token présent rapporte gros ; le nom de l'employeur un peu moins.
  let titleHits = 0;
  let employerHits = 0;
  qTokens.forEach((tok, i) => {
    if (title.includes(tok)) titleHits++;
    else if (employer.has(i)) employerHits++;
  });
  score += ((titleHits + employerHits * 0.8) / qTokens.length) * 55;

  // Bonus si la requête complète (phrase) apparaît dans le titre.
  if (title.includes(normalizeText(query))) score += 15;

  // Description.
  let descHits = 0;
  for (const tok of qTokens) {
    if (desc.includes(tok)) descHits++;
  }
  score += (descHits / qTokens.length) * 15;

  // Localisation Sophia.
  if (SOPHIA_GEO.locationTerms.some((t) => loc.includes(t))) score += 10;

  // Source entreprise directe.
  if (job.source && job.source.startsWith("Entreprise:")) score += 5;

  // Fraîcheur.
  if (job.date) {
    const days = (Date.now() - new Date(job.date).getTime()) / 86400000;
    if (!Number.isNaN(days)) {
      if (days <= 7) score += 8;
      else if (days <= 30) score += 4;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Clé de déduplication : titre + entreprise normalisés (ou URL). */
function dedupeKey(job) {
  const t = normalizeText(job.title).replace(/[^a-z0-9]/g, "");
  const c = normalizeText(job.company).replace(/[^a-z0-9]/g, "");
  if (t && c) return `${t}::${c}`;
  return job.url;
}

/**
 * Traite la liste brute : score, filtre (score minimal), déduplique, trie.
 */
export function rankJobs(jobs, query, { minScore = 15 } = {}) {
  const scored = jobs
    .filter((j) => j.title && j.url)
    .map((j) => ({ ...j, score: scoreJob(j, query) }))
    .filter((j) => j.score >= minScore);

  // Déduplication : on garde le meilleur score par clé.
  const byKey = new Map();
  for (const j of scored) {
    const k = dedupeKey(j);
    const existing = byKey.get(k);
    if (!existing || j.score > existing.score) byKey.set(k, j);
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score);
}
