/**
 * Decision Trace check.
 *
 * The fixture is an INVENTED domain — harbour berth permits: a permit is
 * granted, is suspended, invalidates the dispatches that relied on it, and is
 * later restored — and **nothing in `trace.ts` knows that**. Every `kind` below
 * is an opaque string a profile chose, and the assertions are about ordering,
 * causality and lane structure.
 *
 * It is invented on purpose. No example, test fixture or story in this package
 * may embed a real consumer's domain, and a fixture is the easiest place for one
 * to hide: the vocabulary sweep below deliberately excludes the check files,
 * because they must be free to name the vocabulary they forbid. That exclusion
 * made this file the one place a real scenario could ship unnoticed -- and for a
 * while it did carry one, until it was rewritten before first publication.
 *
 * If this file were the only consumer, the test would prove little. Its value is
 * that the module under test cannot special-case any of these strings: swap the
 * fixture for another profile and the same functions must work unchanged.
 */

import {
  CONTROL_LANES,
  affectedBy,
  causalEdges,
  isSelfReference,
  selfCauses,
  danglingCauses,
  laneDisagreements,
  laneRows,
  orderTrace,
  primaryRef,
  stateTrack,
  type DecisionTrace,
  type TraceRecord,
} from './src/trace'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}`, detail === undefined ? '' : detail)
  }
}
function eq<T>(name: string, got: T, want: T) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`)
}

// --------------------------------------------------------------------------
// Fixture: the declared-recalibration scenario, as a profile would emit it.
// --------------------------------------------------------------------------

const lanes = [
  { id: CONTROL_LANES.intent, label: 'Desired', order: 0 },
  { id: CONTROL_LANES.control, label: 'Observed', order: 1 },
  { id: CONTROL_LANES.verified, label: 'Verified', order: 2 },
  { id: CONTROL_LANES.computation, label: 'Decisions', order: 3 },
]

const records: TraceRecord[] = [
  {
    id: 'e1', timestamp: 100, kind: 'permit.published', lane: CONTROL_LANES.intent,
    subject: 'berth-0', source: 'TideSensor/pod-7', state_after: 'Valid', tone: 'positive',
  },
  {
    id: 'e2', timestamp: 101, observed_at: 103, revision: 160,
    kind: 'permit.granted', lane: CONTROL_LANES.control,
    subject: 'berth-0', source: 'controller', state_after: 'Valid',
    responds_to: ['e1'], tone: 'positive',
  },
  {
    id: 'v1', timestamp: 102, revision: 160, kind: 'permit.effective',
    lane: CONTROL_LANES.verified, subject: 'berth-0', source: 'harbormaster',
    state_after: 'Valid', caused_by: ['e2'], tone: 'positive',
  },
  {
    id: 'd1', timestamp: 104, revision: 160, kind: 'dispatch.assign',
    lane: CONTROL_LANES.computation, subject: 'vessel-00238', source: 'harbormaster',
    tone: 'positive', refs: [{ kind: 'artifact', id: 'vessel-00238' }],
  },
  {
    id: 'd2', timestamp: 105, revision: 160, kind: 'dispatch.assign',
    lane: CONTROL_LANES.computation, subject: 'vessel-00239', source: 'harbormaster',
    tone: 'positive', refs: [{ kind: 'artifact', id: 'vessel-00239' }],
  },
  {
    id: 'w1', timestamp: 106, kind: 'permit.suspended', lane: CONTROL_LANES.intent,
    subject: 'berth-0', source: 'TideSensor/pod-7',
    state_before: 'Valid', state_after: 'Suspended', tone: 'negative',
    refs: [{ kind: 'control-event', id: 'w1' }],
    descriptor: { reason: 'silt reading above threshold at marker 2' },
  },
  {
    id: 'v2', timestamp: 107, revision: 161, kind: 'permit.effective',
    lane: CONTROL_LANES.verified, subject: 'berth-0', source: 'harbormaster',
    state_before: 'Valid', state_after: 'Void', caused_by: ['w1'], tone: 'negative',
  },
  {
    id: 'd3', timestamp: 108, revision: 161, kind: 'dispatch.divert',
    lane: CONTROL_LANES.computation, subject: 'vessel-00241', source: 'harbormaster',
    caused_by: ['v2'], tone: 'warning', refs: [{ kind: 'artifact', id: 'vessel-00241' }],
  },
  {
    id: 'r1', timestamp: 200, kind: 'permit.restored', lane: CONTROL_LANES.intent,
    subject: 'berth-0', source: 'TideSensor/pod-9',
    state_before: 'Suspended', state_after: 'Valid', tone: 'positive',
  },
  {
    id: 'v3', timestamp: 201, revision: 162, kind: 'permit.effective',
    lane: CONTROL_LANES.verified, subject: 'berth-0', source: 'harbormaster',
    state_before: 'Void', state_after: 'Valid', caused_by: ['r1'], tone: 'positive',
  },
  {
    id: 'd4', timestamp: 202, revision: 162, kind: 'dispatch.assign',
    lane: CONTROL_LANES.computation, subject: 'vessel-00243', source: 'harbormaster',
    tone: 'positive', refs: [{ kind: 'artifact', id: 'vessel-00243' }],
  },
]

