/**
 * How a hull reads at a given zoom, and how names are shortened.
 *
 * A hull is a folder with a fixed width: the name folds, never the geometry.
 * Widening a hull to fit a title would move every cable anchored to it, so the
 * label adapts and the layout stays still.
 */

/** Reading density of a hull's contents, set by the board scale alone. */
export type OverviewThreadHullDensity = "micro" | "short" | "detailed";

export const OVERVIEW_THREAD_HULL_MICRO_SCALE = 0.6;
export const OVERVIEW_THREAD_HULL_DETAILED_SCALE = 1.4;

/** Operator override for label density, beside the layout switch. */
export type OverviewThreadHullLabelMode = "auto" | "always" | "never";

export function overviewThreadHullDensity(
  scale: number,
  mode: OverviewThreadHullLabelMode = "auto",
): OverviewThreadHullDensity {
  if (mode === "never") return "micro";
  if (!Number.isFinite(scale)) return "short";
  if (mode === "always") {
    return scale >= OVERVIEW_THREAD_HULL_DETAILED_SCALE ? "detailed" : "short";
  }
  if (scale <= OVERVIEW_THREAD_HULL_MICRO_SCALE) return "micro";
  return scale >= OVERVIEW_THREAD_HULL_DETAILED_SCALE ? "detailed" : "short";
}

/** Hull controls are noise at a distance; below this scale they retract. */
export function overviewThreadHullControlsVisible(scale: number): boolean {
  return Number.isFinite(scale) && scale > OVERVIEW_THREAD_HULL_MICRO_SCALE;
}

export const OVERVIEW_THREAD_HULL_LABEL_MAX = 18;

/**
 * Shorten from the middle, keeping the tail.
 *
 * The end of an engineering title is what tells siblings apart — `rev C`,
 * `2.0→4.0 mm`, `v3`. Trailing ellipsis reads tidier and loses exactly the
 * distinguishing part, so the cut goes in the middle instead.
 */
export function overviewThreadHullLabel(
  title: string,
  max: number = OVERVIEW_THREAD_HULL_LABEL_MAX,
): string {
  const text = title.trim();
  if (max <= 1) return text.slice(0, Math.max(0, max));
  if (text.length <= max) return text;
  const tail = Math.max(1, Math.floor((max - 1) * 0.4));
  const head = Math.max(1, max - 1 - tail);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/**
 * How many characters the band can show at a given hull width.
 *
 * The band is monospaced, so the budget follows the hull's own width in
 * viewBox units rather than a fixed count: a lane of narrow hulls shortens
 * more than a lane of wide ones, and neither ever wraps to a second line.
 */
export function overviewThreadHullLabelBudget(hullWidth: number): number {
  if (!Number.isFinite(hullWidth)) return OVERVIEW_THREAD_HULL_LABEL_MAX;
  // Calibrated against the band's monospaced face: a cut that is too eager
  // destroys the distinguishing tail, while a slightly long name is merely
  // clipped by the band and stays readable.
  const characters = Math.floor(hullWidth / 5.2) - 1;
  return Math.min(OVERVIEW_THREAD_HULL_LABEL_MAX, Math.max(8, characters));
}

export interface OverviewThreadHullNameParts {
  readonly head: string;
  /** Kept whole, however narrow the row gets. Empty when there is no tail. */
  readonly tail: string;
}

/**
 * Split a row's name so the distinguishing end survives the ellipsis.
 *
 * The end of an engineering name is what tells siblings apart — `2.0→4.0 mm`,
 * `rev C`, `M8 inserts`. CSS can only trim the tail, so the tail is lifted into
 * its own unshrinkable span and the head takes the ellipsis. Splitting on the
 * name's own separator keeps the cut where the writer put a boundary; only a
 * name with no separator is cut mid-word.
 */
export function overviewThreadHullNameParts(
  label: string,
  maximumTail = 16,
): OverviewThreadHullNameParts {
  const text = label.trim();
  if (text.length <= maximumTail) return { head: text, tail: "" };
  const separators = [" — ", " · ", " – ", ": ", " - "];
  for (const separator of separators) {
    const at = text.lastIndexOf(separator);
    if (at <= 0) continue;
    const tail = text.slice(at + separator.length);
    if (tail.length > 0 && tail.length <= maximumTail) {
      return { head: text.slice(0, at + separator.length), tail };
    }
  }
  const at = text.lastIndexOf(" ", text.length - 2);
  if (at > 0 && text.length - at - 1 <= maximumTail) {
    return { head: text.slice(0, at + 1), tail: text.slice(at + 1) };
  }
  return { head: text.slice(0, -maximumTail), tail: text.slice(-maximumTail) };
}
