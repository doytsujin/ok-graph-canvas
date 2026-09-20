import { memo } from 'react'
import { animated, useSpring, type SpringValue } from '@react-spring/web'
import type { SemanticLinkEnvelope } from './types'
import { encodeLink } from './encoding'

export type GraphEdgeProps = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  envelope?: SemanticLinkEnvelope
  highlighted?: boolean
  /** Legacy traffic signal, used when the link carries no envelope. */
  active?: boolean
  /** Link does not participate in the active projection. */
  dimmed?: boolean
  /**
   * Pushed back because something else is selected.
   *
   * Deliberately not `dimmed`. That one means the active projection excluded
   * this link, and it also stops the link being clickable — correct for a link
   * taking no part in the layout, wrong for one that is merely not the thing
   * you just clicked. A receded link is still yours to select.
   */
  receded?: boolean
  onHover?: (id: string | null) => void
  onClick?: (id: string) => void
}

/** Arc between two points, as an SVG elliptical-arc command. */
function arcPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const dr = Math.sqrt(dx * dx + dy * dy) * 1.2
  if (dr === 0) return ''
  return `M ${x1} ${y1} A ${dr} ${dr} 0 0 1 ${x2} ${y2}`
}

type Springs = {
  x1: SpringValue<number>
  y1: SpringValue<number>
  x2: SpringValue<number>
  y2: SpringValue<number>
}

const interpArc = (s: Springs) =>
  s.x1.to((vx1) => arcPath(vx1, s.y1.get(), s.x2.get(), s.y2.get()))

const interpMid = (s: Springs) =>
  s.x1.to((vx1) => {
    const mx = (vx1 + s.x2.get()) / 2
    const my = (s.y1.get() + s.y2.get()) / 2
    return `translate(${mx}, ${my})`
  })

/**
 * A semantic link, rendered as a curved arrow whose stroke encodes the
 * envelope (see `encoding.ts` for the channel assignments).
 *
 * The arrowhead marker is keyed per edge rather than per visual state: once
 * stroke color became a function of `policy_compat`, a shared marker id would
 * have made every arrowhead adopt the color of whichever edge mounted first.
 */
/**
 * Memoised for the same reason as GraphNode: a field with a few hundred links
 * re-drew every one of them on every hover.
 */
export const GraphEdge = memo(function GraphEdge(props: GraphEdgeProps) {
  const {
    id,
    x1,
    y1,
    x2,
    y2,
    envelope,
    highlighted = false,
    active = false,
    dimmed = false,
    receded = false,
    onHover,
    onClick,
  } = props

  const styles = useSpring({
    x1,
    y1,
    x2,
    y2,
    config: { tension: 100, friction: 18, precision: 0.1 },
  })

  const v = encodeLink({ envelope }, { highlighted, active })
  const markerId = `arrow-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`
  const opacity = dimmed
    ? v.strokeOpacity * 0.25
    : receded
      ? v.strokeOpacity * 0.3
      : v.strokeOpacity

  return (
    <g style={{ pointerEvents: dimmed ? 'none' : undefined }}>
      <defs>
        <marker
          id={markerId}
          viewBox="0 -5 10 10"
          refX={9}
          refY={0}
          markerWidth={6}
          markerHeight={6}
          orient="auto"
        >
          <path d="M0,-5L10,0L0,5" fill={v.stroke} />
        </marker>
      </defs>

      {/* governance halo — enforced, not merely declared */}
      {v.halo && (
        <animated.path
          d={interpArc(styles)}
          fill="none"
          stroke={v.stroke}
          strokeWidth={v.strokeWidth + 3}
          strokeOpacity={opacity * 0.3}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* invisible wide stroke so thin, low-readiness links stay clickable */}
      <animated.path
        d={interpArc(styles)}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ cursor: onClick ? 'pointer' : 'default' }}
        onMouseEnter={() => onHover?.(id)}
        onMouseLeave={() => onHover?.(null)}
        onClick={(e) => {
          e.stopPropagation()
          onClick?.(id)
        }}
      >
        {v.summary.length > 0 && <title>{v.summary.join(' · ')}</title>}
      </animated.path>

      <animated.path
        d={interpArc(styles)}
        fill="none"
        stroke={v.stroke}
        strokeWidth={v.strokeWidth}
        strokeOpacity={opacity}
        strokeDasharray={v.strokeDasharray}
        markerEnd={`url(#${markerId})`}
        style={{ pointerEvents: 'none', transition: 'stroke 120ms' }}
      />

      {/* relearning-pressure tick — evidence behind this link is going stale */}
      {v.tick && (
        <animated.g transform={interpMid(styles)} style={{ pointerEvents: 'none' }}>
          <path
            d="M -4 -4 L 4 4 M 4 -4 L -4 4"
            stroke={v.stroke}
            strokeWidth={1.6}
            strokeOpacity={opacity}
          />
        </animated.g>
      )}
    </g>
  )
})
