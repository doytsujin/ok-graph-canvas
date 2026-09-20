import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  /**
   * Detail for the selected node, shown as a popup anchored to that node while
   * the canvas is expanded.
   *
   * Expanding covers the page, which takes the host's own inspector with it --
   * usually a panel under the canvas, now somewhere off-screen. Selection still
   * works and nothing shows the result, so this is the same content brought
   * inside the viewport rather than a second way to say it.
   *
   * The host renders it, as with `renderActions`: the canvas positions a
   * surface and knows nothing about what goes in it. Not rendered when the
   * canvas is in the page, where the host's own inspector is visible.
   */
  renderExpandedDetail?: (node: FieldNode) => ReactNode
  /**
   * Render the "Maximize" affordance, which lifts the canvas out of its box and
   * over the whole viewport until dismissed.
   *
   * Off by default, unlike the Fit control: a component that can cover the
   * host's entire page is not something a host should acquire by upgrading.
   */
  showMaximizeControl?: boolean
  className?: string
}

const DEFAULT_REGISTRY = new ProjectionRegistry([similarityProjection])

const ZOOM_EXTENT: [number, number] = [0.2, 4]

/**
 * Stacking order of the expanded canvas.
 *
 * High enough to clear a host's sticky header, which is the thing it would
 * otherwise render underneath, and deliberately not the maximum -- a host's own
 * modal should still be able to sit above it.
 */
const EXPANDED_Z_INDEX = 9999

/**
 * Where the detail popup sits, given a node, a camera and a viewport.
 *
 * Extracted as a pure function because two paths need it and they must agree:
 * React when the popup first opens, and the zoom gesture, which moves it by
 * writing to the DOM without rendering anything.
 */
function placeDetail(
  n: { x: number; y: number },
  t: { x: number; y: number; k: number },
  size: { w: number; h: number },
  card: { w: number; h: number },
) {
  const sx = t.x + size.w / 2 + t.k * n.x
  const sy = t.y + size.h / 2 + t.k * n.y
  const r = NODE_BASE_SIZE * t.k

  let left = sx + r + DETAIL_GAP
  if (left + card.w + DETAIL_INSET > size.w) {
    const flipped = sx - r - DETAIL_GAP - card.w
    left = flipped >= DETAIL_INSET ? flipped : Math.max(DETAIL_INSET, size.w - card.w - DETAIL_INSET)
  }
  const top = Math.min(
    Math.max(DETAIL_INSET, sy - card.h / 2),
    Math.max(DETAIL_INSET, size.h - card.h - DETAIL_INSET),
  )
  return { left, top }
}

/** Width of the detail popup, in screen px. */
const PULSE_CSS = `
.gc-pulse { transform-box: fill-box; transform-origin: center; animation: gc-pulse 1.6s ease-in-out infinite; }
@keyframes gc-pulse { 0%,100% { transform: scale(0.8); opacity: 0.25 } 50% { transform: scale(1.3); opacity: 0.12 } }
@media (prefers-reduced-motion: reduce) { .gc-pulse { animation: none } }
`

/** Width of the detail popup, in screen px. */
const DETAIL_WIDTH = 280
/** Gap between the selected node's edge and the detail popup, in screen px. */
const DETAIL_GAP = 14
/** Keep-out margin from the viewport edge for the detail popup, in screen px. */
const DETAIL_INSET = 12

/**
 * Shared chrome for the canvas controls. Same contract as TraceLanes: variables
 * with light fallbacks, so a host with a dark palette gets controls that belong
 * to it, and a host that sets nothing still gets legible light ones.
 */
const CONTROL_STYLE: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 6,
  border: '1px solid var(--gc-line, #cbd5e1)',
  background: 'var(--gc-surface, rgba(255,255,255,0.9))',
  color: 'var(--gc-fg-muted, #475569)',
}
/** Breathing room around the fitted extent, in screen px. */
const FIT_PADDING = 32

