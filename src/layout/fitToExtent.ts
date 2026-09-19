/**
 * Camera fit for the field canvas.
 *
 * Kept as a pure function rather than living inside `FieldCanvas`, because the
 * failure it exists to prevent — content rendered outside the viewport — is
 * invisible to a component test that never measures anything. Here it is
 * arithmetic, and `check.ts` can assert it.
 *
 * The canvas draws nodes under
 * `translate(t.x + w/2, t.y + h/2) scale(t.k)`, so a node at layout
 * coordinate `n` lands at `t.x + w/2 + t.k * n`. Framing the extent is
 * therefore: choose `k` from the ratio of viewport to extent, then translate
 * by `-k * center` so the extent's middle sits at the viewport's middle.
 */

export interface FitExtentInput {
  x: number
  y: number
  /**
   * The caption drawn under the node, if the host draws one.
   *
   * A `LaidOutNode` is a `FieldNode & {x, y}`, so this arrives for free from
   * the existing call — the label was always being handed to this function and
   * was simply not read.
   */
  label?: string
  /**
   * Measured half-width of the caption in layout units. Wins over `label`,
   * for a host that can measure text instead of estimating it.
   */
  labelHalfWidth?: number
}

export interface FitTransform {
  x: number
  y: number
  k: number
}

export interface FitOptions {
  /** Half-extent of a node in layout units. */
  nodeRadius?: number
  /** Extra room below a node for its caption, as a multiple of `nodeRadius`. */
  captionFactor?: number
  /** Breathing room around the fitted extent, in screen px. */
  padding?: number
  scaleExtent?: [number, number]
  /**
   * Layout units per caption character, used when a node gives `label` but no
   * measured `labelHalfWidth`.
   *
   * The host knows this exactly — it is the caption's scale times its font size
   * times the font's average advance — so `FieldCanvas` passes it rather than
   * relying on the default here.
   */
  labelCharWidth?: number
}

/**
 * Average glyph advance as a fraction of font size, for a 600-weight UI sans.
 * An estimate, and deliberately a slightly generous one: underestimating clips
 * a caption, which is the bug this exists to prevent, while overestimating only
 * zooms out marginally further than needed.
 */
export const AVG_GLYPH_ADVANCE_EM = 0.55

export const DEFAULT_FIT_OPTIONS = {
  nodeRadius: 56,
  captionFactor: 1.6,
  padding: 32,
  scaleExtent: [0.2, 4] as [number, number],
  // 0.018 caption scale x 16px nominal x 0.55 advance x 56 node radius.
  // Expressed as a number rather than a formula because this module must not
  // import from the renderer; `FieldCanvas` passes the exact value.
  labelCharWidth: 8.9,
}

/**
 * Half the width the caption will occupy, in layout units.
 *
 * A measured value is used when the host supplies one. Otherwise this is an
 * estimate from character count, which is wrong for proportional text in both
 * directions — "WWW" is wider than "iii" — but is far closer than the previous
 * behavior of assuming the caption had no width at all.
 */
export function estimateLabelHalfWidth(
  label: string | undefined,
  charWidth: number = DEFAULT_FIT_OPTIONS.labelCharWidth,
): number {
  if (!label) return 0
  return (label.length * charWidth) / 2
}

function labelHalfWidth(n: FitExtentInput, charWidth: number): number {
  if (Number.isFinite(n.labelHalfWidth)) return Math.max(0, n.labelHalfWidth as number)
  return estimateLabelHalfWidth(n.label, charWidth)
}

/**
 * Returns the transform that frames `nodes`, or `null` when there is nothing
 * to frame or nowhere to frame it. `null` means "leave the camera alone" — it
 * is not an error, and callers must not substitute an identity transform for
 * it, which would yank the view back to the origin on every empty update.
 */
export function fitToExtent(
  nodes: FitExtentInput[],
  width: number,
  height: number,
  options: FitOptions = {},
): FitTransform | null {
  const {
    nodeRadius = DEFAULT_FIT_OPTIONS.nodeRadius,
    captionFactor = DEFAULT_FIT_OPTIONS.captionFactor,
    padding = DEFAULT_FIT_OPTIONS.padding,
    scaleExtent = DEFAULT_FIT_OPTIONS.scaleExtent,
    labelCharWidth = DEFAULT_FIT_OPTIONS.labelCharWidth,
  } = options

  if (width <= 0 || height <= 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let seen = 0

  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue
    seen += 1

    // Pad by the node's own extent: fitting to bare center points clips every
    // node that ends up on the boundary.
    //
    // Horizontally that is not enough on its own. The caption is centered under
    // the node and is routinely wider than the node is — a forty-character
    // caption runs to roughly three times `nodeRadius` — so a fit that padded
    // by `nodeRadius` alone clipped the caption of every node that landed on
    // the left or right boundary. `captionFactor` did not cover this: it only
    // ever extended the extent downward.
    const half = Math.max(nodeRadius, labelHalfWidth(n, labelCharWidth))

    if (n.x - half < minX) minX = n.x - half
    if (n.x + half > maxX) maxX = n.x + half
    if (n.y - nodeRadius < minY) minY = n.y - nodeRadius
    if (n.y + nodeRadius * captionFactor > maxY) maxY = n.y + nodeRadius * captionFactor
  }

  if (seen === 0) return null

  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const usableW = Math.max(width - padding * 2, 1)
  const usableH = Math.max(height - padding * 2, 1)

  const k = Math.min(
    scaleExtent[1],
    Math.max(scaleExtent[0], Math.min(usableW / spanX, usableH / spanY)),
  )
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  return { x: -k * cx, y: -k * cy, k }
}

/** Where a layout coordinate lands on screen under a given transform. */
export function projectToScreen(
  n: FitExtentInput,
  t: FitTransform,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: t.x + width / 2 + t.k * n.x,
    y: t.y + height / 2 + t.k * n.y,
  }
}
