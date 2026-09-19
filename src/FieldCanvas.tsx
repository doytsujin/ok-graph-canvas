import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { select } from 'd3-selection'
import {
  zoom,
  zoomIdentity,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3-zoom'
import type { FieldNode, SemanticField } from './types'
import { GraphNode, NODE_BASE_SIZE, CAPTION_SCALE, CAPTION_FONT_PX } from './GraphNode'
import { GraphEdge } from './GraphEdge'
import { useFieldLayout } from './layout/useFieldLayout'
import { fitToExtent, AVG_GLYPH_ADVANCE_EM } from './layout/fitToExtent'
import {
  ProjectionRegistry,
  similarityProjection,
  type ProjectionSpec,
} from './layout/projections'
import type { ShapeResolver } from './shapes'

export type FieldCanvasProps = {
  field: SemanticField | null
  /** Projection id. Unknown ids fall back to `similarity` rather than blanking. */
  projection?: string
  registry?: ProjectionRegistry
  selectedId?: string | null
  selectedLinkId?: string | null
  onSelect?: (id: string | null) => void
  onSelectLink?: (id: string | null) => void
  colorForNode?: (node: FieldNode) => string
  captionColorForNode?: (node: FieldNode) => string
  labelColorForNode?: (node: FieldNode) => string
  /**
   * Synchronous simulation steps to run before the first paint.
   *
   * 0 (the default) keeps the animated settle: the field renders at its seed
   * positions and spreads out over the following second or so. That reads well
   * for a live topology, where arrival is information. For a fixed field it
   * reads as the graph loading late, so a static host passes a step count here
   * and gets a settled picture in the first frame instead.
   */
  settle?: number
  shapeResolver?: ShapeResolver
  renderActions?: (node: FieldNode) => ReactNode
  renderApproval?: (node: FieldNode) => ReactNode
  /** Nodes to pulse once — newly added or removed. */
  pulsingIds?: Set<string>
  /**
   * Keep the whole field in view until the user takes over the camera.
   * Defaults on: a force layout sized for the node count routinely settles
   * wider than the viewport, and a canvas that silently renders its content
   * off-screen looks empty rather than zoomed.
   */
  autoFit?: boolean
  /** Render the "Fit" affordance that re-engages auto-fit after a manual zoom. */
  showFitControl?: boolean
  className?: string
}

const DEFAULT_REGISTRY = new ProjectionRegistry([similarityProjection])

const ZOOM_EXTENT: [number, number] = [0.2, 4]
/** Breathing room around the fitted extent, in screen px. */
const FIT_PADDING = 32

/**
 * Layout units one caption character occupies, derived from how the caption is
 * actually drawn rather than guessed: `GraphNode` renders it at
 * `CAPTION_SCALE` inside a group already scaled by `NODE_BASE_SIZE`, at
 * `CAPTION_FONT_PX` nominal.
 *
 * The camera needs this because captions are centred under their node and are
 * commonly wider than the node, so framing that ignores them clips the caption
 * of any node sitting on the left or right boundary.
 */
const LABEL_CHAR_WIDTH =
  CAPTION_SCALE * NODE_BASE_SIZE * CAPTION_FONT_PX * AVG_GLYPH_ADVANCE_EM

export function FieldCanvas(props: FieldCanvasProps) {
  const {
    field,
    projection,
    registry = DEFAULT_REGISTRY,
    selectedId = null,
    selectedLinkId = null,
    onSelect,
    onSelectLink,
    colorForNode,
    captionColorForNode,
    labelColorForNode,
    settle = 0,
    shapeResolver,
    renderActions,
    renderApproval,
    pulsingIds,
    autoFit = true,
    showFitControl = true,
    className = 'w-full h-full bg-gradient-to-b from-slate-50 to-slate-100 relative overflow-hidden',
  } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [size, setSize] = useState({ w: 1200, h: 800 })
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [hoverId, setHoverId] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  // Cleared the moment the user pans or zooms: the camera should stop chasing
  // the simulation as soon as somebody has an opinion about where to look.
  const autoFitRef = useRef(autoFit)

  useEffect(() => {
    if (!svgRef.current) return
    const svg = select(svgRef.current as SVGSVGElement)
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent(ZOOM_EXTENT)
      .on('zoom', (event) => {
        // `sourceEvent` is null for programmatic transforms, which is how a
        // fit is told apart from a user gesture.
        if (event.sourceEvent) autoFitRef.current = false
        setTransform(event.transform)
      })
    zoomRef.current = z
    svg.call(z as any)
    return () => {
      svg.on('.zoom', null)
    }
  }, [])

  const spec: ProjectionSpec = useMemo(
    () => registry.get(projection) ?? similarityProjection,
    [registry, projection],
  )

  const layout = useFieldLayout(field, size.w, size.h, spec, settle)

  /**
   * Frame the whole field.
   *
   * Screen position of a node is `translate(t.x + w/2, t.y + h/2) scale(t.k)`
   * applied to its layout coordinate, so mapping the node extent onto the
   * viewport is: pick `k` from the ratio of the two, then translate by
   * `-k * centre` to put the extent's middle back at the viewport's middle.
   */
  const fit = useCallback(() => {
    const svg = svgRef.current
    const z = zoomRef.current
    if (!svg || !z) return

    const t = fitToExtent(Object.values(layout.nodes), size.w, size.h, {
      nodeRadius: NODE_BASE_SIZE,
      padding: FIT_PADDING,
      scaleExtent: ZOOM_EXTENT,
      labelCharWidth: LABEL_CHAR_WIDTH,
    })
    // `null` means there is nothing to frame. Leave the camera where it is —
    // substituting identity would yank the view to the origin on every empty
    // update.
    if (!t) return

    const next = zoomIdentity.translate(t.x, t.y).scale(t.k)
    // Drive it through the behaviour rather than setting state directly, or
    // the next gesture resumes from d3's stale internal transform and jumps.
    select(svg).call(z.transform as any, next)
  }, [layout, size.w, size.h])

  // Re-frame while the simulation is still moving, then stop as soon as the
  // user takes the camera. Re-engaged by the Fit control.
  useEffect(() => {
    if (!autoFitRef.current) return
    fit()
  }, [fit])

  // A new field or a new projection is a new thing to look at, so the camera
  // is handed back to auto-fit even if the user had taken it.
  const fieldKey = field ? Object.keys(field.nodes).sort().join(',') : ''
  useEffect(() => {
    if (!autoFit) return
    autoFitRef.current = true
  }, [autoFit, fieldKey, projection])

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    if (!field) return map
    Object.values(field.links).forEach((e) => {
      if (!map.has(e.source)) map.set(e.source, new Set())
      if (!map.has(e.target)) map.set(e.target, new Set())
      map.get(e.source)!.add(e.target)
      map.get(e.target)!.add(e.source)
    })
    return map
  }, [field])

  const highlightSet = useMemo(() => {
    const set = new Set<string>()
    const seed = hoverId ?? selectedId
    if (seed) {
      set.add(seed)
      adjacency.get(seed)?.forEach((n) => set.add(n))
    }
    return set
  }, [hoverId, selectedId, adjacency])

  return (
    // `position: relative` is not decoration. The Fit control is absolutely
    // positioned, so without a containing block here it escapes to whatever
    // ancestor happens to be positioned -- in a plain page, the viewport, which
    // puts it in the corner of the document rather than the corner of the
    // canvas. Inline rather than in `className` because a consumer who passes no
    // class still needs it, and it cannot affect layout: establishing a
    // containing block changes nothing about where this element sits.
    //
    // Height stays the consumer's job. The SVG is sized from this element's
    // clientHeight, so the element needs a height from somewhere -- a class, a
    // grid cell, a flex child. An unsized parent renders an empty canvas.
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative' }}
      onClick={() => onSelect?.(null)}
    >
      {showFitControl && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            autoFitRef.current = true
            fit()
          }}
          title="Fit the whole field in view"
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            zIndex: 1,
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            background: 'rgba(255,255,255,0.9)',
            color: '#475569',
          }}
        >
          Fit
        </button>
      )}
      <svg ref={svgRef} width={size.w} height={size.h} style={{ display: 'block' }}>
        <g
          transform={`translate(${transform.x + size.w / 2}, ${
            transform.y + size.h / 2
          }) scale(${transform.k})`}
        >
          {layout.links.map((e) => (
            <GraphEdge
              key={e.id}
              id={e.id}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              envelope={e.envelope}
              highlighted={
                selectedLinkId === e.id ||
                (highlightSet.has(e.source) && highlightSet.has(e.target))
              }
              dimmed={!e.included}
              onClick={onSelectLink ? (id) => onSelectLink(id) : undefined}
            />
          ))}

          {Object.values(layout.nodes).map((n) => (
            <GraphNode
              key={n.id}
              node={n}
              x={n.x}
              y={n.y}
              color={colorForNode?.(n)}
              captionColor={captionColorForNode?.(n)}
              labelColor={labelColorForNode?.(n)}
              shapeResolver={shapeResolver}
              selected={selectedId === n.id}
              highlighted={highlightSet.has(n.id)}
              hovered={hoverId === n.id}
              pulsing={pulsingIds?.has(n.id) ?? false}
              onClick={(id) => onSelect?.(id)}
              onHover={(id) => setHoverId(id)}
              renderActions={renderActions}
              renderApproval={renderApproval}
            />
          ))}
        </g>
      </svg>
    </div>
  )
}
