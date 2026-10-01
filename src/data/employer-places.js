const OSM_ACTIVITY_KEYS = [
  "office", "industrial", "craft", "shop", "amenity", "tourism", "leisure", "healthcare", "club",
];

const INACTIVE = new Set(["no", "vacant", "closed", "disused", "abandoned", "demolished"]);
const NON_EMPLOYER_AMENITIES = new Set([
  "parking", "parking_entrance", "parking_space", "bicycle_parking", "bicycle_repair_station",
  "charging_station", "atm", "vending_machine", "post_box", "public_bookcase", "bench",
  "shelter", "toilets", "drinking_water", "water_point", "fountain", "waste_basket",
  "waste_disposal", "bbq", "grave_yard", "place_of_worship", "hunting_stand", "clock",
]);
const EMPLOYER_TOURISM = new Set([
  "hotel", "hostel", "motel", "guest_house", "apartment", "chalet", "camp_site", "caravan_site",
  "alpine_hut", "museum", "gallery", "theme_park", "zoo", "aquarium",
]);
const EMPLOYER_LEISURE = new Set([
  "sports_centre", "sports_hall", "fitness_centre", "stadium", "swimming_pool", "water_park",
  "golf_course", "miniature_golf", "bowling_alley", "amusement_arcade", "escape_game", "dance",
  "sauna", "horse_riding", "marina", "resort", "trampoline_park",
]);

const normalize = (value = "") => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
const values = (value = "") => value.split(";").map((v) => v.trim()).filter((v) => v && !INACTIVE.has(v));
const closedName = (name = "") => /\((?:closed|ferme(?:e)?(?: definitivement)?)\)\s*$/i.test(
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
);
const ORGANIZATION_NAME =
  /^(?:communaute d agglomeration|communaute de communes|metropole|syndicat mixte|diocese|academie de|association|parc naturel regional)\b/;

export function osmActivitySectors(tags = {}) {
  return [...new Set(OSM_ACTIVITY_KEYS.flatMap((key) => values(tags[key])))].slice(0, 2);
}

/** OSM decrit aussi des objets et des itineraires : un nom et un site ne suffisent pas. */
export function isEmployerPlace(tags = {}) {
  if (["route", "route_master"].includes(tags.type) || closedName(tags.name)) return false;
  if (OSM_ACTIVITY_KEYS.some((key) => tags[key]?.trim()) && !osmActivitySectors(tags).length) return false;
  if (["office", "industrial", "craft", "shop", "healthcare", "club"].some((key) => values(tags[key]).length)) {
    return true;
  }
  const amenities = values(tags.amenity);
  if (amenities.some((kind) => {
    if (NON_EMPLOYER_AMENITIES.has(kind)) return false;
    if (kind === "bicycle_rental") return tags.bicycle_rental === "shop";
    if (kind === "recycling") return tags.recycling_type === "centre";
    return kind !== "yes";
  })) return true;
  if (values(tags.tourism).some((kind) => EMPLOYER_TOURISM.has(kind))) return true;
  if (values(tags.leisure).some((kind) => EMPLOYER_LEISURE.has(kind))) return true;
  if (tags.tourism === "information" && tags.information === "office") return true;
  if (ORGANIZATION_NAME.test(normalize(tags.name))) return true;
  if (amenities.length) return false;
  if (["artwork", "viewpoint", "information", "picnic_site"].includes(tags.tourism)) return false;
  if (["park", "nature_reserve", "playground", "dog_park", "fitness_station", "pitch", "track"].includes(tags.leisure)) return false;
  if (tags.place || tags.boundary || tags.natural) return false;
  if (["monument", "memorial", "ruins", "archaeological_site", "wayside_cross", "wayside_shrine"].includes(tags.historic)) return false;
  if (["bus_stop", "platform"].includes(tags.highway) || ["stop_position", "platform"].includes(tags.public_transport)) return false;
  if (["tram_stop", "platform"].includes(tags.railway) || tags.man_made === "monitoring_station") return false;
  // Un type manquant ne suffit pas a supprimer une entreprise ou un laboratoire.
  return isEmployerCompany({
    name: tags.name,
    site: tags.website || tags["contact:website"],
    sources: ["openstreetmap"],
  });
}

// Les anciens imports ne conservaient ni tourism/leisure, ni les types de geometrie.
// Ces noms sans activite sont des territoires OSM, pas les mairies qui les administrent.
const LEGACY_TERRITORIES = new Set([
  "Alpes-Maritimes", "Provence-Alpes-Cote d'Azur", "Antibes", "Biot", "Cagnes-sur-Mer", "Cannes",
  "Chateauneuf-Grasse", "Grasse", "La Colle-sur-Loup", "Le Cannet", "Mandelieu-la-Napoule",
  "Mouans-Sartoux", "Mougins", "Pegomas", "Valbonne", "Vallauris", "Vence", "Villeneuve-Loubet",
].map(normalize));

/** Nettoyage conservateur des fiches deja generees, y compris avec --resume. */
export function isEmployerCompany(company) {
  const sources = company.sources || [];
  if (!sources.includes("openstreetmap") ||
      sources.some((source) => !["openstreetmap", "discover", "domain-guess"].includes(source))) return true;

  const name = normalize(company.name);
  if (closedName(company.name)) return false;
  if (/^(?:bus|tgv|ter|tram(?:way)?)\s+[^:]+:/i.test(company.name || "") ||
      /^ancienne ligne\b/.test(name)) return false;

  const rawSectors = company.sectors || [];
  const sectors = rawSectors.flatMap(values);
  if (rawSectors.some((sector) => sector.trim()) && !sectors.length) return false;
  if (sectors.length) {
    if (sectors.every((sector) => NON_EMPLOYER_AMENITIES.has(sector))) return false;
    if (sectors.includes("bicycle_rental") && /^(?:velobleu \d+|solexyclette)$/.test(name)) return false;
    return true;
  }
  if (LEGACY_TERRITORIES.has(name)) return false;

  const site = company.site || "";
  if (/^https?:\/\/randoxygene\.departement06\.fr(?:\/|$)/i.test(site)) return false;
  if (/^https?:\/\/(?:www\.)?ville-valbonne\.fr\/.*\/sentiers-de-petites-randonnees(?:[/?#]|$)/i.test(site)) return false;
  if (/^https?:\/\/(?:www\.)?envibus\.fr\/qrcode\.html[?#]/i.test(site)) return false;
  if (/^https?:\/\/(?:www\.)?sosno\.com\/toutes-les-oeuvres\//i.test(site)) return false;
  if (/^https?:\/\/(?:www\.)?pioupiou\.com\/[a-z]{2}\/\d+(?:[/?#]|$)/i.test(site)) return false;
  if (/^https?:\/\/(?:www\.)?airbnb\.[a-z.]+(?:\/|$)/i.test(site) && /^\d+ pieces?\b/.test(name)) return false;
  if (name === "le mur" && /^https?:\/\/(?:www\.)?unwhiteit\.com\/lemur(?:[/?#]|$)/i.test(site)) return false;
  if (name === "parc naturel forestier de la croix des gardes") return false;
  return true;
}
