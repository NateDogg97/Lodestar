/**
 * Where a meter's "typical" mark sits (the area page's CompareBar): the tick on the bar,
 * the ▲ right under it, and the scale's two end labels on the arrow's row. Pure: no UI.
 */

/**
 * The room an end label needs beside the arrow, as a share of a phone-width track: ~300px,
 * a caption character ~6.5px, plus the arrow's half-width and a gap. Wider tracks have
 * more room than this, so a label is never dropped on a phone and kept on a desktop
 * only to collide.
 */
const TRACK_PX = 300;
const CHAR_PX = 6.5;
const CLEAR_PX = 10;
const room = (label: string) => (100 * (label.length * CHAR_PX + CLEAR_PX)) / TRACK_PX;

export interface TypicalMark {
  /** The tick's and the arrow's position along the track, 0–100 (%). */
  at: number;
  /** False when the arrow would sit on that end's label: the label is left out. */
  showStart: boolean;
  showEnd: boolean;
}

/** The typical value's mark on a track running 0 → `top`, labelled `startText` … `endText`. */
export function typicalMark(typical: number, top: number, startText: string, endText: string): TypicalMark {
  const raw = top > 0 ? (100 * typical) / top : 0;
  const at = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
  return { at, showStart: at >= room(startText), showEnd: 100 - at >= room(endText) };
}
