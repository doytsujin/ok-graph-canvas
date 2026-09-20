import { animated, useSpring } from '@react-spring/web'
import { memo, useEffect, useState, type ReactNode } from 'react'
import type { FieldNode } from './types'
import { encodeState } from './encoding'
import { NodeShape, defaultShapeResolver, type ShapeResolver } from './shapes'

/**
 * Half-extent of a node in layout units at scale 1. Exported because
 * fit-to-extent has to pad the node bounding box by it — fitting to bare
 * center positions clips every node on the boundary in half.
 */
export const NODE_BASE_SIZE = 56 // px radius at scale 1

/**
 * Scale applied to the caption `<text>` inside the node group.
 *
 * Named rather than left as a literal because the camera has to predict how
 * wide a caption will be in order to frame it, and a magic number in two files
 * is a number that drifts in one of them. `fitToExtent` takes the width it
 * derives from this as an option; see the call in `FieldCanvas`.
 */
export const CAPTION_SCALE = 0.018

/** Nominal font size of the caption, in px, before `CAPTION_SCALE`. */
export const CAPTION_FONT_PX = 16

export type GraphNodeProps = {
  node: FieldNode
  x: number
  y: number
  highlighted?: boolean
  selected?: boolean
  pulsing?: boolean
  hovered?: boolean
  dimmed?: boolean
  /** Primary stroke color — supplied by the host's theming, not looked up here. */
  color?: string
  /**
   * Group-caption color. Defaults to `--gc-fg-muted` with the light canvas's
   * slate as its fallback.
   */
  captionColor?: string
  /**
   * Node-name color. Defaults to `--gc-fg` with the light canvas's near-black
   * as its fallback, so a host that sets the variables gets labels in its own
   * palette and a host that sets nothing is unchanged.
   *
   * These two were the last hardcoded colors in the canvas, and they were the
   * ones that mattered most: a near-black name on a dark surface is not a
   * muted label, it is an invisible one, and the node it belongs to is drawn
   * perfectly well right above it.
   */
  labelColor?: string
  shapeResolver?: ShapeResolver
  showCaption?: boolean
  onClick?: (id: string) => void
  onHover?: (id: string | null) => void
  /** Hover affordances. Rendered inside a pre-scaled SVG group. */
  renderActions?: (node: FieldNode) => ReactNode
  /** Shown when `node.state === 'pending_human'`, in the same pre-scaled group. */
  renderApproval?: (node: FieldNode) => ReactNode
}

/**
 * One field node: shape + state badge + caption + (on hover) action
 * affordances.
 *
 * Position and scale are spring-animated so that a projection switch glides
 * rather than cutting — which is the whole reason node identity is preserved
 * across projections upstream in `useFieldLayout`.
 */
/**
 * Raised above its neighbours, which are themselves raised above the field.
 *
 * The gap between the two is deliberately wide. At 1.24 against 1.10 the
 * primary and its neighbours read as the same size and the selection answers
 * only "what is connected", losing "what did I click".
 */
const SELECTED_SCALE = 1.32
const LINKED_SCALE = 1.08
const HOVER_SCALE = 0.06
/**
 * How far the unselected field recedes.
 *
 * Dim enough to read as background, not so dim that the shape of the graph is
 * lost — the point of selecting a node is to see what it sits among.
 */
const RECEDED_OPACITY = 0.32
const SELECTED_SHADOW = 'drop-shadow(0 0.045px 0.05px rgba(15, 23, 42, 0.5))'
const LINKED_SHADOW = 'drop-shadow(0 0.025px 0.035px rgba(15, 23, 42, 0.33))'

/**
 * Memoised, because a field of a few hundred nodes re-renders all of them on
 * every hover and every selection otherwise. Only the handful whose
 * `selected`, `highlighted` or `dimmed` actually changed need to redraw; the
 * rest compare equal and are skipped.
 */