const trace: DecisionTrace = { records, lanes, meta: { source: 'harbor-scheduling' } }

console.log('decision trace')

// -- reconstruction: the scenario read back out of the records ---------------

const verified = stateTrack(records, 'berth-0', CONTROL_LANES.verified)
eq(
  'verified state track reconstructs Fresh -> Invalidated -> Fresh',
  verified.map((r) => r.state_after),
  ['Valid', 'Void', 'Valid'],
)

const decisions = records
  .filter((r) => r.lane === CONTROL_LANES.computation)
  .map((r) => r.kind)
eq(
  'decisions reconstruct reuse, reuse, execute, reuse',
  decisions,
  ['dispatch.assign', 'dispatch.assign', 'dispatch.divert', 'dispatch.assign'],
)

// -- causality is declared, never inferred from adjacency --------------------

const edges = causalEdges(records)
check(
  'the refusal is linked to the withdrawal that caused it',
  edges.some((e) => e.from === 'v2' && e.to === 'd3' && e.relation === 'caused_by'),
  edges,
)
check(
  'adjacent records with no declared cause produce no edge',
  !edges.some((e) => e.from === 'd1' && e.to === 'd2'),
  edges,
)
eq('no causal edge is invented', edges.length, 5)

// A window that excludes the cause must report it as dangling rather than
// silently dropping the relationship.
const windowed = records.filter((r) => r.id !== 'w1')
eq('a cause outside the window is reported', danglingCauses(windowed), ['w1'])
check(
  'and no edge is fabricated for it',
  !causalEdges(windowed).some((e) => e.from === 'w1'),
)

// -- causality is traversable both ways --------------------------------------

// Stored forwards only, causality can be confirmed but not explored: "why did
// this refuse" is answerable and "what else did that withdrawal affect" is not.
eq('the withdrawal names what it affected', affectedBy(records, 'w1').map((r) => r.id), ['v2'])
eq('and the chain continues', affectedBy(records, 'v2').map((r) => r.id), ['d3'])
eq('a record nothing depended on affects nothing', affectedBy(records, 'd4'), [])
// The forward and reverse indexes must describe one relation, not two.
eq(
  'every declared edge is reachable in reverse',
  causalEdges(records).every((e) => affectedBy(records, e.from).some((r) => r.id === e.to)),
  true,
)

// -- selection hands over an identity, never a payload -----------------------

// The trace row's own id is not the artifact's id. A consumer that passed the
// row id to an artifact store would be asking for something that does not
// exist, which is exactly why the reference is declared separately.
const refDecision = records.find((r) => r.id === 'd3')!
eq('a decision points at its artifact', primaryRef(refDecision)?.id, 'vessel-00241')
check('and that is not the record id', primaryRef(refDecision)?.id !== refDecision.id)
// Following a reference is uniform; the reference's own kind is what decides
// which inspector opens. A consumer that instead dispatched on the record's
// `kind` would be reading profile vocabulary to choose behaviour.
const refEvent = records.find((r) => r.id === 'w1')!
eq('an event references itself', primaryRef(refEvent)?.id, 'w1')
check('which is a self-reference', isSelfReference(refEvent), primaryRef(refEvent))
check('while a decision reference is not', !isSelfReference(refDecision))
// The guard that matters: a self-reference names the thing to open, and is not
// a relationship. Read as an edge it would loop, and the loop would only show
// up once an inspector followed references on its own.
check(
  'a self-reference is not a causal edge',
  !causalEdges(records).some((e) => e.from === e.to),
  causalEdges(records).filter((e) => e.from === e.to),
)
eq('and does not make a record its own downstream', affectedBy(records, 'w1').map((r) => r.id), ['v2'])
check(
  'and declares a different kind of thing to open',
  primaryRef(refEvent)?.kind !== primaryRef(refDecision)?.kind,
  [primaryRef(refEvent)?.kind, primaryRef(refDecision)?.kind],
)
// A record with no reference is its own subject, not a broken record: a
// consumer shows it directly rather than fetching something never promised.
eq('a record may promise nothing to fetch', primaryRef(records.find((r) => r.id === 'e1')!), undefined)

// -- time is not one dimension ----------------------------------------------

