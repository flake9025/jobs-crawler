import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { isEmployerCompany, isEmployerPlace, osmActivitySectors } from "../src/data/employer-places.js";
import { SOPHIA_COMPANIES } from "../src/data/companies.js";
import { FEATURED_COMPANIES } from "../src/data/featured-companies.js";

test("OSM preserves employers from every sector, including public institutions", () => {
  const examples = [
    { office: "company" }, { shop: "hairdresser" }, { craft: "electrician" },
    { industrial: "factory" }, { amenity: "restaurant" }, { amenity: "school" },
    { amenity: "hospital" }, { healthcare: "laboratory" }, { amenity: "townhall" },
    { tourism: "hotel" }, { tourism: "camp_site" },
    { tourism: "museum", historic: "castle" }, { leisure: "fitness_centre" },
    { leisure: "golf_course" }, { club: "sport" },
    { tourism: "information", information: "office" },
    { amenity: "recycling", recycling_type: "centre" },
    { amenity: "bicycle_rental", bicycle_rental: "shop" },
    { name: "Communaute d'agglomeration de Sophia Antipolis", boundary: "administrative" },
    { name: "Diocese de Nice", boundary: "religious_administration" },
    { name: "Parc naturel regional des Prealpes d'Azur", boundary: "protected_area" },
    { name: "Axun" },
    { name: "Laboratoire de recherche", building: "university" },
    { office: "no", shop: "vacant", tourism: "hotel" },
  ];
  for (const tags of examples) assert.equal(isEmployerPlace(tags), true, JSON.stringify(tags));
});

test("OSM rejects transport routes, isolated equipment and geographic points", () => {
  const examples = [
    { type: "route", route: "bus" }, { type: "route_master", route_master: "train" },
    { highway: "bus_stop" }, { public_transport: "stop_position" }, { railway: "tram_stop" },
    { amenity: "parking" }, { amenity: "parking_entrance" }, { amenity: "charging_station" },
    { amenity: "bicycle_rental", bicycle_rental: "docking_station" },
    { amenity: "recycling", recycling_type: "container" }, { amenity: "atm" },
    { historic: "monument" }, { historic: "memorial" }, { tourism: "artwork" },
    { tourism: "information", information: "board" }, { tourism: "viewpoint" },
    { leisure: "park" }, { leisure: "playground" }, { natural: "peak" },
    { place: "city" }, { boundary: "administrative" }, { man_made: "monitoring_station" },
    { name: "Marineland (closed)", tourism: "zoo" },
    { shop: "vacant" }, { office: "closed" }, { tourism: "disused" },
  ];
  for (const tags of examples) assert.equal(isEmployerPlace(tags), false, JSON.stringify(tags));
});

test("the importer retains active sectors instead of obsolete tags", () => {
  const sectors = osmActivitySectors({ office: "no", shop: "vacant", tourism: "hotel" });
  assert.deepEqual(sectors, ["hotel"]);
  assert.equal(isEmployerCompany({ name: "Hotel", sectors, sources: ["openstreetmap"] }), true);
});

const osmCompany = (name, site = "https://example.org", sectors = []) => ({
  name, site, sectors, sources: ["openstreetmap"],
});

test("legacy directory cleanup removes known points without requiring OSM to be online", () => {
  const examples = [
    osmCompany("Bus 630 : Nice => Sophia Antipolis"),
    osmCompany("TGV 2242 : Nice-Ville => Strasbourg"),
    osmCompany("Ancienne ligne de Nice a Meyrargues"),
    osmCompany("Antibes"),
    osmCompany("Provence-Alpes-Cote d'Azur"),
    osmCompany("Parking", "https://q-park.fr", ["parking"]),
    osmCompany("Velobleu 302", "https://velobleu.org", ["bicycle_rental"]),
    osmCompany("Circuit du Carton", "https://www.ville-valbonne.fr/decouvrir/decouvrir-la-ville/sentiers-de-petites-randonnees"),
    osmCompany("Le Camp romain", "https://randoxygene.departement06.fr/pays-grassois/le-camp-romain-9312.html"),
    osmCompany("Chapelle des Combes", "https://www.envibus.fr/qrcode.html?id_arret=184"),
    osmCompany("Le Guetteur", "https://sosno.com/toutes-les-oeuvres/le-guetteur"),
    osmCompany("Pioupiou 500", "https://pioupiou.com/fr/500"),
    osmCompany("3 Pieces, Vue mer, Sea View on top floor", "https://airbnb.com"),
    osmCompany("Le MUR", "https://unwhiteit.com/lemur"),
    osmCompany("Local vacant", "https://example.org", ["vacant"]),
  ];
  for (const company of examples) assert.equal(isEmployerCompany(company), false, company.name);
});

test("legacy cleanup keeps ambiguous employers, lodging, culture, health and manually curated records", () => {
  const examples = [
    osmCompany("Le Castellas", "https://www.camping-le-castellas.com"),
    osmCompany("Parc des Maurettes", "https://www.parcdesmaurettes.com"),
    osmCompany("Jardins Vert d'Azur"),
    osmCompany("Jardin botanique Villa Thuret", "https://www.sophia.inra.fr/jardin_thuret"),
    osmCompany("Musee Picasso"),
    osmCompany("Laboratoire de biologie medicale"),
    osmCompany("Antibes", "https://example.org", ["company"]),
    osmCompany("Mairie d'Antibes", "https://example.org", ["townhall"]),
    osmCompany("Location de velos", "https://example.org", ["bicycle_rental"]),
    osmCompany("Entreprise au site inaccessible", "https://unreachable.invalid"),
    { ...osmCompany("Valbonne"), sources: ["ville-valbonne.fr", "openstreetmap"] },
    { ...osmCompany("Bus 630 : entreprise choisie manuellement"), sources: ["curated", "openstreetmap"] },
  ];
  for (const company of examples) assert.equal(isEmployerCompany(company), true, company.name);
});

test("the committed directory is clean and all featured employers remain available", () => {
  const directory = JSON.parse(fs.readFileSync(new URL("../src/data/companies.json", import.meta.url), "utf8"));
  assert.deepEqual(directory.filter((company) => !isEmployerCompany(company)).map((company) => company.name), []);
  const names = new Set(SOPHIA_COMPANIES.map((company) => company.name));
  for (const company of FEATURED_COMPANIES) assert.ok(names.has(company.name), company.name);
  for (const name of ["Le Castellas", "Parc des Maurettes", "Jardin botanique Villa Thuret", "Mairie d'Antibes-Juan-les-Pins"]) {
    assert.ok(names.has(name), name);
  }
  assert.ok(!names.has("Bus 630 : Nice => A\u00e9roport => Sophia Antipolis"));
});
