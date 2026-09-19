/**
 * How far apart the simulation has to hold two nodes.
 *
 * Separate module and a pure function so it can be asserted without a
 * simulation, a DOM or a React tree. The force in `useFieldLayout` is one line
 * that calls this.
 *
 * ── What this is for ─────────────────────────────────────────────────────────
 *
 * A node draws a glyph and then writes its caption *underneath*, centred. The
 * caption is routinely wider than the glyph, so separating on the glyph radius
 * packs the shapes correctly and still leaves the text of one node written
 * across the shape of the next. That was already known here — the collide force
 * carried a fixed radius of 105 chosen to clear a typical name — but a fixed
 * radius cannot clear an atypical one. A forty-character caption is about 182
 * units of half-width, well past 105, and it overlapped its neighbour.
 *
 * So the radius is per node and derived from the caption it actually has.
 *
 * ── The compromise, stated ───────────────────────────────────────────────────
 *
 * `forceCollide` is isotropic: it separates on a circle. Captions are wide and
 * short, so a radius large enough to clear a long caption horizontally also
 * pushes its node further than necessary *vertically*. The correct fix is a
 * rectangular collision force, which is a great deal more code than this and
 * needs its own convergence behaviour.
 *
 * This is the bounded version of the same idea: take the caption's half-width,
 * hold it to no less than the previous fixed radius so nothing regresses, and
 * cap it so one pathological label cannot spread an entire graph. Past the cap
 * a caption may still overlap, which is deliberate — beyond some width the
 * separation needed to avoid it costs more legibility than the overlap does.
 */

import { estimateLabelHalfWidth } from './fitToExtent'

export interface CollideOptions {
  /** Floor, and the radius used when a node has no caption. */
  base?: number
  /** Ceiling, so one very long caption cannot spread the whole graph. */
  max?: number
  /** Gap left between a caption's edge and the next node's. */
  margin?: number
  /** Layout units per caption character. */
  charWidth?: number
}

export const DEFAULT_COLLIDE_OPTIONS = {
  // The radius this force carried before it looked at captions at all.
  base: 105,
  // Three times the base. A caption past ~690 units wide is pathological, and
  // spreading the graph further to clear it reads worse than the overlap.
  max: 315,
  margin: 8,
}

export interface CollideInput {
  label?: string
}

export function collideRadius(node: CollideInput, options: CollideOptions = {}): number {
  const {
    base = DEFAULT_COLLIDE_OPTIONS.base,
    max = DEFAULT_COLLIDE_OPTIONS.max,
    margin = DEFAULT_COLLIDE_OPTIONS.margin,
    charWidth,
  } = options

  const wanted = estimateLabelHalfWidth(node.label, charWidth) + margin
  if (!Number.isFinite(wanted)) return base
  return Math.min(max, Math.max(base, wanted))
}
