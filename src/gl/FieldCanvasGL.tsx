/**
 * The same field, drawn on the GPU.
 *
 * `FieldCanvas` puts every node and link in the DOM, which buys per-node
 * affordances and costs about 4,900 SVG elements for a 133-node field. That is
 * the ceiling: Firefox in particular spends a continuous slice of a core
 * painting it, and it gets worse linearly.
 *
 * This renderer is the answer already found in `dk-semantic-gateway-v2` for
 * the same problem — sigma over graphology, with the typed shapes drawn by a
 * WebGL polygon program rather than sprites. One canvas element, no DOM per
 * node.
 *
 * Two things it deliberately shares with the SVG renderer rather than
 * reinventing:
 *
 * * **The layout.** Both call `useFieldLayout`, so a field looks the same
 *   whichever renderer draws it and switching between them is not a relayout.
 * * **The host's vocabulary.** `colorForNode` and `shapeResolver` are the same
 *   props with the same meaning.
 *
 * What it gives up is stated plainly in the shape note: cloud, cylinder and
 * sheet have no regular-polygon form and draw as circles, and there are no
 * per-node React affordances — no hover actions, no approval buttons, no
 * captions with their own layout. That is the trade, and it is why this sits
 * beside `FieldCanvas` rather than replacing it.
 */
import { useEffect, useMemo, useRef } from 'react'
import Graph from 'graphology'
import Sigma from 'sigma'
import type { FieldNode, SemanticField } from '../types'
import { useFieldLayout } from '../layout/useFieldLayout'
import {
  ProjectionRegistry,
  similarityProjection,
  type ProjectionSpec,
} from '../layout/projections'
import { defaultShapeResolver, type ShapeResolver } from '../shapes'
import { encodeLink, encodeState } from '../encoding'
import { NodePolygonProgram, sidesForShape } from './NodePolygonProgram'

/**
 * Draw a node's caption the way the SVG renderer does.
 *
 * Sigma's own label sits to the right of the node in a single line. This
 * renderer's captions have always been centred underneath, with the group as
 * a smaller second line, and the two renderers drawing the same field should
 * not look like two different products. The state badge goes on here too
 * rather than into the shader: sigma's label pass is an ordinary 2D canvas, a
 * badge is a dot, and a dot does not need a shader.
 */
function drawCaption(
  context: CanvasRenderingContext2D,
  data: any,
  settings: any,
): void {
  const size = data.size ?? 8
  const font = settings.labelFont
  const weight = settings.labelWeight

  if (data.label) {
    context.fillStyle = data.labelColor ?? settings.labelColor.color ?? '#0f172a'
    context.font = `600 ${settings.labelSize}px ${font}`
    context.textAlign = 'center'
    context.fillText(data.label, data.x, data.y + size + settings.labelSize + 2)
  }
  if (data.group) {
    context.fillStyle = data.groupColor ?? '#64748b'
    context.font = `${weight} ${Math.max(9, settings.labelSize - 3)}px ${font}`
    context.textAlign = 'center'
    context.fillText(data.group, data.x, data.y + size + settings.labelSize * 2 + 2)
  }
  // Execution state, as the small badge the SVG renderer puts top-right.
  if (data.badge) {
    const bx = data.x + size * 0.72
    const by = data.y - size * 0.72
    const r = Math.max(2.5, size * 0.26)
    context.beginPath()
    context.arc(bx, by, r, 0, Math.PI * 2)
    context.fillStyle = data.badge
    context.fill()
    context.lineWidth = Math.max(1, r * 0.4)
    context.strokeStyle = '#ffffff'
    context.stroke()
  }
}

export interface FieldCanvasGLProps {
  field: SemanticField | null
  projection?: string
  registry?: ProjectionRegistry
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  colorForNode?: (node: FieldNode) => string
  shapeResolver?: ShapeResolver
  /** Synchronous simulation steps before the first paint. See `FieldCanvas`. */
  settle?: number
  /** Drawn size of a node, in sigma units. */
  nodeSize?: number
  captionColorForNode?: (node: FieldNode) => string
  labelColorForNode?: (node: FieldNode) => string
  className?: string
}

