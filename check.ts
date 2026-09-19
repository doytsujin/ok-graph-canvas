import {
  ADMISSION_PRESSURE_KEY,
  admissionDeviationProjection,
  buildProjectionContext,
  defaultRegistry,
  encodeLink,
  collideRadius,
  DEFAULT_COLLIDE_OPTIONS,
  estimateLabelHalfWidth,
  fitToExtent,
  projectToScreen,
  type FieldNode,
  type SemanticField,
} from './src/index'

// A field with governance chain, provenance chain, and graded trust.
const field: SemanticField = {
  nodes: {
    policy: { id: 'policy', label: 'policy-authority', kind: 'controller', role: 'policy-authority' },
    ds_raw: { id: 'ds_raw', label: 'raw', kind: 'dataset', role: 'dataset' },
    ds_derived: { id: 'ds_derived', label: 'derived', kind: 'dataset', role: 'dataset' },
    idx: { id: 'idx', label: 'index', kind: 'index', role: 'index' },
    orphan: { id: 'orphan', label: 'orphan', kind: 'pod' },
  },
  links: {
    g1: {
      id: 'g1', source: 'policy', target: 'ds_raw', kind: 'governed_by',
      envelope: { governance: { enforced: true }, trust: 0.9, policy_compat: 0.95 },
    },
    g2: {
      id: 'g2', source: 'ds_raw', target: 'ds_derived', kind: 'governed_by',
      envelope: { governance: { enforced: false }, trust: 0.4, policy_compat: 0.3, readiness: 0.5 },
    },
    p1: {
      id: 'p1', source: 'ds_raw', target: 'ds_derived', kind: 'derived_from',
      envelope: { provenance: { verified: true }, confidence: 0.8 },
    },
    p2: {
      id: 'p2', source: 'ds_derived', target: 'idx', kind: 'derived_from',
      envelope: { provenance: { verified: false }, confidence: 0.6, relearning_pressure: 0.9 },
    },
    w1: {
      id: 'w1', source: 'idx', target: 'ds_derived', kind: 'depends_on',
      envelope: { relation_type: 'depends_on', readiness: 0.2, trust: 0.7 },
    },
  },
}

const reg = defaultRegistry()
const ctx = buildProjectionContext(field)

let failures = 0
const check = (name: string, cond: boolean, detail: string) => {
  if (!cond) { failures++; console.log(`FAIL  ${name}: ${detail}`) }
  else console.log(`ok    ${name}`)
}

console.log('--- projection ids:', reg.ids().join(', '))
check('registry has 8 built-ins', reg.ids().length === 8, `got ${reg.ids().length}`)

// Per-projection scalar + link-set report
const linkSets: Record<string, string> = {}
for (const spec of reg.list()) {
  const scalars = Object.values(field.nodes).map((n) => {
    const v = spec.scalar ? spec.scalar(n, ctx) : null
    return `${n.id}=${v === null ? '-' : v.toFixed(2)}`
  })
  const inc = Object.values(field.links).filter(spec.includeLink ?? (() => true)).map((l) => l.id)
  linkSets[spec.id] = inc.join(',')
  console.log(`  ${spec.id.padEnd(20)} links[${inc.join(',') || '-'}]  ${scalars.join(' ')}`)
}

// TODO 3.1 acceptance: two distinct projections, same node set, different link sets.
check(
  'governance vs workflow have different link sets',
  linkSets.governance !== linkSets.workflow,
  `${linkSets.governance} == ${linkSets.workflow}`,
)
check(
  'provenance vs trust have different link sets',
  linkSets.provenance !== linkSets.trust,
  `${linkSets.provenance} == ${linkSets.trust}`,
)

// Governance depth: policy is upstream of ds_raw is upstream of ds_derived.
const gov = reg.get('governance')!
const gPolicy = gov.scalar!(field.nodes.policy, ctx)!
const gRaw = gov.scalar!(field.nodes.ds_raw, ctx)!
const gDer = gov.scalar!(field.nodes.ds_derived, ctx)!
check('governance depth is ordered', gPolicy < gRaw && gRaw < gDer, `${gPolicy} ${gRaw} ${gDer}`)

// Risk is worst-case, not mean: ds_derived touches policy_compat 0.3 -> risk 0.7
const risk = reg.get('risk')!.scalar!(field.nodes.ds_derived, ctx)
check('risk takes the worst incident link', Math.abs((risk ?? 0) - 0.8) < 1e-9, `got ${risk} (expected 0.8 from readiness 0.2 on w1)`)

