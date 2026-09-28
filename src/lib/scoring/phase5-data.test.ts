import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatValue, parseCountyPayload } from ".";

const data = parseCountyPayload(
  JSON.parse(readFileSync(join(process.cwd(), "public/data/counties.json"), "utf8")),
);
const at = (fips: string) => data.indexByFips.get(fips)!;

describe("Phase 5 columns in the published data", () => {
  it("has hazards, unemployment and distances for (nearly) every county", () => {
    for (const key of ["hazard_risk", "unemployment_rate", "dist_airport_mi", "dist_coast_mi", "dist_metro_mi"] as const) {
      const known = Array.from(data.values[key]).filter((v) => !Number.isNaN(v)).length;
      expect(known / data.n, key).toBeGreaterThan(0.99);
    }
    expect(data.missingColumns).toEqual([]);
  });

  it("uses loss-rate percentiles, so a big county isn't automatically high-risk", () => {
    expect(data.values.hazard_hurricane[at("22071")]).toBeGreaterThan(90); // New Orleans
    expect(data.values.hazard_risk[at("48453")]).toBeLessThan(50); // Austin
  });

  it("measures distances from where people live", () => {
    const austin = at("48453");
    expect(data.text.nearest_airport[austin]).toBe("AUS");
    expect(data.values.dist_airport_mi[austin]).toBeLessThan(25);
    expect(data.text.nearest_metro[austin]).toMatch(/^Austin/);
    expect(data.values.dist_coast_mi[at("08031")]).toBeGreaterThan(600); // Denver
    expect(formatValue("dist_coast_mi", data.values.dist_coast_mi[at("12086")])).toMatch(/^\d+ mi$/);
  });
});