/**
 * Layout units one caption character occupies, derived from how the caption is
 * actually drawn rather than guessed: `GraphNode` renders it at
 * `CAPTION_SCALE` inside a group already scaled by `NODE_BASE_SIZE`, at
 * `CAPTION_FONT_PX` nominal.
 *
 * The camera needs this because captions are centered under their node and are
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
    renderExpandedDetail,
    autoFit = true,
    showFitControl = true,
    showMaximizeControl = false,
    className = 'w-full h-full bg-gradient-to-b from-slate-50 to-slate-100 relative overflow-hidden',
  } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [size, setSize] = useState({ w: 1200, h: 800 })
  /**
   * The camera does not go through React.
   *
   * A pan or a zoom changes where the field is seen from, not what is in it —
   * yet routing every gesture frame through `setState` re-rendered the canvas
   * and all of its children. On a field of a few hundred nodes that is
   * thousands of SVG elements reconciled per mouse move, and it is felt as the
   * picture lagging the pointer and, under load, as a selection that never
   * draws at all. Firefox shows it far worse than Chrome, which is itself the
   * evidence that the cost is in rendering rather than in any arithmetic.
   *
   * The transform lives in a ref; the gesture writes the one attribute that
   * changed onto the scene group and nudges the popup. Render reads the ref,
   * so a re-render for some other reason still paints the current camera.
   */
  // Read inside a stable callback, so the handler identity does not change
  // with the selection and undo the memoisation of every node.
  const selectedIdRef = useRef<string | null>(selectedId)
  selectedIdRef.current = selectedId
  const transformRef = useRef<ZoomTransform>(zoomIdentity)
  const sceneRef = useRef<SVGGElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const sizeRef = useRef(size)
  sizeRef.current = size
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

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
        transformRef.current = event.transform
        applyCameraRef.current()
      })
    zoomRef.current = z
    svg.call(z as any)
    return () => {
      svg.on('.zoom', null)
    }
  }, [])

  const anchorRef = useRef<{ x: number; y: number } | null>(null)
  const applyCameraRef = useRef<() => void>(() => {})
  applyCameraRef.current = () => {
    const t = transformRef.current
    const sz = sizeRef.current
    sceneRef.current?.setAttribute(
      'transform',
      `translate(${t.x + sz.w / 2}, ${t.y + sz.h / 2}) scale(${t.k})`,
    )
    const card = cardRef.current
    const anchor = anchorRef.current
    if (card && anchor) {
      const p = placeDetail(anchor, t, sz, { w: card.offsetWidth, h: card.offsetHeight })
      card.style.left = `${p.left}px`
      card.style.top = `${p.top}px`
    }
  }

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
   * `-k * center` to put the extent's middle back at the viewport's middle.
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
    // Drive it through the behavior rather than setting state directly, or
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

  /**
   * Leave the expanded view, from the keyboard and without scrolling the page.
   *
   * A view that covers the viewport and can only be dismissed by finding its own
   * button again is a trap: the reader may well have scrolled somewhere else
   * before maximizing, and the page behind is no longer reachable to scroll
   * back. Escape is the exit; the body scroll lock is what keeps the page
   * underneath from drifting while it is unreachable.
   */
  useEffect(() => {
    if (!expanded) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      autoFitRef.current = true
      setExpanded(false)
    }
    window.addEventListener('keydown', onKey)

    // Restore the previous value rather than clearing it: a host that sets its
    // own overflow on the body must get that back, not `visible`.
    const body = document.body
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey)
      body.style.overflow = previousOverflow
    }
  }, [expanded])

  /**
   * Measure the box directly when it is lifted or returned, instead of waiting
   * for the ResizeObserver.
   *
   * RO delivers its callback at the end of the frame, so the expanded canvas
   * paints once at its old size and only then re-fits -- and under a throttled
   * renderer the callback may not arrive at all, which leaves the field drawn at
   * its in-page scale in the corner of a full viewport. Reading clientWidth here
   * forces the layout that has already been asked for and gets the fit into the
   * same frame as the expansion. The observer stays for the case it is actually
   * for: the host resizing the box underneath us.
   */
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    setSize({ w: el.clientWidth, h: el.clientHeight })
  }, [expanded])

  const toggleExpanded = useCallback(() => {
    // Hand the camera back to auto-fit before the box changes size. The resize
    // arrives asynchronously through the ResizeObserver, and the auto-fit effect
    // runs off the new dimensions -- so re-engaging here is what makes the field
    // fill the viewport it was just given, rather than sitting at its old scale
    // in the corner of a much larger box. The layout itself does not move: the
    // simulation is keyed on the node, link and projection identity, not on
    // width and height, so nothing re-scatters on the way in or out.
    autoFitRef.current = true
    setExpanded((v) => !v)
  }, [])

  // The popup is measured rather than assumed: its height depends entirely on
  // what the host put in it, and both the flip and the vertical clamp need a
  // real size to be correct rather than approximately correct.
  const detailRef = useRef<HTMLDivElement | null>(null)
  const [detailSize, setDetailSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = detailRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setDetailSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    setDetailSize({ w: el.offsetWidth, h: el.offsetHeight })
    return () => ro.disconnect()
  }, [expanded, selectedId])

  /**
   * Where the detail popup sits, in screen px.
   *
   * A node's screen position is the same composition the SVG group applies:
   * `translate(t.x + w/2, t.y + h/2) scale(t.k)` over its layout coordinate. So
   * the popup follows a pan or a zoom without anything having to tell it to --
   * it is derived from the transform, not stored.
   *
   * Right of the node by default, flipped left when it would cross the right
   * edge, and pinned inside the viewport when neither side fits, which is what
   * happens to a node selected at high zoom. Vertically centered on the node and
   * clamped the same way.
   */
  const detailPlacement = useMemo(() => {
    if (!expanded || !selectedId || !renderExpandedDetail) {
      anchorRef.current = null
      return null
    }
    const n = layout.nodes[selectedId]
    // A selected node can leave the field entirely -- a filter narrowing under a
    // selection is the ordinary case -- and then there is nothing to anchor to.
    if (!n) {
      anchorRef.current = null
      return null
    }
    anchorRef.current = { x: n.x, y: n.y }
    const p = placeDetail(n, transformRef.current, { w: size.w, h: size.h }, detailSize)
    return { ...p, node: n as FieldNode }
  }, [
    expanded,
    selectedId,
    renderExpandedDetail,
    layout,
    size.w,
    size.h,
    detailSize.w,
    detailSize.h,
  ])

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

  /**
   * Paint order, by reordering keyed children rather than by regrouping them.
   *
   * SVG has no z-index: what is drawn last is drawn on top, so a raised node
   * under an unraised neighbour still looks sunken. Sorting the array puts the
   * selected node last, its neighbours next-to-last, and the receded field
   * beneath both.
   *
   * It matters that this is a sort of one keyed list and not two lists in two
   * groups. React reorders keyed children in place; moving a node between
   * parents would unmount and remount it, and the spring carrying its position
   * would start over every time the selection changed.
   */
  /**
   * Stable handler identities.
   *
   * These were inline arrows, which meant every node and every link received a
   * new function on every render and no amount of memoising the children could
   * help: a selection re-rendered all 4,957 SVG elements of a 133-node field
   * and took five seconds to paint. The children are memoised now, and that is
   * only worth anything if their props actually compare equal.
   */
  /**
   * Clicking the selected node clears the selection.
   *
   * Otherwise the only way out is to find empty canvas, which on a dense field
   * there may not be — and the node you want to let go of is the one your
   * pointer is already on.
   */
  const handleNodeClick = useCallback(
    (id: string) => onSelect?.(id === selectedIdRef.current ? null : id),
    [onSelect],
  )
  const handleNodeHover = useCallback((id: string | null) => setHoverId(id), [])
  const handleLinkClick = useCallback((id: string) => onSelectLink?.(id), [onSelectLink])

  const paintOrder = useMemo(() => {
    const rank = (id: string) => (id === selectedId ? 2 : highlightSet.has(id) ? 1 : 0)
    return Object.values(layout.nodes).sort((a, b) => rank(a.id) - rank(b.id))
  }, [layout.nodes, selectedId, highlightSet])

  const linkPaintOrder = useMemo(() => {
    const rank = (e: (typeof layout.links)[number]) =>
      highlightSet.has(e.source) && highlightSet.has(e.target) ? 1 : 0
    return [...layout.links].sort((a, b) => rank(a) - rank(b))
  }, [layout.links, highlightSet])

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
      style={
        expanded
          ? {
              position: 'fixed',
              inset: 0,
              // Width and height are restated because the consumer's class
              // almost certainly carries its own -- `height: 30rem` on a class
              // would otherwise survive into the expanded view and pin a
              // full-width strip to the top of the screen.
              width: '100%',
              height: '100%',
              zIndex: EXPANDED_Z_INDEX,
              borderRadius: 0,
              // The element has left its parent box, so whatever background the
              // page gave that box is gone and the field would draw straight
              // over the page's own text. This overrides any background in
              // `className` for as long as the view is expanded.
              background: 'var(--gc-surface, #ffffff)',
            }
          : { position: 'relative' }
      }
      onClick={() => onSelect?.(null)}
    >
      {(showFitControl || showMaximizeControl) && (
        <div
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            zIndex: 1,
            display: 'flex',
            gap: 6,
          }}
        >
          {showFitControl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                autoFitRef.current = true
                fit()
              }}
              title="Fit the whole field in view"
              style={CONTROL_STYLE}
            >
              Fit
            </button>
          )}
          {showMaximizeControl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleExpanded()
              }}
              aria-pressed={expanded}
              title={
                expanded
                  ? 'Return the field to the page (Esc)'
                  : 'Expand the field to fill the viewport'
              }
              style={CONTROL_STYLE}
            >
              {expanded ? 'Exit' : 'Maximize'}
            </button>
          )}
        </div>
      )}
      {detailPlacement && renderExpandedDetail && (
        <div
          ref={(el) => {
            detailRef.current = el
            cardRef.current = el
          }}
          // Without this the click reaches the root, which clears the selection
          // -- so reading the popup would close it.
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: detailPlacement.left,
            top: detailPlacement.top,
            zIndex: 2,
            width: DETAIL_WIDTH,
            borderRadius: 10,
            border: '1px solid var(--gc-line, #cbd5e1)',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.16)',
            color: 'var(--gc-fg, #0f172a)',
            overflow: 'hidden',
            // Hidden for the one frame before it has been measured. Its own size
            // decides where it goes, so drawing it unmeasured would put it in
            // the wrong place and then move it.
            visibility: detailSize.h > 0 ? 'visible' : 'hidden',
          }}
        >
          {/*
            The translucency is a separate element rather than a background with
            an alpha, because the obvious ways to write one are both worse here:
            `opacity` on the card would fade the host's text along with the
            surface, and `color-mix()` on a single background has no fallback in
            an inline style -- where it is not supported the whole declaration is
            dropped and the card draws with no background at all, over a graph.
            A veil behind the content is understood everywhere, and the blur
            simply does not apply where `backdrop-filter` is missing.
          */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--gc-surface, #ffffff)',
              // Enough veil to read against a bright, high-contrast field --
              // below about 0.85 the labels behind it compete with the text in
              // front, and the blur cannot be relied on to make up the
              // difference because `backdrop-filter` is the first thing a
              // browser drops.
              opacity: 0.9,
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              pointerEvents: 'none',
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect?.(null)
            }}
            title="Clear the selection"
            aria-label="Clear the selection"
            style={{
              position: 'absolute',
              right: 6,
              top: 6,
              zIndex: 1,
              width: 20,
              height: 20,
              lineHeight: '18px',
              padding: 0,
              fontSize: 13,
              borderRadius: 5,
              border: '1px solid var(--gc-line, #cbd5e1)',
              background: 'var(--gc-surface, rgba(255,255,255,0.9))',
              color: 'var(--gc-fg-muted, #475569)',
            }}
          >
            ×
          </button>
          <div
            style={{
              position: 'relative',
              padding: '10px 12px',
              paddingRight: 30,
              // Capped against the viewport rather than a fixed number: a host
              // that renders a long descriptor should scroll inside the popup,
              // not run off the bottom of the screen.
              maxHeight: Math.max(120, size.h - DETAIL_INSET * 2),
              overflowY: 'auto',
            }}
          >
            {renderExpandedDetail(detailPlacement.node)}
          </div>
        </div>
      )}
      <svg ref={svgRef} width={size.w} height={size.h} style={{ display: 'block' }}>
        {/*
          One stylesheet, inside the SVG, so a host still imports no CSS for
          this component.

          It replaces a SMIL `<animate>` that every live node carried. SMIL
          animates the circle's `r`, which is geometry: each frame re-rasterises
          the shape and, in Firefox, invalidates a region of a tree that may
          hold thousands of elements. A CSS transform animates on the
          compositor and touches no geometry at all.

          `prefers-reduced-motion` is honoured because a pulsing badge is
          decoration, and the state it marks is legible without it.
        */}
        <style>{PULSE_CSS}</style>
        <g
          ref={sceneRef}
          transform={`translate(${transformRef.current.x + size.w / 2}, ${
            transformRef.current.y + size.h / 2
          }) scale(${transformRef.current.k})`}
        >
          {linkPaintOrder.map((e) => (
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
              receded={
                highlightSet.size > 0 &&
                !(highlightSet.has(e.source) && highlightSet.has(e.target))
              }
              onClick={onSelectLink ? handleLinkClick : undefined}
            />
          ))}

          {paintOrder.map((n) => (
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
              highlighted={highlightSet.has(n.id) && n.id !== selectedId}
              // Everything outside the selection recedes. Nothing recedes when
              // nothing is selected, so an untouched canvas is at full strength.
              dimmed={highlightSet.size > 0 && !highlightSet.has(n.id)}
              hovered={hoverId === n.id}
              pulsing={pulsingIds?.has(n.id) ?? false}
              onClick={handleNodeClick}
              onHover={handleNodeHover}
              renderActions={renderActions}
              renderApproval={renderApproval}
            />
          ))}
        </g>
      </svg>
    </div>
  )
}
