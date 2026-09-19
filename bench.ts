/**
 * The operating range, measured rather than asserted.
 *
 * SVG with a d3 force layout is a deliberate choice: every node is an inspectable
 * element, which is the point of a renderer meant for evidence. It is also the
 * choice that sets a ceiling, and a library that does not say where its ceiling
 * is leaves each adopter to discover it in production.
 *
 * What is measured here is the layout, not the paint. Layout is the part this
 * package owns and the part that scales badly -- force simulation is superlinear
 * in the number of nodes. Paint depends on the host's CSS, the browser and the
 * machine, so a number measured here would not transfer.
 *
 * Run: npx tsx bench.ts   (or through `npm run bench`)
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import { collideRadius } from './src/layout/collide'
import { buildProjectionContext, defaultRegistry } from './src/layout/projections'
import { fitToExtent } from './src/layout/fitToExtent'
import type { FieldLink, FieldNode, SemanticField } from './src/types'

function synth(n: number): SemanticField {
  const nodes: Record<string, FieldNode> = {}
  const links: Record<string, FieldLink> = {}
  for (let i = 0; i < n; i++) {
    const id = `n${i}`
    nodes[id] = {
      id,
      label: `node ${i} with a caption of realistic length`,
      kind: `kind-${i % 7}`,
      group: `group-${i % 5}`,
      state: 'running',
      metric: { value: (i % 100) / 100 },
    }
  }
  // Roughly 1.6 links per node, which is what the real fields look like.
  let k = 0
  for (let i = 0; i < n; i++) {
    for (const t of [(i + 1) % n, (i + 7) % n]) {
      if (t === i) continue
      if (k % 5 === 4) { k++; continue }
      const id = `l${k++}`
      links[id] = {
        id,
        source: `n${i}`,
        target: `n${t}`,
        envelope: { confidence: 0.8, trust: (t % 10) / 10, policy_compat: 0.6 },
      }
    }
  }
  return { nodes, links }
}

const registry = defaultRegistry()
const SIZES = [100, 500, 1000, 5000]

function ms(f: () => void): number {
  const t0 = performance.now()
  f()
  return performance.now() - t0
}

// The force simulation, which is the part that actually sets the ceiling. The
// forces and the settle count mirror useFieldLayout; measuring the helpers alone
// would have produced a flattering number for the wrong thing.
function simulate(nodes: Array<{ id: string; label: string }>, links: Array<{ source: string; target: string }>, settle: number) {
  const arr = nodes.map((n, i) => ({ ...n, x: Math.cos(i) * 400, y: Math.sin(i) * 400 }))
  const sim = forceSimulation<any>(arr as any)
    .force('link', forceLink<any, any>(links.map((l) => ({ ...l }))).id((d: any) => d.id).distance(150).strength(0.25))
    .force('charge', forceManyBody().strength(-900))
    .force('collide', forceCollide<any>((n: any) => collideRadius(n)))
    .force('x', forceX(0).strength(0.05))
    .force('y', forceY(0).strength(0.07))
    .alpha(0.6)
    .alphaDecay(0.04)
    .stop()
  sim.tick(settle)
}

console.log('nodes  links   context  project  collide  fit      helpers  force(300 ticks)')
for (const n of SIZES) {
  const field = synth(n)
  const linkCount = Object.keys(field.links).length
  const nodeList = Object.values(field.nodes)

  let ctx = buildProjectionContext(field)
  const tCtx = ms(() => { ctx = buildProjectionContext(field) })

  const proj = registry.get('trust')
  const tProj = ms(() => {
    for (const node of nodeList) proj?.scalar?.(node, ctx)
  })

  const tCollide = ms(() => {
    for (const node of nodeList) collideRadius({ label: node.label })
  })

  const laid = nodeList.map((node, i) => ({
    ...node,
    x: Math.cos(i) * 400,
    y: Math.sin(i) * 400,
    label: node.label,
  }))
  const tFit = ms(() => { fitToExtent(laid, 1200, 800) })

  const linkList = Object.values(field.links).map((l) => ({ source: l.source, target: l.target }))
  const tSim = ms(() => simulate(nodeList.map((x) => ({ id: x.id, label: x.label })), linkList, 300))

  const helpers = tCtx + tProj + tCollide + tFit
  console.log(
    `${String(n).padEnd(6)} ${String(linkCount).padEnd(7)} ` +
      `${tCtx.toFixed(1).padStart(6)}ms ${tProj.toFixed(1).padStart(7)}ms ` +
      `${tCollide.toFixed(1).padStart(7)}ms ${tFit.toFixed(1).padStart(6)}ms ` +
      `${helpers.toFixed(1).padStart(8)}ms ${tSim.toFixed(0).padStart(11)}ms`,
  )
}