eq(
  'ordering by wall-clock',
  orderTrace(records, 'timestamp').map((r) => r.id),
  ['e1', 'e2', 'v1', 'd1', 'd2', 'w1', 'v2', 'd3', 'r1', 'v3', 'd4'],
)
// e2 was observed at 103, after v1 happened at 102. Ordering by observation
// must not be assumed to match ordering by occurrence.
const byObserved = orderTrace(records, 'observed_at').map((r) => r.id)
eq('records without the chosen dimension sort last, not at zero', byObserved[0], 'e2')
check(
  'ordering by observation differs from ordering by occurrence',
  byObserved.join() !== orderTrace(records, 'timestamp').map((r) => r.id).join(),
)
const byRevision = orderTrace(records, 'revision')
check(
  'revision ordering keeps same-revision records in input order',
  byRevision.filter((r) => r.revision === 160).map((r) => r.id).join() === 'e2,v1,d1,d2',
  byRevision.map((r) => `${r.id}:${r.revision}`),
)

// -- lanes -------------------------------------------------------------------

const rows = laneRows(trace)
eq('lanes come back in declared order', rows.map((r) => r.lane.label),
  ['Desired', 'Observed', 'Verified', 'Decisions'])
eq('each record lands in exactly one lane',
  rows.reduce((n, r) => n + r.records.length, 0), records.length)

// -- the failure that must be hard to miss ------------------------------------

// Result 39's shape: one lane says the system is not ready while another is
// still acting. Structural, not semantic — no lane is privileged here.
const disagreeing: TraceRecord[] = [
  ...records.slice(0, 3),
  {
    id: 'x1', timestamp: 110, kind: 'readiness', lane: CONTROL_LANES.control,
    subject: 'berth-0', state_after: 'NotReady',
  },
  {
    id: 'x2', timestamp: 111, kind: 'permit.effective',
    lane: CONTROL_LANES.verified, subject: 'berth-0', state_after: 'Valid',
  },
]
const gaps = laneDisagreements(disagreeing)
eq('a lane disagreement is surfaced', gaps.length, 1)
eq('and names the subject', gaps[0]?.subject, 'berth-0')
// Every lane that asserted is reported, not merely the two that differ: a
// reader needs to see which lanes agreed as well as which did not.
eq('every asserting lane is reported', gaps[0]?.states.length, 3)
check(
  'with the conflicting states present',
  JSON.stringify([...new Set(gaps[0]?.states.map((s) => s.state))].sort()) ===
    JSON.stringify(['NotReady', 'Valid']),
  gaps[0]?.states,
)
eq('agreement produces no finding', laneDisagreements(records).length, 0)

// -- incomplete traces ------------------------------------------------------

// A trace is almost never whole: it is paged, windowed, and read while its
// source is still writing. Every one of these must degrade into a statement
// about what is missing, never into an inferred relationship.

// 1. A cause outside the window (covered above) must not become an edge, and
//    must not become a *different* edge by silently attaching to a neighbour.
const cut = records.filter((r) => r.id !== 'w1')
check(
  'a windowed-out cause attaches to nothing else',
  !causalEdges(cut).some((e) => e.to === 'v2'),
  causalEdges(cut).filter((e) => e.to === 'v2'),
)

// 2. A reference to something not in the trace is not causality. References say
//    where to look; they never say what caused what.
const withRef: TraceRecord[] = [
  { id: 'a', timestamp: 1, kind: 'k', lane: CONTROL_LANES.computation,
    refs: [{ kind: 'artifact', id: 'nowhere' }] },
  { id: 'b', timestamp: 2, kind: 'k', lane: CONTROL_LANES.computation },
]
eq('a reference is not an edge', causalEdges(withRef), [])
eq('nor is an unresolvable one a dangling cause', danglingCauses(withRef), [])

// 3. Pagination that cuts a chain: every page reports its own truncation, and
//    the pages together lose nothing.
const ordered = orderTrace(records, 'timestamp')
// Two per page. Larger pages happened to fall between chains, so nothing was
// cut and the assertion below held without testing anything.
const pages = ordered.reduce<TraceRecord[][]>((acc, r, i) => {
  if (i % 2 === 0) acc.push([])
  acc[acc.length - 1]!.push(r)
  return acc
}, [])
const pageEdges = pages.flatMap((p) => causalEdges(p))
const pageDangling = pages.flatMap((p) => danglingCauses(p))
check(
  'a cut chain is reported on the page that lost it',
  pageDangling.length > 0,
  pageDangling,
)
check(
  'and no page invents an edge the whole trace does not have',
  pageEdges.every((e) =>
    causalEdges(records).some(
      (w) => w.from === e.from && w.to === e.to && w.relation === e.relation,
    ),
  ),
  pageEdges,
)
eq(
  'every lost edge is accounted for as a dangling cause',
  causalEdges(records).length - pageEdges.length <= pageDangling.length,
  true,
)

