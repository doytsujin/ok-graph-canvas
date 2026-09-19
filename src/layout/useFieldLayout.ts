import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force'
import type { FieldLink, FieldNode, SemanticField } from '../types'
import {
  buildProjectionContext,
  similarityProjection,
  type ProjectionSpec,
} from './projections'
import { collideRadius } from './collide'

export type LaidOutNode = FieldNode & {
  x: number
  y: number
  vx?: number
  vy?: number
}

export type LaidOutLink = FieldLink & {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Whether this link exerted layout force under the active projection. */
  included: boolean
}

export interface FieldLayout {
  nodes: Record<string, LaidOutNode>
  links: LaidOutLink[]
  /** Projection axis position per node, for axis labels / debugging. */
  scalars: Map<string, number | null>
}

/**
 * d3-force simulation whose anchor scheme is supplied by a projection.
 *
 * The node set is identical across projections — only the anchors, the
 * participating link set and the link strengths change. That is what makes
 * switching projections read as re-viewing one space rather than as loading a
 * different graph, and it is why node identity (and therefore position) is
 * preserved across the switch so react-spring can glide between them.
 */
export function useFieldLayout(
  field: SemanticField | null,
  width: number,
  height: number,
  projection: ProjectionSpec = similarityProjection,
  /**
   * Synchronous steps to run before the first paint. 0 keeps the animated
   * settle. Anything above 0 advances the simulation to rest inside the layout
   * effect, so the browser never paints the seed arrangement — the graph is
   * simply there in the first frame rather than assembling itself afterwards.
   */
  settle = 0,
): FieldLayout {
  const simRef = useRef<Simulation<any, any> | null>(null)
  const [tick, setTick] = useState(0)

  const nodeMapRef = useRef<Map<string, LaidOutNode>>(new Map())
  const lastNodeIdsRef = useRef<string>('')
  const lastLinkIdsRef = useRef<string>('')
  const lastProjectionRef = useRef<string>('')

  // Projection scalars + lanes are pure functions of (field, projection), so
  // they are computed once per change rather than per simulation tick.
  //
  // The server wins when it has ranked this exact projection: `field.projection`
  // naming the active id means every `node.rank` is authoritative, *including*
  // the absent ones — an omitted rank there is "the server has no opinion about
  // this node", not "the server didn't answer". Only when the field was never
  // ranked (a plain topology payload, or a different projection) does the client
  // fall back to computing its own. That fallback is what keeps the canvas
  // usable against a backend with no field service behind it.
  const { scalars, lanes } = useMemo(() => {
    const s = new Map<string, number | null>()
    const l = new Map<string, string>()
    if (!field) return { scalars: s, lanes: l }

    const serverRanked = field.projection === projection.id
    const ctx = serverRanked ? null : buildProjectionContext(field)

    Object.values(field.nodes).forEach((n) => {
      if (serverRanked) {
        s.set(n.id, typeof n.rank === 'number' ? n.rank : null)
      } else {
        s.set(n.id, projection.scalar && ctx ? projection.scalar(n, ctx) : null)
      }
      l.set(n.id, (projection.lane ? projection.lane(n) : n.group) ?? 'default')
    })
    return { scalars: s, lanes: l }
  }, [field, projection])

  const laneKeys = useMemo(
    () => Array.from(new Set(Array.from(lanes.values()))).sort(),
    [lanes],
  )

  // Layout effect, not a passive one: when `settle` is set the simulation is
  // advanced and the resulting state flushed before the browser paints.
  useLayoutEffect(() => {
    if (!field) return
    const nodeIds = Object.keys(field.nodes).sort().join(',')
    const linkIds = Object.keys(field.links).sort().join(',')
    const changed =
      nodeIds !== lastNodeIdsRef.current ||
      linkIds !== lastLinkIdsRef.current ||
      projection.id !== lastProjectionRef.current
    if (!changed && simRef.current) return

    lastNodeIdsRef.current = nodeIds
    lastLinkIdsRef.current = linkIds
    lastProjectionRef.current = projection.id

    const axisX = (v: number) => (v - 0.5) * width * 0.78
    const laneY = (key: string) => {
      const i = laneKeys.indexOf(key)
      return ((i + 0.5) / Math.max(laneKeys.length, 1) - 0.5) * height * 0.8
    }

    // Where an *unranked* node sits along the axis.
    //
    // The axis means "position by the projected scalar", and an unranked node
    // has no scalar, so there is no honest position for it — but 0 is not a
    // neutral answer, it is the middle of the axis, and sending every unranked
    // node there says "they are all identical on this measure" while also
    // making them unreadable. When a lane is entirely unranked, which is what
    // an adapted topology always looks like, the whole namespace lands on one
    // point.
    //
    // So unranked members of a lane are spread evenly across the width instead.
    // This carries no meaning and must not be read as one — the picture is a
    // list laid out sideways, and the footer already says `0 / 19 nodes ranked`
    // so the reader is told the axis is empty. Spacing chosen for legibility is
    // better than a coincidence that reads as agreement.
    const unrankedIndex = new Map<string, { i: number; of: number }>()
    for (const key of laneKeys) {
      const members = Object.values(field.nodes)
        .filter((n) => (lanes.get(n.id) ?? 'default') === key && scalars.get(n.id) == null)
        .map((n) => n.id)
        .sort()
      members.forEach((id, i) => unrankedIndex.set(id, { i, of: members.length }))
    }
    const spreadX = (id: string) => {
      const slot = unrankedIndex.get(id)
      if (!slot || slot.of <= 1) return 0
      return ((slot.i + 0.5) / slot.of - 0.5) * width * 0.72
    }

    // Preserve identity (and therefore position) for nodes that survive the
    // change; seed newcomers at their projected anchor.
    //
    // Unranked nodes must NOT all be seeded at the same point. Repulsion
    // between two bodies at identical coordinates has no direction to act
    // along, so a lane of coincident nodes stays coincident: every label draws
    // on top of every other, and the links between them have zero length and
    // render as nothing. That is what an adapted topology looks like — no
    // envelope scalars, so `scalars` is empty and *every* node is unranked —
    // and it made the canvas useless in exactly the case it has to work in.
    //
    // d3-force's own default initializer avoids this with a phyllotaxis spiral;
    // that default is bypassed here because x/y are set explicitly. So the
    // spiral is reproduced for the unranked case. It is deterministic (index,
    // not random), so a re-render does not reshuffle the picture, and the
    // radius stays inside the collide distance so the simulation still does the
    // real spacing — this only breaks the tie.
    const spiral = (i: number) => {
      const angle = i * 2.399963229728653 // golden angle, radians
      const radius = 24 * Math.sqrt(i + 0.5)
      return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius }
    }

    const next = new Map<string, LaidOutNode>()
    Object.values(field.nodes).forEach((n, i) => {
      const existing = nodeMapRef.current.get(n.id)
      if (existing) {
        Object.assign(existing, n) // refresh non-position fields
        next.set(n.id, existing)
      } else {
        const s = scalars.get(n.id)
        const jitter = s == null ? spiral(i) : { dx: 0, dy: 0 }
        next.set(n.id, {
          ...n,
          x: (s == null ? spreadX(n.id) : axisX(s)) + jitter.dx,
          y: laneY(lanes.get(n.id) ?? 'default') + jitter.dy,
        })
      }
    })
    nodeMapRef.current = next

    const include = projection.includeLink ?? (() => true)
    const weightOf = projection.linkWeight ?? (() => 0.35)

    const links = Object.values(field.links)
      .filter((e) => include(e) && e.source in field.nodes && e.target in field.nodes)
      .map((e) => ({ source: e.source, target: e.target, __link: e }))

    const nodeArr = Array.from(next.values())

    simRef.current?.stop()
    const sim = forceSimulation<LaidOutNode>(nodeArr)
      .force(
        'link',
        forceLink<LaidOutNode, any>(links)
          .id((d) => d.id)
          .distance(200)
          .strength((l: any) => 0.1 + 0.5 * weightOf(l.__link)),
      )
      // Spacing is set by what has to stay legible, not by the shape alone. A
      // node draws its glyph at roughly 110px across and then writes a name and
      // a namespace *underneath* it, and those labels are frequently wider than
      // the glyph — `traefik-9bcdbbd9-sfsnp` is not a short word. Separating on
      // the glyph radius alone packs shapes correctly and still leaves the text
      // overlapping, which is the part a reader actually needs.
      .force('charge', forceManyBody().strength(-900))
      // Per node, from the caption it actually carries. `collideRadius` holds
      // the old fixed 105 as its floor, so nothing that fitted before moves.
      .force('collide', forceCollide<LaidOutNode>((n) => collideRadius(n)))
      .force('center', forceCenter(0, 0))
      .force(
        'x',
        forceX<LaidOutNode>((n) => {
          const s = scalars.get(n.id)
          return s == null ? spreadX(n.id) : axisX(s)
        // Unranked nodes are held to their spread slot only weakly: enough to
        // keep the lane readable, loose enough that the link and collide forces
        // still decide the actual arrangement.
        }).strength((n: LaidOutNode) => (scalars.get(n.id) == null ? 0.08 : 0.22)),
      )
      .force(
        'y',
        forceY<LaidOutNode>((n) => laneY(lanes.get(n.id) ?? 'default')).strength(0.07),
      )
      .alpha(0.6)
      .alphaDecay(0.04)

    if (settle > 0) {
      // forceSimulation starts its own timer on construction, so stop it before
      // stepping by hand or the two advance the same bodies at once.
      sim.stop()
      sim.tick(settle)
      setTick((t) => (t + 1) % 1_000_000)
    } else {
      sim.on('tick', () => setTick((t) => (t + 1) % 1_000_000))
    }

    simRef.current = sim
    return () => {
      sim.stop()
    }
  }, [field, width, height, projection, scalars, lanes, laneKeys, settle])

  return useMemo(() => {
    const nodesOut: Record<string, LaidOutNode> = {}
    nodeMapRef.current.forEach((n, id) => {
      nodesOut[id] = n
    })
    const linksOut: LaidOutLink[] = []
    if (field) {
      const include = projection.includeLink ?? (() => true)
      Object.values(field.links).forEach((e) => {
        const s = nodesOut[e.source]
        const t = nodesOut[e.target]
        if (!s || !t) return
        linksOut.push({
          ...e,
          x1: s.x,
          y1: s.y,
          x2: t.x,
          y2: t.y,
          included: include(e),
        })
      })
    }
    return { nodes: nodesOut, links: linksOut, scalars }
    // `tick` is the heartbeat that re-renders during simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, projection, scalars, tick])
}
