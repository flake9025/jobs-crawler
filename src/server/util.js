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

/** Mots d'un nom d'entreprise (minuscules, sans accents ni ponctuation). */
export function nameWords(name = "") {
  return normalizeText(name)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Le nom d'employeur d'une offre correspond-il à l'une des appellations connues ?
 * Comparaison par suite de mots entiers : « SOPRA STERIA GROUP » correspond à
 * « Sopra Steria », mais « Westorange » ne correspond pas à « Orange ».
 */
export function matchesCompanyName(company, aliases = []) {
  const words = nameWords(company);
  if (!words.length) return false;
  return aliases.some((alias) => {
    const a = nameWords(alias);
    if (!a.length || a.length > words.length) return false;
    for (let i = 0; i + a.length <= words.length; i++) {
      if (a.every((w, k) => words[i + k] === w)) return true;
    }
    return false;
  });
}

const MONTHS = {
  janvier: 1, janv: 1, jan: 1, january: 1,
  fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2,
  mars: 3, mar: 3, march: 3,
  avril: 4, avr: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6, june: 6,
  juillet: 7, juil: 7, jul: 7, july: 7,
  aout: 8, aug: 8, august: 8,
  septembre: 9, sept: 9, sep: 9, september: 9,
  octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11,
  decembre: 12, dec: 12, december: 12,
};

function isoDate(y, m, d) {
  if (!y || !m || !d || m > 12 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Date de publication à partir des libellés hétérogènes des sites carrières :
 * « 12 mai 2026 », « May 12, 2026 », « 12/05/2026 », « il y a 3 jours »,
 * « Posted 30+ Days Ago », « aujourd'hui »… Retourne une date ISO ou null.
 */
export function parseLooseDate(raw, now = Date.now()) {
  const t = normalizeText(raw || "");
  if (!t) return null;
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();

  if (/aujourd|today|just posted/.test(t)) return daysAgo(0);
  if (/\bhier\b|yesterday/.test(t)) return daysAgo(1);
  const rel = t.match(/(\d{1,3})\s*\+?\s*(jours?|days?|semaines?|weeks?|mois|months?)\b/);
  if (rel) {
    const unit = rel[2];
    const factor = /semaine|week/.test(unit) ? 7 : /mois|month/.test(unit) ? 30 : 1;
    return daysAgo(Number(rel[1]) * factor);
  }

  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = t.match(/\b(\d{1,2})(?:er)?\s+([a-z]+)\.?\s+(\d{4})\b/);
  if (m && MONTHS[m[2]]) return isoDate(+m[3], MONTHS[m[2]], +m[1]);
  m = t.match(/\b([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1]]) return isoDate(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

/** Petite pause. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
