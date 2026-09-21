import { config } from "./config.js";

/**
 * fetch avec timeout et en-têtes "navigateur" pour limiter les blocages basiques.
 */
export async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        ...(options.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/** Structure normalisée d'une offre d'emploi. */
export function normalizeJob({
  title,
  company,
  location,
  url,
  source,
  description = "",
  date = null,
  contractType = null,
  experience = null,
}) {
  const fullText = `${title} ${description}`;
  const exp = experience || extractExperience(fullText);
  const years = extractExperienceYears(exp, fullText);
  const contract = normalizeContractType(contractType) || extractContractType(fullText);

  // Stage / alternance sans mention d'expérience : niveau débutant par nature.
  const level =
    toExperienceLevel(years, exp) ||
    (contract === "Stage" || contract === "Alternance" ? "debutant" : null);

  return {
    title: (title || "").trim(),
    company: (company || "").trim() || "N/C",
    location: (location || "").trim() || "Sophia Antipolis",
    url: (url || "").trim(),
    source,
    description: (description || "").trim().slice(0, 400),
    date,
    contractType: contract,
    experience: exp,
    experienceYears: years,
    experienceLevel: level,
  };
}

/** Types de contrat reconnus (valeurs canoniques utilisées par les filtres). */
export const CONTRACT_TYPES = ["CDI", "CDD", "Alternance", "Stage", "Freelance", "Intérim"];

/** Normalise un libellé de contrat hétérogène vers une valeur canonique. */
export function normalizeContractType(raw) {
  const t = normalizeText(raw || "");
  if (!t) return null;
  if (/\bcdi\b|duree indeterminee|permanent|full[- ]time contract/.test(t)) return "CDI";
  if (/\bcdd\b|duree determinee|temporaire|fixed[- ]term/.test(t)) return "CDD";
  if (/alternance|apprentissage|apprenti|professionnalisation/.test(t)) return "Alternance";
  if (/stage|stagiaire|internship|intern\b/.test(t)) return "Stage";
  if (/freelance|independant|prestataire|consultant externe/.test(t)) return "Freelance";
  if (/interim|mission temporaire|travail temporaire/.test(t)) return "Intérim";
  return null;
}

/** Devine le type de contrat à partir d'un texte libre (titre + description). */
export function extractContractType(text = "") {
  return normalizeContractType(text);
}

/**
 * Déduit un nombre d'années d'expérience (borne basse) depuis un libellé
 * d'expérience déjà extrait, puis à défaut depuis le texte brut.
 */
export function extractExperienceYears(experienceLabel, text = "") {
  const sources = [experienceLabel, text].filter(Boolean).map(normalizeText);
  for (const s of sources) {
    if (!s) continue;
    if (/debutant|sans experience|premiere experience|junior|jeune diplome/.test(s)) return 0;
    const range = s.match(/(\d{1,2})\s*[-a]\s*(\d{1,2})\s*an/);
    if (range) return Number(range[1]);
    const single = s.match(/(\d{1,2})\s*\+?\s*an(?:s|nee)?/);
    if (single) {
      const n = Number(single[1]);
      if (n >= 0 && n <= 20) return n;
    }
    // Indices textuels sans chiffre.
    if (/\bexpert|\bsenior|confirme\b.*\bsenior|principal engineer|lead\b/.test(s)) return 5;
    if (/confirme|experimente|mid[- ]level/.test(s)) return 3;
  }
  return null;
}

/**
 * Niveau d'expérience : débutant (< 2 ans), confirmé (2-4 ans), expert (5 ans et +).
 * Retourne null si l'information est inconnue.
 */
export function toExperienceLevel(years, experienceLabel = "") {
  let y = years;
  if (y === null || y === undefined) {
    y = extractExperienceYears(experienceLabel, "");
  }
  if (y === null || y === undefined) return null;
  if (y < 2) return "debutant";
  if (y < 5) return "confirme";
  return "expert";
}

/**
 * Extrait le nombre d'années d'expérience demandé depuis un texte.
 * Renvoie une chaîne lisible (ex: "3 ans", "Débutant accepté") ou null.
 */
export function extractExperience(text = "") {
  const t = normalizeText(text);
  if (!t) return null;

  // Débutant / junior / sans expérience.
  if (/debutant|sans experience|premiere experience|junior|jeune diplome/.test(t)) {
    return "Débutant accepté";
  }

  // "5 ans", "3-5 ans", "au moins 2 ans", "2+ ans", "minimum 3 ans d'experience".
  const range = t.match(/(\d{1,2})\s*[-a]\s*(\d{1,2})\s*an/);
  if (range) return `${range[1]}-${range[2]} ans`;

  const single = t.match(/(\d{1,2})\s*\+?\s*an(?:s|nee)?/);
  if (single) {
    const n = single[1];
    // On évite les faux positifs type "24 ans" (âge) : plausible entre 1 et 20 ans d'xp.
    if (Number(n) >= 1 && Number(n) <= 20) return `${n} an${n > 1 ? "s" : ""}`;
  }

  return null;
}

/** Retire accents et met en minuscule pour comparaisons. */
export function normalizeText(str = "") {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Découpe une requête en tokens significatifs. */
export function tokenize(str = "") {
  return normalizeText(str)
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 1);
}

/** Petite pause. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