const DEFAULT_REGISTRY = new ProjectionRegistry([similarityProjection])
/** How far the field recedes when something is selected. */
const RECEDED = '#dfe5ec'
/** Sigma edge units per SVG stroke pixel. Found by looking, not derived. */
const EDGE_SCALE = 0.18
/** Links are context here; the nodes are the subject. */
const EDGE_FADE = 0.55

export function FieldCanvasGL(props: FieldCanvasGLProps) {
  const {
    field,
    projection,
    registry = DEFAULT_REGISTRY,
    selectedId = null,
    onSelect,
    colorForNode,
    shapeResolver = defaultShapeResolver,
    settle = 300,
    // Larger than sigma's default. The SVG renderer draws a node at a radius
    // of NODE_BASE_SIZE with a caption under it, and a field of small dots
    // does not read as the same picture.
    nodeSize = 11,
    captionColorForNode,
    labelColorForNode,
    className = 'w-full h-full',
  } = props

  const holder = useRef<HTMLDivElement | null>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const graphRef = useRef<Graph | null>(null)
  // Read by the reducers, which run per frame. Keeping them in refs is what
  // lets a selection or a hover repaint without React rendering anything.
  const selRef = useRef<string | null>(selectedId)
  const hoverRef = useRef<string | null>(null)
  const neighboursRef = useRef<Set<string>>(new Set())

  const spec: ProjectionSpec = useMemo(
    () => registry.get(projection) ?? similarityProjection,
    [registry, projection],
  )
  const layout = useFieldLayout(field, 1200, 800, spec, settle)

  /** Selected node plus whatever it touches. */
  const recomputeFocus = () => {
    const g = graphRef.current
    const id = hoverRef.current ?? selRef.current
    const set = new Set<string>()
    if (g && id && g.hasNode(id)) {
      set.add(id)
      g.forEachNeighbor(id, (n) => set.add(n))
    }
    neighboursRef.current = set
  }

  // Build the graph and the renderer. Rebuilt only when the field or its
  // layout changes -- never for a selection.
  useEffect(() => {
    if (!holder.current || !field) return
    const g = new Graph({ multi: true, type: 'undirected' })

    Object.values(layout.nodes).forEach((n) => {
      g.addNode(n.id, {
        x: n.x,
        y: -n.y, // sigma's y grows upward; the layout's grows downward
        size: nodeSize,
        label: n.label,
        color: colorForNode?.(n) ?? '#6d28d9',
        sides: sidesForShape(shapeResolver(n)),
        type: 'polygon',
        // Carried for the caption pass, which is where the second line and
        // the badge are drawn.
        group: n.group ?? '',
        labelColor: labelColorForNode?.(n),
        groupColor: captionColorForNode?.(n),
        badge: encodeState(n.state)?.color,
      })
    })
    layout.links.forEach((e) => {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) return
      // The same encoder the SVG renderer uses, so a link means the same
      // thing in both: confidence drives opacity, readiness drives width.
      const v = encodeLink({ envelope: e.envelope })
      // Sigma's edge size is not an SVG stroke width: at the same number the
      // lines come out several times heavier and the field turns into a mesh
      // with nodes floating on it. The ratios encodeLink expresses are kept;
      // only the scale is sigma's.
      const size = v.strokeWidth * EDGE_SCALE
      const color = fade(v.stroke, v.strokeOpacity * EDGE_FADE)
      g.addEdgeWithKey(e.id, e.source, e.target, { size, color, baseSize: size })
    })

    graphRef.current = g
    const renderer = new Sigma(g, holder.current, {
      nodeProgramClasses: { polygon: NodePolygonProgram },
      defaultNodeType: 'polygon',
      renderLabels: true,
      labelDensity: 0.28,
      labelGridCellSize: 140,
      labelRenderedSizeThreshold: 5,
      labelFont: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      labelSize: 12,
      labelColor: { color: '#0f172a' },
      defaultDrawNodeLabel: drawCaption,
      defaultDrawNodeHover: drawCaption,
      zIndex: true,
      nodeReducer: (node, data) => {
        const focus = neighboursRef.current
        const active = node === selRef.current
        if (focus.size === 0) return data
        if (active) return { ...data, size: data.size * 1.9, zIndex: 2 }
        if (focus.has(node)) return { ...data, size: data.size * 1.35, zIndex: 1 }
        // Receded: keep the shape, drop the colour. Replacing the type here
        // would erase the two things that identify a node, which is the
        // mistake the gateway's own note records having made.
        return { ...data, color: RECEDED, label: '', zIndex: 0 }
      },
      edgeReducer: (edge, data) => {
        const focus = neighboursRef.current
        if (focus.size === 0) return data
        const [s, t] = g.extremities(edge)
        if (focus.has(s) && focus.has(t)) return { ...data, size: data.baseSize * 2.2 }
        return { ...data, color: RECEDED, size: data.baseSize * 0.6 }
      },
    })

    renderer.on('clickNode', ({ node }) => onSelect?.(node === selRef.current ? null : node))
    renderer.on('clickStage', () => onSelect?.(null))
    renderer.on('enterNode', ({ node }) => {
      hoverRef.current = node
      recomputeFocus()
      renderer.refresh({ skipIndexation: true })
    })
    renderer.on('leaveNode', () => {
      hoverRef.current = null
      recomputeFocus()
      renderer.refresh({ skipIndexation: true })
    })

    sigmaRef.current = renderer
    recomputeFocus()
    renderer.refresh()
    return () => {
      renderer.kill()
      sigmaRef.current = null
      graphRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, layout, nodeSize])

  // A selection refreshes the reducers. It does not rebuild anything, and it
  // does not re-render a single React component per node.
  useEffect(() => {
    selRef.current = selectedId
    recomputeFocus()
    sigmaRef.current?.refresh({ skipIndexation: true })
  }, [selectedId])

  return <div ref={holder} className={className} style={{ position: 'relative' }} />
}


