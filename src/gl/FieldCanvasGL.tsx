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
import { NodePolygonProgram, sidesForShape } from './NodePolygonProgram'

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
  className?: string
}

const DEFAULT_REGISTRY = new ProjectionRegistry([similarityProjection])
/** How far the field recedes when something is selected. */
const RECEDED = '#dfe5ec'

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
    nodeSize = 7,
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
      })
    })
    layout.links.forEach((e) => {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) return
      g.addEdgeWithKey(e.id, e.source, e.target, {
        size: 0.8,
        color: '#cbd5e1',
      })
    })

    graphRef.current = g
    const renderer = new Sigma(g, holder.current, {
      nodeProgramClasses: { polygon: NodePolygonProgram },
      defaultNodeType: 'polygon',
      renderLabels: true,
      labelDensity: 0.25,
      labelGridCellSize: 120,
      labelRenderedSizeThreshold: 6,
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
        if (focus.has(s) && focus.has(t)) return { ...data, size: data.size * 2.2, color: '#94a3b8' }
        return { ...data, color: RECEDED, size: data.size * 0.6 }
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
