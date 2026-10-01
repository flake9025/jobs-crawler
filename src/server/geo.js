import { normalizeText } from "./util.js";

/**
 * Géographie des offres collectées sur les sites carrières.
 *
 * Les sites des grands groupes mélangent souvent les offres de toute la France
 * (voire du monde) : on étiquette la commune quand elle est reconnue et on écarte
 * les offres explicitement situées hors des Alpes-Maritimes et de Monaco.
 */

// Communes des Alpes-Maritimes et de Monaco, par ordre
// de priorité d'affichage.
// [libellé affiché, ...variantes d'écriture]
const LOCAL_PLACES = [
  ["Sophia Antipolis", "sophia antipolis", "sophia"],
  ["Valbonne", "valbonne"],
  ["Biot", "biot"],
  ["Mougins", "mougins"],
  ["Antibes", "antibes", "juan les pins"],
  ["Vallauris", "vallauris", "golfe juan"],
  ["Opio", "opio"],
  ["Roquefort-les-Pins", "roquefort les pins"],
  ["Le Rouret", "le rouret"],
  ["Châteauneuf-Grasse", "chateauneuf grasse", "chateauneuf de grasse"],
  ["Villeneuve-Loubet", "villeneuve loubet"],
  ["Cagnes-sur-Mer", "cagnes sur mer", "cagnes"],
  ["Mouans-Sartoux", "mouans sartoux"],
  ["Grasse", "grasse"],
  ["Pégomas", "pegomas"],
  ["La Roquette-sur-Siagne", "la roquette sur siagne"],
  ["Peymeinade", "peymeinade"],
  ["Cannes", "cannes", "cannes la bocca"],
  ["Le Cannet", "le cannet"],
  ["Mandelieu-la-Napoule", "mandelieu la napoule", "mandelieu"],
  ["Théoule-sur-Mer", "theoule sur mer"],
  ["La Colle-sur-Loup", "la colle sur loup"],
  ["Saint-Paul-de-Vence", "saint paul de vence", "st paul de vence"],
  ["Vence", "vence"],
  ["Tourrettes-sur-Loup", "tourrettes sur loup"],
  ["Saint-Jeannet", "saint jeannet"],
  ["La Gaude", "la gaude"],
  ["Gattières", "gattieres"],
  ["Carros", "carros"],
  ["Saint-Laurent-du-Var", "saint laurent du var", "st laurent du var"],
  ["Nice", "nice"],
  ["Saint-Martin-du-Var", "saint martin du var"],
  ["Colomars", "colomars"],
  ["Levens", "levens"],
  ["Contes", "contes"],
  ["La Trinité", "la trinite"],
  ["Drap", "drap"],
  ["Villefranche-sur-Mer", "villefranche sur mer"],
  ["Beaulieu-sur-Mer", "beaulieu sur mer"],
  ["Cap-d'Ail", "cap d ail"],
  ["Beausoleil", "beausoleil"],
  ["Roquebrune-Cap-Martin", "roquebrune cap martin"],
  ["Menton", "menton"],
  ["Monaco", "monaco", "monte carlo"],
  ["Saint-Vallier-de-Thiey", "saint vallier de thiey"],
  ["Puget-Théniers", "puget theniers"],
  ["Alpes-Maritimes", "alpes maritimes", "cote d azur"],
];

