/**
 * Génère l'annuaire des entreprises de Sophia Antipolis : src/data/companies.json
 *
 * Sources publiques :
 *  1. sophia-antipolis.fr — API REST WordPress du Syndicat Mixte (type `company`),
 *     soit plus de 5 000 acteurs de la technopole (noms + description + filières).
 *  2. ville-valbonne.fr — annuaire municipal (type `directory`), qui expose en plus
 *     le SITE WEB de chaque fiche : c'est lui qui permet de crawler les offres.
 *
 * Usage :
 *   npm run fetch:companies              # annuaires uniquement
 *   npm run fetch:companies -- --resolve # + tente de deviner les sites manquants
 *   npm run fetch:companies -- --limit=200 --resolve
 *
 * Le fichier généré est commité : le conteneur n'a pas besoin de rejouer ce script.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "..", "src", "data", "companies.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : fallback;
};

const RESOLVE = hasFlag("--resolve");
const LIMIT = parseInt(getOpt("limit", "0"), 10);
const CONCURRENCY = parseInt(getOpt("concurrency", "12"), 10);
const TIMEOUT_MS = parseInt(getOpt("timeout", "15000"), 10);

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchText(url, "application/json");
      if (res) return JSON.parse(res);
    } catch {
      /* retry */
    }
    await sleep(500 * (i + 1));
  }
  return null;
}

async function fetchText(url, accept = "text/html") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "fr-FR,fr;q=0.9" },
    });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Exécute `worker` sur chaque élément avec une concurrence bornée. */
async function pool(items, worker, { concurrency = CONCURRENCY, onProgress } = {}) {
  const results = [];
  let index = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await worker(items[i], i);
      } catch {
        results[i] = null;
      }
      done++;
      if (onProgress && (done % 25 === 0 || done === items.length)) onProgress(done, items.length);
    }
  });
  await Promise.all(runners);
  return results;
}

