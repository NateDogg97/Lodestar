/**
 * Where a meter's marks sit (the area page's CompareBar): the ▼ pin at the value, with the
 * value written under the track beneath it; the hatched band for a typical US area; and
 * the scale's two end labels, left out where the value's label would run into them.
 * Pure: no UI.
 */

/**
 * Within this share of the US median a value is "about typical": the band's half-width,
 * and where the bar turns yellow instead of green or orange.
 */
export const TYPICAL_BAND = 0.1;

/**
 * The room labels need, as a share of a phone-width track: ~300px, a caption character
 * (the end labels) ~6.5px, a label-size semibold character (the value) ~7.5px, plus a gap.
 * Wider tracks have more room than this, so a label is never dropped on a phone and kept
 * on a desktop only to collide.
 */
const TRACK_PX = 300;
const CAPTION_CHAR_PX = 6.5;
const VALUE_CHAR_PX = 7.5;
const GAP_PX = 6;

export interface MeterMarks {
  /** The pin's position along the track, 0–100 (%); null with no value (no pin). */
  at: number | null;
  /** The typical band's start and end along the track, 0–100 (%). */
  band: [number, number];
  /** False when the value's label would sit on that end's label: the label is left out. */
  showStart: boolean;
  showEnd: boolean;
}

/** `x`'s share of a track running 0 → `top`, kept on the track. */
function along(x: number, top: number): number {
  const raw = top > 0 ? (100 * x) / top : 0;
  return Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
}

/**
 * The marks on a track running 0 → `top`, labelled `startText` … `endText`. The value's
 * label (`valueText`, plus `extraPx` for an icon beside it) is centred under the pin but
 * held inside the track; with no value it starts at the left end.
 */
export function meterMarks({
  value,
  typical,
  top,
  valueText,
  startText,
  endText,
  extraPx = 0,
}: {
  value: number | null;
  typical: number;
  top: number;
  valueText: string;
  startText: string;
  endText: string;
  extraPx?: number;
}): MeterMarks {
  const at = value === null || !Number.isFinite(value) ? null : along(value, top);
  const band: [number, number] = [along(typical * (1 - TYPICAL_BAND), top), along(typical * (1 + TYPICAL_BAND), top)];
  const width = valueText.length * VALUE_CHAR_PX + extraPx;
  const centre = at === null ? width / 2 : (at * TRACK_PX) / 100;
  const left = Math.max(0, Math.min(centre - width / 2, TRACK_PX - width));
  const right = left + width;
  return {
    at,
    band,
    showStart: left >= startText.length * CAPTION_CHAR_PX + GAP_PX,
    showEnd: TRACK_PX - right >= endText.length * CAPTION_CHAR_PX + GAP_PX,
  };
}
