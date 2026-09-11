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
  return {
    title: (title || "").trim(),
    company: (company || "").trim() || "N/C",
    location: (location || "").trim() || "Sophia Antipolis",
    url: (url || "").trim(),
    source,
    description: (description || "").trim().slice(0, 400),
    date,
    contractType,
    experience: experience || extractExperience(`${title} ${description}`),
  };
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
