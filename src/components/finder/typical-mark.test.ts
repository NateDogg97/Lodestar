import { describe, expect, it } from "vitest";

import { typicalMark } from "./typical-mark";

describe("typicalMark", () => {
  it("places the mark at the typical value's share of the track", () => {
    // Violent crime: typical 248 on a 0–800 track.
    expect(typicalMark(248, 800, "0", "800+")).toEqual({ at: 31, showStart: true, showEnd: true });
  });

  it("keeps the mark on the track", () => {
    expect(typicalMark(-5, 100, "0", "100").at).toBe(0);
    expect(typicalMark(150, 100, "0", "100").at).toBe(100);
    expect(typicalMark(5, 0, "0", "0").at).toBe(0);
    expect(typicalMark(Number.NaN, 100, "0", "100").at).toBe(0);
  });

  it("leaves out an end label the arrow would sit on", () => {
    // A very high value stretches the track: the typical mark crowds the "0".
    const low = typicalMark(248, 9000, "0", "800+");
    expect(low.at).toBeCloseTo(2.76, 2);
    expect(low.showStart).toBe(false);
    expect(low.showEnd).toBe(true);
    // Near the far end, a long label goes first.
    const high = typicalMark(95, 100, "0", "4,000+");
    expect(high.showStart).toBe(true);
    expect(high.showEnd).toBe(false);
  });

  it("keeps both labels at every typical value the app shows on its default tracks", () => {
    const meters: [number, number, string][] = [
      [248, 800, "800+"], // violent crime
      [1324, 4000, "4,000+"], // property crime
      [10.6, 30, "30%+"], // work from home
      [25.7, 60, "60 min"], // commute
      [7.8, 15, "15+"], // PM2.5
      [13.5, 35, "35+"], // smoke days
    ];
    for (const [typical, top, end] of meters) {
      expect(typicalMark(typical, top, "0", end)).toMatchObject({ showStart: true, showEnd: true });
    }
  });
});