// Trust is a mean over asserted links only (g2=0.4, w1=0.7 touch ds_derived)
const trust = reg.get('trust')!.scalar!(field.nodes.ds_derived, ctx)
check('trust averages only asserted links', Math.abs((trust ?? 0) - 0.55) < 1e-9, `got ${trust}`)

// A node with no incident links must return null, not 0.
check('orphan has no trust scalar', reg.get('trust')!.scalar!(field.nodes.orphan, ctx) === null, 'expected null')
check('orphan has no risk scalar', reg.get('risk')!.scalar!(field.nodes.orphan, ctx) === null, 'expected null')

// Structural projections must report null for nodes outside the chain,
// not depth 0 — "no governance at all" is not "governed at the root".
check('orphan has no governance depth', gov.scalar!(field.nodes.orphan, ctx) === null, `got ${gov.scalar!(field.nodes.orphan, ctx)}`)
check('idx has no governance depth', gov.scalar!(field.nodes.idx, ctx) === null, `got ${gov.scalar!(field.nodes.idx, ctx)}`)
const prov = reg.get('provenance')!
check('policy has no provenance depth', prov.scalar!(field.nodes.policy, ctx) === null, `got ${prov.scalar!(field.nodes.policy, ctx)}`)
const wf = reg.get('workflow')!
check('ds_raw has no workflow depth', wf.scalar!(field.nodes.ds_raw, ctx) === null, `got ${wf.scalar!(field.nodes.ds_raw, ctx)}`)
check('idx has workflow depth 0 (it is the chain root)', wf.scalar!(field.nodes.idx, ctx) === 0, `got ${wf.scalar!(field.nodes.idx, ctx)}`)

// similarity gives no opinion at all
check('similarity ranks nothing', reg.get('similarity')!.scalar!(field.nodes.ds_raw, ctx) === null, 'expected null')

// Encoding: undefined scalars must not read as zero.
const bare = encodeLink({ envelope: {} })
const neutral = encodeLink({ envelope: undefined })
check('empty envelope == no envelope', JSON.stringify(bare) === JSON.stringify(neutral), 'diverged')
check('no-envelope link is neutral grey', neutral.stroke === '#94a3b8', neutral.stroke)
check('no-envelope link has no halo', neutral.halo === false, 'halo set')

const enforced = encodeLink({ envelope: { governance: { enforced: true }, policy_compat: 1, trust: 1 } })
check('enforced governance sets halo', enforced.halo === true, 'no halo')
check('policy_compat 1 is green', enforced.stroke === 'hsl(145, 62%, 45%)', enforced.stroke)
check('trust 1 is solid', enforced.strokeDasharray === undefined, String(enforced.strokeDasharray))

const untrusted = encodeLink({ envelope: { trust: 0.1, policy_compat: 0 } })
check('policy_compat 0 is red', untrusted.stroke === 'hsl(0, 62%, 45%)', untrusted.stroke)
check('low trust is short-dashed', untrusted.strokeDasharray === '2 4', String(untrusted.strokeDasharray))

const stale = encodeLink({ envelope: { relearning_pressure: 0.9 } })
check('high relearning pressure ticks', stale.tick === true, 'no tick')

// --- fit-to-extent -------------------------------------------------------
// The regression these guard against: a force layout settling wider than the
// viewport, so nodes render off-screen and the canvas looks empty rather than
// zoomed. Measured in the real app before the fix — a node at screen y = -204.

const W = 1200
const H = 800
const FIT = { nodeRadius: 56, padding: 32, scaleExtent: [0.2, 4] as [number, number] }
const inView = (p: { x: number; y: number }) =>
  p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H

// The spread that actually broke: ±600 layout units against an 800px viewport.
const wide = [
  { x: -600, y: -599 },
  { x: 600, y: 480 },
  { x: 0, y: 0 },
]
const t = fitToExtent(wide, W, H, FIT)!
check('wide field yields a transform', !!t, 'null')
check(
  'every node lands inside the viewport',
  wide.every((n) => inView(projectToScreen(n, t, W, H))),
  JSON.stringify(wide.map((n) => projectToScreen(n, t, W, H))),
)
check('wide field zooms out', t.k < 1, String(t.k))
check(
  'extent centre lands at viewport centre',
  Math.abs(projectToScreen({ x: 0, y: (-599 + 480 + 56 * 0.6) / 2 }, t, W, H).x - W / 2) < 1,
  'off centre',
)