export const GraphNode = memo(function GraphNode(props: GraphNodeProps) {
  const {
    node,
    x,
    y,
    highlighted = false,
    selected = false,
    pulsing = false,
    hovered = false,
    dimmed = false,
    color = '#7c3aed',
    captionColor = 'var(--gc-fg-muted, #475569)',
    labelColor = 'var(--gc-fg, #0f172a)',
    shapeResolver = defaultShapeResolver,
    showCaption = true,
    onClick,
    onHover,
    renderActions,
    renderApproval,
  } = props

  const [localHover, setLocalHover] = useState(false)
  const isHover = hovered || localHover

  /**
   * Three tiers, not two.
   *
   * A selection says two things at once — this is the node I picked, and these
   * are the ones it reaches. Drawing both at one size answers the second and
   * loses the first, so the primary stays visibly the largest and its
   * neighbours rise with it.
   */
  const lift = selected ? SELECTED_SCALE : highlighted ? LINKED_SCALE : 1
  // Snapshot-spring transitions (Scope feel) — damping ~18, stiffness ~100.
  const styles = useSpring({
    x,
    y,
    scale: isHover ? lift + HOVER_SCALE : lift,
    config: { tension: 100, friction: 18, precision: 0.1 },
  })

  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (!pulsing) return
    setPulse(1)
    const t = window.setTimeout(() => setPulse(0), 1100)
    return () => window.clearTimeout(t)
  }, [pulsing])

  const state = encodeState(node.state)
  const awaitingApproval = node.state === 'pending_human'

  return (
    <animated.g
      transform={styles.x.to(
        (vx) =>
          `translate(${vx}, ${styles.y.get()}) scale(${
            styles.scale.get() * NODE_BASE_SIZE
          })`,
      )}
      style={{
        cursor: 'pointer',
        opacity: dimmed ? RECEDED_OPACITY : 1,
        // Shadow lengths are in user units, not screen pixels: this group is
        // already scaled by NODE_BASE_SIZE, so a value written as `4px` would
        // be drawn 56 times too large. These are the screen sizes divided
        // through by that scale.
        filter: selected ? SELECTED_SHADOW : highlighted ? LINKED_SHADOW : undefined,
        transition: 'opacity 180ms ease-out',
      }}
      onMouseEnter={() => {
        setLocalHover(true)
        onHover?.(node.id)
      }}
      onMouseLeave={() => {
        setLocalHover(false)
        onHover?.(null)
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(node.id)
      }}
    >
      {pulse > 0 && (
        <circle r={1.2} fill="none" stroke={color} strokeWidth={0.08} opacity={0.55} />
      )}

      <NodeShape
        kind={shapeResolver(node)}
        id={node.id}
        color={color}
        highlighted={selected || highlighted}
        metricNumericValue={node.metric?.value ?? null}
        metricColor={node.metric?.color}
        metricFormattedValue={node.metric?.formatted}
      />

      {/* execution-state badge — top-right of the unit shape */}
      {state && (
        <g transform="translate(0.72, -0.72)">
          {state.animated && (
            <circle r={0.28} fill={state.color} opacity={0.25}>
              <animate
                attributeName="r"
                values="0.22;0.36;0.22"
                dur="1.6s"
                repeatCount="indefinite"
              />
            </circle>
          )}
          <circle r={0.17} fill={state.color} stroke="#fff" strokeWidth={0.05} />
          <title>{state.label}</title>
        </g>
      )}

      {showCaption && (
        <g transform="translate(0, 1.25)">
          <text
            textAnchor="middle"
            dominantBaseline="hanging"
            transform={`scale(${CAPTION_SCALE})`}
            // Through `style`, not the `fill` attribute. These colors may be a
            // `var()`, and a presentation attribute is not a CSS declaration --
            // support for substitution there is a browser-by-browser matter,
            // and where it is missing the attribute is simply invalid and the
            // text falls back to black. An inline style is a declaration
            // everywhere.
            style={{ fill: labelColor, fontWeight: 600, pointerEvents: 'none' }}
          >
            {node.label}
          </text>
          {node.group && (
            <text
              textAnchor="middle"
              dominantBaseline="hanging"
              transform="translate(0, 0.32) scale(0.013)"
              style={{ fill: captionColor, pointerEvents: 'none' }}
            >
              {node.group}
            </text>
          )}
        </g>
      )}

      {/*
        Approval outranks the hover affordances: a node waiting on a human is
        the one thing that must stay actionable without hovering it first.
      */}
      {awaitingApproval && renderApproval && (
        <g transform="translate(0, -1.35) scale(0.018)">{renderApproval(node)}</g>
      )}

      {isHover && !awaitingApproval && renderActions && (
        <g transform="translate(0, -1.35) scale(0.018)">{renderActions(node)}</g>
      )}
    </animated.g>
  )
})