// 4. A record with no declared cause is ordinary, not broken.
eq('an uncaused record is not a dangling reference', danglingCauses([records[0]!]), [])
eq('and produces no edge', causalEdges([records[0]!]), [])

// 5. A record naming itself as its own cause is malformed. Reported, excluded,
//    and never drawn — a loop would leave a consumer walking for an origin it
//    can never reach.
const loop: TraceRecord[] = [
  { id: 'x', timestamp: 1, kind: 'k', lane: CONTROL_LANES.control, caused_by: ['x'] },
]
eq('a self-cause is reported', selfCauses(loop), ['x'])
eq('never drawn', causalEdges(loop), [])
eq('and never makes a record its own downstream', affectedBy(loop, 'x'), [])
eq('an honest trace has none', selfCauses(records), [])

// -- the renderer owns no vocabulary -----------------------------------------

// Rename every profile string. Ordering, causality, lanes and disagreement must
// be unchanged: if any assertion above depended on a literal like
// "permit.suspended", this would break.
const renamed: TraceRecord[] = records.map((r) => ({
  ...r,
  kind: `opaque.${r.kind.length}`,
  subject: r.subject ? `s${r.subject.length}` : undefined,
}))
eq(
  'ordering survives renaming every kind and subject',
  orderTrace(renamed, 'timestamp').map((r) => r.id),
  orderTrace(records, 'timestamp').map((r) => r.id),
)
eq('causality survives it too', causalEdges(renamed).length, causalEdges(records).length)
eq(
  'reverse causality survives it',
  affectedBy(renamed, 'w1').map((r) => r.id),
  affectedBy(records, 'w1').map((r) => r.id),
)
eq(
  'and references still point where they pointed',
  primaryRef(renamed.find((r) => r.id === 'd3')!)?.id,
  'vessel-00241',
)
eq(
  'and so does lane structure',
  laneRows({ ...trace, records: renamed }).map((r) => r.records.length),
  laneRows(trace).map((r) => r.records.length),
)

// Neither module may mention any profile's words. The renderer matters more
// than the contract here: a component that special-cases one `kind` string
// looks identical to a generic one until somebody points it at another domain.
// Read the source, not the bundle: `import.meta.url` points at the esbuild
// output, which is how a first attempt at this check read the wrong file.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const forbidden = ['quantum', 'qubit', 'calibration', 'admission.', 'backend-evidence', 'shots']

// Every source file in the package, not a list someone has to remember to
// extend. This package is vocabulary-free by construction, and that rule is
// enforced rather than merely intended -- but the enforcement once named two
// files by hand, so the other thirty-odd were only intended.
//
// That gap was found the way gaps are: a comment in src/layout/fitToExtent.ts
// quoted a consumer's caption verbatim to explain a clipping bug, every check
// passed, and the vocabulary would have gone out with the package. Walking the
// tree costs nothing and cannot be forgotten.
//
// The check files themselves are excluded and must be: they use this vocabulary
// deliberately, as the fixture that proves the renderer does not depend on it.
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full)
  }
  return out
}

// Runs from two layouts: the monorepo, where cwd is `frontend/` and the package
// sits under `packages/graph-canvas`, and the published repository, where the
// package IS the repository root. Resolve rather than assume -- a wrong root
// sweeps zero files, and a sweep that finds nothing passes every assertion it
// never made. The `files.length > 5` check below is what turns that into a
// failure instead of a silent success.
const nested = join(process.cwd(), 'packages/graph-canvas')
const pkgRoot = existsSync(join(nested, 'package.json')) ? nested : process.cwd()
// The examples are published too -- they are the site -- so they are swept on
// the same terms as src/. An example is the single most tempting place to reach
// for a real domain, because a real one is already written down somewhere.
const exampleSrc = join(pkgRoot, 'examples', 'src')
const files = [
  ...sourceFiles(join(pkgRoot, 'src')),
  ...(existsSync(exampleSrc) ? sourceFiles(exampleSrc) : []),
]
check('the vocabulary sweep found the package source', files.length > 5, `${files.length} files`)
for (const full of files) {
  const file = full.slice(pkgRoot.length + 1)
  const src = readFileSync(full, 'utf8')
  const leaked = forbidden.filter((w) => src.toLowerCase().includes(w.toLowerCase()))
  check(
    `${file} contains no profile vocabulary`,
    leaked.length === 0,
    leaked.length ? `leaked: ${leaked.join(', ')}` : '',
  )
}

console.log(failures === 0 ? '\ndecision trace: all checks passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