function decodeEntities(s = "") {
  return s
    .replace(/&#8217;|&#039;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html = "") {
  return decodeEntities(html.replace(/<[^>]+>/g, " "));
}

/** Titres "tout en majuscules" -> Capitalisation lisible. */
function prettyName(raw = "") {
  const name = decodeEntities(raw);
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s'’\-/(])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

// ---------------------------------------------------------------------------
// Source 1 : annuaire officiel de la technopole (sophia-antipolis.fr)
// ---------------------------------------------------------------------------
const SA_BASE = "https://www.sophia-antipolis.fr/wp-json/wp/v2";

async function fetchSectors() {
  const map = new Map();
  for (let page = 1; page <= 5; page++) {
    const terms = await getJson(`${SA_BASE}/company_sector?per_page=100&page=${page}`);
    if (!Array.isArray(terms) || terms.length === 0) break;
    for (const t of terms) map.set(t.id, decodeEntities(t.name));
    if (terms.length < 100) break;
  }
  return map;
}

async function fetchSophiaAntipolis() {
  console.log("[sophia-antipolis.fr] récupération de l'annuaire officiel…");
  const sectors = await fetchSectors();

  const first = await fetch(`${SA_BASE}/company?per_page=1`, { headers: { "User-Agent": UA } });
  const total = parseInt(first.headers.get("x-wp-total") || "0", 10);
  const perPage = 100;
  const pages = Math.ceil(total / perPage);
  console.log(`[sophia-antipolis.fr] ${total} fiches (${pages} pages)`);

  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1);
  const companies = [];

  await pool(
    pageNumbers,
    async (page) => {
      const batch = await getJson(
        `${SA_BASE}/company?per_page=${perPage}&page=${page}&_fields=title,content,company_sector,slug`
      );
      if (!Array.isArray(batch)) return null;
      for (const c of batch) {
        const name = prettyName(c.title?.rendered || "");
        if (!name) continue;
        companies.push({
          name,
          site: null,
          description: stripTags(c.content?.rendered || "").slice(0, 300),
          sectors: (c.company_sector || []).map((id) => sectors.get(id)).filter(Boolean),
          city: "Sophia Antipolis",
          sources: ["sophia-antipolis.fr"],
        });
      }
      return true;
    },
    {
      concurrency: 6,
      onProgress: (d, t) => process.stdout.write(`\r  pages ${d}/${t}`),
    }
  );

  process.stdout.write("\n");
  console.log(`[sophia-antipolis.fr] ${companies.length} entreprises récupérées.`);
  return companies;
}

// ---------------------------------------------------------------------------
// Source 2 : annuaire municipal de Valbonne (fournit les sites web)
// ---------------------------------------------------------------------------
const VB_BASE = "https://www.ville-valbonne.fr/wp-json/wp/v2";

const SOCIAL_OR_NOISE =
  /(facebook|twitter|x\.com|instagram|linkedin|youtube|tiktok|pinterest|google\.[a-z.]+\/maps|goo\.gl|w3\.org|schema\.org|gmpg\.org|yoast\.com|wp-rocket|wordpress\.org|apps\.apple\.com|play\.google\.com|data-vocabulary|neocity|amazonaws\.com|ytimg\.com|gravatar)/i;

async function fetchValbonne() {
  console.log("[ville-valbonne.fr] récupération de l'annuaire municipal…");
  const first = await fetch(`${VB_BASE}/fiche-annuaire?per_page=1`, { headers: { "User-Agent": UA } });
  const total = parseInt(first.headers.get("x-wp-total") || "0", 10);
  const perPage = 100;
  const pages = Math.ceil(total / perPage);
  console.log(`[ville-valbonne.fr] ${total} fiches (${pages} pages)`);

  const entries = [];
  for (let page = 1; page <= pages; page++) {
    const batch = await getJson(
      `${VB_BASE}/fiche-annuaire?per_page=${perPage}&page=${page}&_fields=title,link,content`
    );
    if (!Array.isArray(batch)) break;
    for (const e of batch) {
      const name = prettyName(e.title?.rendered || "");
      if (name && e.link) {
        entries.push({ name, link: e.link, description: stripTags(e.content?.rendered || "").slice(0, 300) });
      }
    }
  }

  // Chaque fiche publie le site web dans le bloc "Infos contacts".
  const withSites = await pool(
    entries,
    async (entry) => {
      const html = await fetchText(entry.link);
      if (!html) return { ...entry, site: null };
      const $ = cheerio.load(html);
      let site = null;
      $(".directory-informations a[href^='http'], article a[target='_blank'][href^='http']").each((_, el) => {
        if (site) return;
        const href = $(el).attr("href") || "";
        if (SOCIAL_OR_NOISE.test(href)) return;
        if (/ville-valbonne\.fr/i.test(href)) return;
        site = href.replace(/\/$/, "");
      });
      return { ...entry, site };
    },
    { onProgress: (d, t) => process.stdout.write(`\r  fiches ${d}/${t}`) }
  );

  process.stdout.write("\n");
  const list = withSites
    .filter(Boolean)
    .map((e) => ({
      name: e.name,
      site: e.site || null,
      description: e.description || "",
      sectors: [],
      city: "Valbonne / Sophia Antipolis",
      sources: ["ville-valbonne.fr"],
    }));
  console.log(
    `[ville-valbonne.fr] ${list.length} fiches, dont ${list.filter((c) => c.site).length} avec site web.`
  );
  return list;
}

// ---------------------------------------------------------------------------
// Source 3 : OpenStreetMap (Overpass) — établissements géolocalisés avec site web
// ---------------------------------------------------------------------------
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Bounding box couvrant la technopole et ses communes limitrophes.
const SOPHIA_BBOX = "43.56,6.93,43.70,7.15";

async function fetchOpenStreetMap() {
  console.log("[openstreetmap] recherche des établissements avec site web…");
  const query = `[out:json][timeout:120];(nwr["website"]["name"](${SOPHIA_BBOX});nwr["contact:website"]["name"](${SOPHIA_BBOX}););out tags center;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": "sophia-jobs-crawler/1.0" },
        body: new URLSearchParams({ data: query }),
      });
      const txt = await res.text();
      if (!txt.trim().startsWith("{")) continue;

      const elements = JSON.parse(txt).elements || [];
      const list = elements
        .map((el) => {
          const tags = el.tags || {};
          const site = (tags.website || tags["contact:website"] || "").trim();
          if (!site || !/^https?:\/\//i.test(site)) return null;
          if (SOCIAL_OR_NOISE.test(site)) return null;
          return {
            name: prettyName(tags.name),
            site: site.replace(/\/$/, ""),
            description: tags.description || "",
            sectors: [tags.office, tags.industrial, tags.craft, tags.shop, tags.amenity]
              .filter(Boolean)
              .slice(0, 2),
            city: tags["addr:city"] || null,
            sources: ["openstreetmap"],
          };
        })
        .filter(Boolean);

      console.log(`[openstreetmap] ${list.length} établissements avec site web.`);
      return list;
    } catch {
      /* endpoint suivant */
    }
  }

  console.log("[openstreetmap] aucun serveur Overpass disponible, source ignorée.");
  return [];
}

// ---------------------------------------------------------------------------
// Résolution optionnelle des sites web manquants (devine + vérifie le domaine)
// ---------------------------------------------------------------------------
function normalizeForDomain(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(sas|sasu|sarl|eurl|sa|snc|sci|scop|sarl unipersonnelle)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function candidateDomains(name) {
  const words = normalizeForDomain(name).split(" ").filter(Boolean);
  if (!words.length) return [];
  const joined = words.join("");
  const hyphen = words.join("-");
  const bases = [...new Set([joined, hyphen, words[0]])].filter((b) => b.length >= 4 && b.length <= 30);
  const tlds = [".com", ".fr", ".io", ".ai", ".eu"];
  const out = [];
  for (const b of bases) {
    for (const t of tlds) {
      out.push(`https://www.${b}${t}`);
      out.push(`https://${b}${t}`);
    }
  }
  return out.slice(0, 12);
}