// Regression on the specific failure: the node that used to render above the
// viewport must now be on screen.
const offscreen = projectToScreen({ x: -600, y: -599 }, t, W, H)
check('the y = -204 node is no longer above the viewport', offscreen.y >= 0, String(offscreen.y))

// A long caption on a boundary node. This is the case that was clipped: the
// fit padded by `nodeRadius` alone, captions are centred under their node and
// this one is about three times that wide, so its left half rendered outside
// the viewport at any scale large enough to matter.
//
// Asserted on the caption's extent rather than the node centre, because the
// node centre was always on screen — that is exactly why it went unnoticed.
// Forty-one characters, which is an ordinary length for a caption that states
// a verdict and a number. Deliberately not a real consumer's wording: this
// package is vocabulary-free by construction and that includes its tests.
const LABEL = 'a caption long enough to overhang its node'
const LABEL_CHAR_WIDTH = 8.9
const labelled = [
  { x: -600, y: 0, label: LABEL },
  { x: 600, y: 0, label: LABEL },
  { x: 0, y: 0, label: 'short' },
]
const tl = fitToExtent(labelled, W, H, { ...FIT, labelCharWidth: LABEL_CHAR_WIDTH })!
const halfLabel = (LABEL.length * LABEL_CHAR_WIDTH) / 2
for (const n of labelled) {
  const half = Math.max(56, ((n.label ?? '').length * LABEL_CHAR_WIDTH) / 2)
  const left = projectToScreen({ x: n.x - half, y: n.y }, tl, W, H)
  const right = projectToScreen({ x: n.x + half, y: n.y }, tl, W, H)
  check(
    `caption of the node at x=${n.x} is fully on screen`,
    left.x >= 0 && right.x <= W,
    `left ${left.x.toFixed(1)}, right ${right.x.toFixed(1)}`,
  )
}

// And the regression stated the other way: ignoring labels must produce a
// tighter fit than accounting for them, or the option is doing nothing.
const tIgnored = fitToExtent(
  labelled.map((n) => ({ x: n.x, y: n.y })),
  W, H, FIT,
)!
check(
  'accounting for captions zooms out further than ignoring them',
  tl.k < tIgnored.k,
  `with labels k=${tl.k}, without k=${tIgnored.k}`,
)
check(
  'a wide caption widens the extent beyond the node radius',
  halfLabel > 56,
  `half label ${halfLabel} vs node radius 56`,
)

// A measured half-width overrides the estimate.
const tMeasured = fitToExtent(
  [{ x: 0, y: 0, label: LABEL, labelHalfWidth: 10 }],
  W, H, { ...FIT, labelCharWidth: LABEL_CHAR_WIDTH },
)!
const tEstimated = fitToExtent(
  [{ x: 0, y: 0, label: LABEL }],
  W, H, { ...FIT, labelCharWidth: LABEL_CHAR_WIDTH },
)!
check(
  'a measured labelHalfWidth wins over the character estimate',
  tMeasured.k >= tEstimated.k,
  `measured k=${tMeasured.k}, estimated k=${tEstimated.k}`,
)

// A node with no caption must be unaffected.
const tNoLabel = fitToExtent([{ x: -600, y: 0 }, { x: 600, y: 0 }], W, H, FIT)!
const tNoLabel2 = fitToExtent(
  [{ x: -600, y: 0 }, { x: 600, y: 0 }],
  W, H, { ...FIT, labelCharWidth: 999 },
)!
check(
  'nodes without a caption are unaffected by labelCharWidth',
  tNoLabel.k === tNoLabel2.k,
  `${tNoLabel.k} vs ${tNoLabel2.k}`,
)

// -- captions must not be written across the next node ------------------------
//
// The camera fix above stops a caption running off the viewport. It does
// nothing about a caption running across its neighbour, which is a separate
// failure with a separate cause: the simulation separated nodes on a fixed
// radius that was chosen to clear a typical caption and cannot clear a long one.
const BASE = DEFAULT_COLLIDE_OPTIONS.base

check(
  'a node with no caption keeps the previous fixed radius',
  collideRadius({}) === BASE,
  String(collideRadius({})),
)
check(
  'a short caption does not shrink the radius below the floor',
  collideRadius({ label: 'idx' }) === BASE,
  String(collideRadius({ label: 'idx' })),
)