/**
 * Resolve a colour to `#rrggbb`, whatever notation it arrived in.
 *
 * `encodeLink` returns `hsl(...)` for policy compatibility, which sigma's
 * WebGL colour parser does not read — every policy-coloured link rendered
 * black, turning a field of faint slate lines into a dense mesh. The SVG
 * renderer never noticed because a browser parses `hsl()` happily.
 */
function toHex(color: string): string | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) return `#${hex[1].toLowerCase()}`
  const hsl = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i.exec(color)
  if (!hsl) return null
  const h = parseFloat(hsl[1]) / 360
  const sat = parseFloat(hsl[2]) / 100
  const l = parseFloat(hsl[3]) / 100
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat
  const pp = 2 * l - q
  const channel = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return pp + (q - pp) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return pp + (q - pp) * (2 / 3 - x) * 6
    return pp
  }
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  const r = to255(channel(h + 1 / 3))
  const g = to255(channel(h))
  const b = to255(channel(h - 1 / 3))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/**
 * Apply an alpha by blending toward the page, and return a hex.
 *
 * Not `rgba()`: sigma's edge program does not parse it either. The encoder's
 * opacity still means what it meant; it is expressed as a lighter colour
 * rather than as transparency.
 */
function fade(color: string, alpha: number, bg = '#ffffff'): string {
  const a = Math.max(0, Math.min(1, alpha))
  const f = toHex(color)
  const b = toHex(bg)
  if (!f || !b) return '#94a3b8'
  const n = (c: string) => parseInt(c.slice(1), 16)
  const fv = n(f)
  const bv = n(b)
  const mix = (sh: number) =>
    Math.round(((bv >> sh) & 255) + (((fv >> sh) & 255) - ((bv >> sh) & 255)) * a)
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`
}
