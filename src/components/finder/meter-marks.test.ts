import { describe, expect, it } from "vitest";

import { meterMarks, TYPICAL_BAND } from "./meter-marks";

// Violent crime: typical 248 on a 0–800 track.
const violent = (value: number | null, valueText: string, top = 800) =>
  meterMarks({ value, typical: 248, top, valueText, startText: "0", endText: "800+" });

describe("meterMarks", () => {
  it("puts the pin at the value's share of the track", () => {
    expect(violent(400, "400 /100k").at).toBe(50);
    expect(violent(null, "—").at).toBeNull();
  });

  it("draws the typical band ±10% around the US median, where the bar turns yellow", () => {
    expect(TYPICAL_BAND).toBe(0.1);
    const [lo, hi] = violent(400, "400 /100k").band;
    expect(lo).toBeCloseTo(27.9, 5);
    expect(hi).toBeCloseTo(34.1, 5);
  });

  it("keeps every mark on the track", () => {
    const m = meterMarks({ value: 50, typical: 95, top: 100, valueText: "50", startText: "0", endText: "100" });
    expect(m.band).toEqual([85.5, 100]);
    expect(meterMarks({ value: Number.NaN, typical: 5, top: 0, valueText: "—", startText: "0", endText: "0" })).toMatchObject({
      at: null,
      band: [0, 0],
    });
  });

  it("keeps both end labels when the value sits mid-track", () => {
    expect(violent(400, "400 /100k")).toMatchObject({ showStart: true, showEnd: true });
  });

  it("leaves out an end label the value's label would sit on", () => {
    // A low value: its label is held at the left end, over the "0".
    expect(violent(96, "96 /100k")).toMatchObject({ showStart: false, showEnd: true });
    // A high value stretches the track to 1.1× it, so the pin is at 91%: the "800+" goes.
    expect(violent(780, "780 /100k", 858)).toMatchObject({ showStart: true, showEnd: false });
    // No value: the "—" starts at the left end.
    expect(violent(null, "—")).toMatchObject({ showStart: false, showEnd: true });
  });

  it("counts an icon beside the value", () => {
    // PM2.5 of 12 on a 0–15 track; the caution icon is ~18px with its margin.
    const at = { value: 12, typical: 7.8, top: 15, valueText: "12 µg/m³", startText: "0", endText: "15+" };
    expect(meterMarks(at).showEnd).toBe(true);
    expect(meterMarks({ ...at, extraPx: 18 }).showEnd).toBe(false);
  });
});
