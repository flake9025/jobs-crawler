import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { config } from "../src/server/config.js";
import { loadCache, getCacheJobs, getCompanyStats, isStale } from "../src/server/cache.js";

test("old non-employer records and their jobs are removed from persisted caches on startup", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sophia-jobs-cache-test-"));
  const previousFile = config.cache.file;
  config.cache.file = path.join(directory, "companies-cache.json");
  t.after(async () => {
    config.cache.file = previousFile;
    await fs.rm(directory, { recursive: true, force: true });
  });
  await fs.writeFile(config.cache.file, JSON.stringify({
    format: 4,
    updatedAt: new Date().toISOString(),
    jobs: [
      { company: "Amadeus", title: "Developpeur", url: "https://example.org/jobs/1234" },
      { company: "Antibes", title: "Ancienne offre", url: "https://example.org/jobs/5678" },
    ],
    companies: [{ name: "Amadeus", jobs: 1 }, { name: "Antibes", jobs: 1 }],
  }));
  await loadCache();
  assert.deepEqual(getCacheJobs().map((job) => job.company), ["Amadeus"]);
  assert.deepEqual(getCompanyStats().map((company) => company.name), ["Amadeus"]);
  assert.equal(isStale(), true, "location extraction changes require a new crawl");
  const persisted = JSON.parse(await fs.readFile(config.cache.file, "utf8"));
  assert.deepEqual(persisted.jobs.map((job) => job.company), ["Amadeus"]);
  assert.deepEqual(persisted.companies.map((company) => company.name), ["Amadeus"]);
});
