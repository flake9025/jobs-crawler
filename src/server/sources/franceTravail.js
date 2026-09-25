import { config } from "../config.js";
import { normalizeJob } from "../util.js";
import { SOPHIA_GEO } from "../../data/companies.js";

const AUTH_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const SEARCH_URL =
  "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Normalise le libellé d'expérience de France Travail pour un affichage court.
 * Ex: "Expérience exigée de 2 An(s)" -> "2 ans" ; "Débutant accepté" -> "Débutant accepté".
 */
function cleanExperience(libelle) {
  if (!libelle) return null;
  const m = libelle.match(/(\d{1,2})\s*An/i);
  if (m) return `${m[1]} an${Number(m[1]) > 1 ? "s" : ""}`;
  if (/debutant/i.test(libelle)) return "Débutant accepté";
  if (/exig/i.test(libelle)) return "Expérience exigée";
  if (/souhait/i.test(libelle)) return "Expérience souhaitée";
  return libelle;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.franceTravail.clientId,
    client_secret: config.franceTravail.clientSecret,
    scope: "api_offresdemploiv2 o2dsoffre",
  });

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
  });
  if (!res.ok) {
    throw new Error(`France Travail auth échouée: ${res.status}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 30) * 1000;
  return cachedToken;
}

/**
 * Recherche via l'API officielle France Travail (Offres d'emploi v2).
 * Nécessite des identifiants. Sinon, retourne [].
 */
export async function searchFranceTravail(query) {
  if (!config.franceTravail.enabled) return [];

  try {
    const token = await getToken();
    const params = new URLSearchParams({
      motsCles: query,
      commune: SOPHIA_GEO.franceTravailCommune,
      distance: String(SOPHIA_GEO.distanceKm),
      range: `0-${Math.min(config.maxPerSource - 1, 149)}`,
    });

    const res = await fetch(`${SEARCH_URL}?${params}`, {
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    // 204 = aucun résultat
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`France Travail search: ${res.status}`);

    const data = await res.json();
    const offres = data.resultats || [];

    return offres.map((o) =>
      normalizeJob({
        title: o.intitule,
        company: o.entreprise?.nom || o.entreprise?.description || "N/C",
        location: o.lieuTravail?.libelle || "Sophia Antipolis",
        url:
          o.origineOffre?.urlOrigine ||
          `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
        source: "France Travail",
        description: o.description || "",
        date: o.dateCreation || null,
        contractType: o.typeContratLibelle || o.typeContrat || null,
        experience: cleanExperience(o.experienceLibelle),
      })
    );
  } catch (err) {
    console.error("[FranceTravail]", err.message);
    return [];
  }
}