/** Le site répond-il ET parle-t-il bien de cette entreprise ? */
async function verifyDomain(url, name) {
  const html = await fetchText(url);
  if (!html) return false;
  // Domaine parking / revente : à rejeter.
  if (/(nom de domaine (est )?(a vendre|en vente)|domain (is )?for sale|this domain (is|may be) for sale|buy this domain)/i.test(html)) {
    return false;
  }
  const text = stripTags(html.slice(0, 200000));
  if (text.length < 200) return false;
  const haystack = normalizeForDomain(text);
  const words = normalizeForDomain(name).split(" ").filter((w) => w.length > 2);
  if (!words.length) return false;
  const hits = words.filter((w) => haystack.includes(w)).length;
  return hits / words.length >= 0.5;
}

async function resolveSites(companies) {
  const targets = companies.filter((c) => !c.site);
  console.log(`[resolve] tentative de résolution pour ${targets.length} entreprises sans site…`);
  let found = 0;

  await pool(
    targets,
    async (company) => {
      for (const url of candidateDomains(company.name)) {
        if (await verifyDomain(url, company.name)) {
          company.site = url;
          company.sources = [...new Set([...(company.sources || []), "domain-guess"])];
          found++;
          return true;
        }
      }
      return false;
    },
    {
      concurrency: Math.max(CONCURRENCY, 16),
      onProgress: async (d, t) => {
        process.stdout.write(`\r  ${d}/${t} testées — ${found} sites trouvés`);
        // Sauvegarde intermédiaire : une interruption ne perd pas le travail fait.
        if (d % 250 === 0) await save(companies);
      },
    }
  );

  process.stdout.write("\n");
  console.log(`[resolve] ${found} sites web découverts.`);
}

async function save(companies) {
  await fs.writeFile(OUT_FILE, JSON.stringify(companies, null, 0), "utf-8");
}

// ---------------------------------------------------------------------------
function mergeCompanies(lists) {
  const key = (name) =>
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(sas|sasu|sarl|eurl|sa|snc|sci|scop|group|groupe|france|technologies?|solutions?)\b/g, "")
      .replace(/[^a-z0-9]/g, "");

  const byKey = new Map();
  for (const list of lists) {
    for (const c of list) {
      const k = key(c.name);
      if (!k) continue;
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, { ...c, sources: [...new Set(c.sources || [])] });
        continue;
      }
      existing.site = existing.site || c.site || null;
      existing.description = existing.description || c.description || "";
      existing.sectors = existing.sectors?.length ? existing.sectors : c.sectors || [];
      existing.city = existing.city || c.city || null;
      existing.sources = [...new Set([...(existing.sources || []), ...(c.sources || [])])];
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

async function main() {
  let companies;

  if (hasFlag("--resume")) {
    // Repart du fichier déjà généré (évite de rejouer les annuaires).
    companies = JSON.parse(await fs.readFile(OUT_FILE, "utf-8"));
    console.log(`[resume] ${companies.length} entreprises chargées depuis companies.json`);
  } else {
    const [sophia, valbonne, osm] = await Promise.all([
      fetchSophiaAntipolis(),
      fetchValbonne(),
      fetchOpenStreetMap(),
    ]);
    // Ordre = priorité : les sources qui fournissent un site web d'abord.
    companies = mergeCompanies([valbonne, osm, sophia]);
  }

  if (LIMIT > 0) companies = companies.slice(0, LIMIT);

  if (RESOLVE) await resolveSites(companies);

  await save(companies);

  const withSite = companies.filter((c) => c.site).length;
  console.log(
    `\n✅ ${companies.length} entreprises écrites dans src/data/companies.json (${withSite} avec site web crawlable).`
  );
  if (!RESOLVE) {
    console.log("   Astuce : relancez avec --resolve pour tenter de découvrir les sites manquants.");
  }
}

main().catch((err) => {
  console.error("Échec de la génération :", err);
  process.exit(1);
});