// Lieux clairement hors zone (autres métropoles françaises, étranger).
// Les noms ambigus (Tours, Pau, Nancy, Valence, Orange…) sont volontairement absents.
const DISTANT_PLACES = [
  // Île-de-France
  "paris", "ile de france", "la defense", "puteaux", "courbevoie", "nanterre", "boulogne billancourt",
  "issy les moulineaux", "levallois", "neuilly sur seine", "saint denis", "saint ouen", "montrouge",
  "malakoff", "chatillon", "clamart", "plessis robinson", "le plessis robinson", "meudon", "velizy",
  "guyancourt", "saint quentin en yvelines", "versailles", "massy", "palaiseau", "saclay", "orsay",
  "les ulis", "evry", "marne la vallee", "noisy le grand", "rueil malmaison", "suresnes", "bezons",
  "cergy", "ivry sur seine", "vincennes", "montreuil", "creteil", "argenteuil", "saint cloud",
  // Autres régions
  "lyon", "villeurbanne", "limonest", "ecully", "grenoble", "echirolles", "meylan", "montbonnot",
  "crolles", "toulouse", "blagnac", "colomiers", "labege", "bordeaux", "merignac", "pessac", "nantes",
  "saint herblain", "rennes", "cesson sevigne", "lannion", "brest", "lille", "villeneuve d ascq",
  "strasbourg", "illkirch", "montpellier", "marseille", "aix en provence", "aubagne", "vitrolles",
  "marignane", "la ciotat", "toulon", "la seyne sur mer", "hyeres", "frejus", "saint raphael",
  "draguignan", "avignon", "nimes", "perpignan", "metz", "reims", "rouen", "caen", "le havre",
  "orleans", "angers", "le mans", "poitiers", "niort", "la rochelle", "limoges", "clermont ferrand",
  "dijon", "besancon", "belfort", "mulhouse", "annecy", "chambery", "saint etienne", "bayonne",
  "biarritz", "amiens", "troyes", "chartres", "vannes", "lorient", "quimper", "saint nazaire",
  "cherbourg", "calais", "dunkerque", "valenciennes", "manosque", "cadarache", "ajaccio", "bastia",
  // Étranger
  "uk", "united kingdom", "england", "scotland", "london", "cambridge", "manchester", "edinburgh",
  "belfast", "bristol", "sheffield", "ireland", "dublin", "cork", "germany", "deutschland",
  "munich", "munchen", "berlin", "frankfurt", "hamburg", "stuttgart", "dresden", "erding",
  "bad homburg", "spain", "espana", "madrid", "barcelona", "valencia", "malaga", "portugal",
  "lisbon", "lisboa", "porto", "italy", "italia", "milan", "milano", "rome", "roma", "turin",
  "torino", "netherlands", "amsterdam", "eindhoven", "nijmegen", "belgium", "belgique", "brussels",
  "bruxelles", "leuven", "switzerland", "suisse", "geneve", "geneva", "zurich", "lausanne",
  "austria", "vienna", "wien", "graz", "poland", "warsaw", "warszawa", "krakow", "wroclaw", "torun",
  "gdansk", "czech republic", "prague", "brno", "romania", "bucharest", "bucuresti", "cluj", "iasi",
  "hungary", "budapest", "bulgaria", "sofia", "sweden", "stockholm", "lund", "norway", "oslo",
  "trondheim", "denmark", "copenhagen", "finland", "helsinki", "oulu", "tampere", "greece",
  "athens", "turkey", "turkiye", "istanbul", "israel", "tel aviv", "haifa", "india", "bangalore",
  "bengaluru", "pune", "hyderabad", "chennai", "noida", "gurgaon", "gurugram", "mumbai", "delhi",
  "kolkata", "china", "shanghai", "beijing", "shenzhen", "guangzhou", "chengdu", "suzhou", "tianjin",
  "taiwan", "taipei", "hsinchu", "japan", "tokyo", "osaka", "korea", "seoul", "singapore",
  "malaysia", "kuala lumpur", "penang", "thailand", "bangkok", "vietnam", "hanoi", "ho chi minh",
  "philippines", "manila", "taguig", "indonesia", "jakarta", "australia", "sydney", "melbourne",
  "usa", "united states", "new york", "san jose", "san francisco", "dallas",
  "houston", "chicago", "boston", "seattle", "miami", "atlanta",
  "san diego", "los angeles", "denver", "raleigh", "canada", "montreal", "toronto", "ottawa",
  "vancouver", "mexico", "guadalajara", "brazil", "brasil", "sao paulo", "colombia", "bogota",
  "argentina", "buenos aires", "costa rica", "morocco", "maroc", "casablanca", "rabat", "tunisia",
  "tunisie", "tunis", "egypt", "cairo", "dubai", "abu dhabi", "saudi arabia", "riyadh", "jeddah",
  "qatar", "doha", "south africa", "johannesburg",
];

const pad = (text) => ` ${normalizeText(text || "").replace(/[^a-z0-9]+/g, " ").trim()} `;
const REGION_RE = / (?:provence alpes cote d azur|region sud|paca) /;
const REGION_ALL_RE = new RegExp(REGION_RE.source, "g");