// The case that overlapped: a caption whose half-width exceeds the old radius.
const longHalf = estimateLabelHalfWidth(LABEL)
check(
  'the long caption is genuinely wider than the old fixed radius',
  longHalf > BASE,
  `half ${longHalf.toFixed(1)} vs base ${BASE}`,
)
check(
  'a long caption widens its own separation',
  collideRadius({ label: LABEL }) > BASE,
  String(collideRadius({ label: LABEL })),
)
check(
  'and widens it far enough to clear the caption itself',
  collideRadius({ label: LABEL }) >= longHalf,
  `radius ${collideRadius({ label: LABEL })} vs half ${longHalf.toFixed(1)}`,
)

// The cap: one pathological caption must not be able to spread a whole graph.
const absurd = 'x'.repeat(4000)
check(
  'a pathological caption is capped',
  collideRadius({ label: absurd }) === DEFAULT_COLLIDE_OPTIONS.max,
  String(collideRadius({ label: absurd })),
)
check(
  'the cap is above the floor, so the range is not empty',
  DEFAULT_COLLIDE_OPTIONS.max > BASE,
  `${DEFAULT_COLLIDE_OPTIONS.max} vs ${BASE}`,
)

// The camera and the simulation must estimate width the same way, or one will
// frame for a caption the other did not make room for.
check(
  'camera and collision share one width estimate',
  estimateLabelHalfWidth(LABEL) === (LABEL.length * 8.9) / 2,
  String(estimateLabelHalfWidth(LABEL)),
)

// A single node must not zoom to the max just because its extent is tiny.
const single = fitToExtent([{ x: 0, y: 0 }], W, H, FIT)!
check('single node stays within scale extent', single.k <= 4 && single.k >= 0.2, String(single.k))
check('single node is centred', Math.abs(projectToScreen({x:0,y:0}, single, W, H).x - W / 2) < 1, 'off centre')

// "Nothing to frame" must be null, not identity — identity would yank the
// camera to the origin on every empty update.
check('empty node set returns null', fitToExtent([], W, H, FIT) === null, 'not null')
check('zero-size viewport returns null', fitToExtent(wide, 0, 0, FIT) === null, 'not null')
check(
  'non-finite coordinates are ignored',
  fitToExtent([{ x: NaN, y: 0 }], W, H, FIT) === null,
  'not null',
)

// Clamping: an extent so large that fitting it would exceed the zoom-out limit
// must clamp rather than produce an unreachable transform.
const huge = fitToExtent([{ x: -100000, y: 0 }, { x: 100000, y: 0 }], W, H, FIT)!
check('over-large extent clamps to min scale', huge.k === 0.2, String(huge.k))

// ---------------------------------------------------------------------------
// admission deviation — the ninth projection, not a built-in
//
// Its three absent-ish states have to stay apart: no reading, a reading with no
// baseline, and a reading that genuinely sits at baseline. Two of those are
// null and one is 0, and collapsing them is exactly the "undefined is not zero"
// failure one layer up.

const dev = admissionDeviationProjection
const withPressure = (p: unknown): FieldNode => ({
  id: 'x',
  label: 'x',
  kind: 'pod',
  domain_extensions: p === undefined ? {} : { [ADMISSION_PRESSURE_KEY]: p },
})
const devScalar = (p: unknown) => dev.scalar!(withPressure(p), ctx)

check('admission deviation is not a built-in', !reg.has(dev.id), 'it is registered by default')
check('no reading ranks null', devScalar(undefined) === null, String(devScalar(undefined)))
check(
  'a reading with a null baseline ranks null',
  devScalar({ refusals_now: 3, refusals_sigma: null }) === null,
  String(devScalar({ refusals_now: 3, refusals_sigma: null })),
)
check(
  'at baseline ranks 0, not null',
  devScalar({ refusals_sigma: 0 }) === 0,
  String(devScalar({ refusals_sigma: 0 })),
)
check(
  'below baseline floors at 0 rather than spreading',
  devScalar({ refusals_sigma: -3 }) === 0,
  String(devScalar({ refusals_sigma: -3 })),
)
check(
  'half scale at two sigma',
  devScalar({ refusals_sigma: 2 }) === 0.5,
  String(devScalar({ refusals_sigma: 2 })),
)
check(
  'saturates at four sigma',
  devScalar({ refusals_sigma: 9 }) === 1,
  String(devScalar({ refusals_sigma: 9 })),
)
check(
  'a non-finite sigma ranks null',
  devScalar({ refusals_sigma: Number.POSITIVE_INFINITY }) === null,
  String(devScalar({ refusals_sigma: Number.POSITIVE_INFINITY })),
)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
