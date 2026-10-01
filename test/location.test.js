import assert from "node:assert/strict";
import { test } from "node:test";
import { detectLocation, isLocalPlace, jobLocationZones, mergeJobLocations } from "../src/server/geo.js";
import { rankJobs } from "../src/server/ranking.js";
import { scrapeCompany } from "../src/server/sources/companies.js";

test("Monaco names and postcodes are distinct from Alpes-Maritimes", () => {
  for (const location of ["Monaco", "Monte-Carlo", "MC 98000", "98001 CEDEX", "Monaco, Cote d'Azur"]) {
    assert.deepEqual(detectLocation([location]).zones, ["monaco"], location);
    assert.equal(isLocalPlace(location), true);
  }
  for (const location of ["Sophia Antipolis", "Nice", "Beausoleil", "Cap-d'Ail", "Menton", "06560", "(06)"]) {
    assert.deepEqual(detectLocation([location]).zones, ["alpes-maritimes"], location);
  }
  assert.deepEqual(detectLocation(["Nice / Monaco"]).zones, ["alpes-maritimes", "monaco"]);
  assert.deepEqual(detectLocation(["06000 / 98000"]).zones, ["alpes-maritimes", "monaco"]);
});

test("classification follows the most reliable location and does not invent one", () => {
  assert.deepEqual(detectLocation(["Nice", "Client a Monaco"]).zones, ["alpes-maritimes"]);
  assert.equal(detectLocation(["Paris", "Monaco"]).verdict, "distant");
  for (const location of ["", "Non precise", "Teletravail", "France", "PACA", "98800"]) {
    assert.deepEqual(jobLocationZones({ location }), [], location);
  }
  assert.deepEqual(jobLocationZones({ location: "Monaco" }), ["monaco"]);
  assert.deepEqual(jobLocationZones({ location: "Sophia Antipolis", locationZones: [] }), []);
  assert.equal(detectLocation(["", "Simulation Monte Carlo", "/jobs/98000"]).verdict, "unknown");
  assert.equal(detectLocation(["", "Developpeur", "/jobs/06560"]).verdict, "unknown");
});

const job = (location, url = "https://example.org/job/1234") => ({
  title: "Developpeur Java H/F", company: "Employeur", location, url, source: "Entreprise: Employeur",
});

test("deduplication preserves separate posts in Monaco and Alpes-Maritimes", () => {
  const jobs = rankJobs([
    job("Monaco", "https://example.org/job/monaco-1234"),
    job("Nice", "https://example.org/job/nice-5678"),
    job("Nice", "https://other.example/job/nice-5678"),
  ], "java");
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((j) => j.locationZones[0]).sort(), ["alpes-maritimes", "monaco"]);
});

test("a single multi-location URL appears once and remains selectable in both zones", () => {
  const jobs = rankJobs([job("Monaco"), job("Nice")], "java");
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].locationZones, ["alpes-maritimes", "monaco"]);
  assert.equal(jobs[0].location, "Alpes-Maritimes / Monaco");
  const known = mergeJobLocations([{ ...job(""), score: 80 }, { ...job("Monaco"), score: 20 }]);
  assert.equal(known[0].score, 80);
  assert.equal(known[0].location, "Monaco");
  assert.deepEqual(known[0].locationZones, ["monaco"]);
});

test("career listings retain the location of each card rather than neighboring offers", async (t) => {
  const html = `<html><body><main>
    <article><a href="/jobs/1234">Developpeur Java H/F</a><span>Monaco</span></article>
    <article><a href="/jobs/5678">Developpeur Java H/F</a><span>Nice</span></article>
    <article><a href="/jobs/9101">Technicien H/F</a><span>Lieu non precise</span></article>
  </main></body></html>`;
  t.mock.method(globalThis, "fetch", async () => new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  }));
  const result = await scrapeCompany({
    name: "Employeur", site: "https://example.org", careerSite: "https://example.org/careers",
  });
  assert.equal(result.status, "ok");
  assert.equal(result.jobs.length, 3);
  const byUrl = new Map(result.jobs.map((j) => [new URL(j.url).pathname, j]));
  assert.deepEqual(byUrl.get("/jobs/1234").locationZones, ["monaco"]);
  assert.deepEqual(byUrl.get("/jobs/5678").locationZones, ["alpes-maritimes"]);
  assert.deepEqual(byUrl.get("/jobs/9101").locationZones, []);
  assert.equal(byUrl.get("/jobs/9101").location, "Non pr\u00e9cis\u00e9");
});