const LOCAL_KEYS = LOCAL_PLACES.map(([label, ...variants]) => ({
  label,
  zone: label === "Monaco" ? "monaco" : "alpes-maritimes",
  keys: variants.map((v) => pad(v)),
}));
const DISTANT_KEYS = DISTANT_PLACES.map((p) => pad(p));

function classifyPart(part) {
  if (!part) return { verdict: "unknown", label: null };
  const padded = pad(part);
  // La région entière est trop large pour conclure (Marseille en fait partie) ;
  // on la signale toutefois : « PACA » vaut mieux qu'un lieu inconnu.
  const region = REGION_RE.test(padded);
  const text = padded.replace(REGION_ALL_RE, " ");
  const monteCarloMethod = /\b(?:simulat\w*|method\w*|algorithm\w*|markov|mcmc)\b/.test(text);
  const places = LOCAL_KEYS.filter((place) => place.keys.some(
    (key) => text.includes(key) && (key !== " monte carlo " || !monteCarloMethod)
  ));
  const precise = places.filter((place) => place.label !== "Alpes-Maritimes");
  // Un identifiant /jobs/98000 n'est pas un code postal.
  const address = !/^(?:https?:\/\/|\/)/i.test(part.trim());
  const monaco = places.some((place) => place.zone === "monaco") || (address && / 980\d{2} /.test(text));
  const alpesMaritimes =
    precise.some((place) => place.zone === "alpes-maritimes") ||
    (address && (/ 06\d{3} /.test(text) || /\(06\)/.test(part))) ||
    (!monaco && places.some((place) => place.label === "Alpes-Maritimes"));
  const zones = [
    ...(alpesMaritimes ? ["alpes-maritimes"] : []),
    ...(monaco ? ["monaco"] : []),
  ];
  if (zones.length) {
    return {
      verdict: "local",
      label: precise[0]?.label || (monaco ? "Monaco" : places[0]?.label || null),
      zones,
    };
  }
  if (DISTANT_KEYS.some((k) => text.includes(k))) return { verdict: "distant", label: null };
  return { verdict: "unknown", label: null, region };
}

/**
 * Localise une offre à partir de plusieurs indices, du plus fiable au moins fiable
 * (champ lieu, intitulé, URL, texte autour du lien). Le premier indice concluant
 * l'emporte : un intitulé « … Paris » n'est pas repêché par l'adresse du siège
 * mentionnée plus loin dans la page.
 *
 * @returns {{verdict: "local"|"distant"|"unknown", label: string|null, zones?: string[], region?: boolean}}
 *   `region` : lieu inconnu mais situé en Provence-Alpes-Côte d'Azur.
 */
export function detectLocation(parts = []) {
  let region = false;
  for (const part of parts) {
    const result = classifyPart(part);
    if (result.verdict !== "unknown") return result;
    region = region || result.region;
  }
  return { verdict: "unknown", label: null, region };
}

/** Le libellé (facette ATS, champ lieu) désigne-t-il les Alpes-Maritimes ou Monaco ? */
export function isLocalPlace(text) {
  return classifyPart(text).verdict === "local";
}

/** Le champ explicite prime, même vide ; les anciens caches ne stockaient que le lieu. */
export function jobLocationZones(job) {
  return job.locationZones ?? detectLocation([job.location]).zones ?? [];
}

/** Une même URL peut être publiée pour plusieurs lieux : une carte, présente dans chaque zone. */
export function mergeJobLocations(jobs) {
  const byUrl = new Map();
  for (const job of jobs) {
    const zones = jobLocationZones(job);
    const existing = byUrl.get(job.url);
    if (!existing) {
      byUrl.set(job.url, { ...job, locationZones: [...zones] });
      continue;
    }
    const kept = (job.score ?? -1) > (existing.score ?? -1) ? job : existing;
    const combined = ["alpes-maritimes", "monaco"].filter(
      (zone) => existing.locationZones.includes(zone) || zones.includes(zone)
    );
    byUrl.set(job.url, {
      ...kept,
      locationZones: combined,
      location:
        combined.length > 1
          ? "Alpes-Maritimes / Monaco"
          : jobLocationZones(kept).length
            ? kept.location
            : zones.length ? job.location : existing.location,
    });
  }
  return [...byUrl.values()];
}
