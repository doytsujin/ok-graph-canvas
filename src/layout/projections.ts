/**
 * Field projections — the same node set laid out along different
 * control-plane dimensions (STATEMENT §9.5).
 *
 * This is a *registry*, not an enum, because profiles are expected to
 * contribute projections at runtime. The host platform's architecture notes
 * call this out explicitly under the *Projection types* extension point: "8
 * listed in STATEMENT §9.5 — needs a runtime registry, not an enum".
 *
 * A projection supplies two things:
 *
 *   - `scalar` — where a node sits along the projection axis, in [0, 1].
 *     `null` means "no opinion", and the force simulation places the node
 *     freely rather than pinning it to an arbitrary default.
 *   - `includeLink` — which links carry the signal this projection is about.
 *     Excluded links still *render* (dimmed), they just exert no layout force.
 *     Removing them outright would make switching projections look like data
 *     loss, and would strand nodes whose only links are excluded.
 */

import type { FieldLink, FieldNode, SemanticField } from '../types'

export interface ProjectionContext {
  field: SemanticField
  /** Links touching a node, in either direction. */
  incident: Map<string, FieldLink[]>
  /** Links whose `source` is the node. */
  outgoing: Map<string, FieldLink[]>
  /** Links whose `target` is the node. */
  incoming: Map<string, FieldLink[]>
}

export interface ProjectionSpec {
  id: string
  label: string
  description: string
  /** Position along the projection axis, [0, 1], or null for "no opinion". */
  scalar?: (node: FieldNode, ctx: ProjectionContext) => number | null
  /** Whether this link participates in the layout for this projection. */
  includeLink?: (link: FieldLink) => boolean
  /** Force-link strength in [0, 1]. */
  linkWeight?: (link: FieldLink) => number
  /** Lane key; defaults to `node.group`. */
  lane?: (node: FieldNode) => string | null
}

export class ProjectionRegistry {
  private specs = new Map<string, ProjectionSpec>()

  constructor(initial: ProjectionSpec[] = []) {
    initial.forEach((s) => this.register(s))
  }

  register(spec: ProjectionSpec): this {
    this.specs.set(spec.id, spec)
    return this
  }

  get(id: string | undefined): ProjectionSpec | undefined {
    return id ? this.specs.get(id) : undefined
  }

  has(id: string): boolean {
    return this.specs.has(id)
  }

  list(): ProjectionSpec[] {
    return Array.from(this.specs.values())
  }

  ids(): string[] {
    return Array.from(this.specs.keys())
  }
}

// ---------------------------------------------------------------------------
// helpers

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function buildProjectionContext(field: SemanticField): ProjectionContext {
  const incident = new Map<string, FieldLink[]>()
  const outgoing = new Map<string, FieldLink[]>()
  const incoming = new Map<string, FieldLink[]>()

  const push = (m: Map<string, FieldLink[]>, k: string, l: FieldLink) => {
    const arr = m.get(k)
    if (arr) arr.push(l)
    else m.set(k, [l])
  }

  Object.values(field.links).forEach((l) => {
    push(incident, l.source, l)
    push(incident, l.target, l)
    push(outgoing, l.source, l)
    push(incoming, l.target, l)
  })

  return { field, incident, outgoing, incoming }
}

/** Mean of an envelope scalar across a node's incident links; null if none asserted. */
function meanIncident(
  node: FieldNode,
  ctx: ProjectionContext,
  pick: (l: FieldLink) => number | undefined,
): number | null {
  const links = ctx.incident.get(node.id)
  if (!links || links.length === 0) return null
  let sum = 0
  let n = 0
  for (const l of links) {
    const v = pick(l)
    if (isNum(v)) {
      sum += v
      n += 1
    }
  }
  return n === 0 ? null : clamp01(sum / n)
}

/**
 * Normalized BFS depth along the included link set, measured from nodes with
 * no included incoming link. Used by the structural projections (governance
 * inheritance, provenance lineage, workflow dependency) where "where does this
 * sit in the chain" is the question, not "how high does it score".
 *
 * Cached per (field, includeLink) pair via the context, since every node in a
 * projection asks for the same map.
 */
const depthCache = new WeakMap<
  ProjectionContext,
  Map<string, Map<string, number | null>>
>()

function depthAlong(
  ctx: ProjectionContext,
  key: string,
  includeLink: (l: FieldLink) => boolean,
): Map<string, number | null> {
  let perCtx = depthCache.get(ctx)
  if (!perCtx) {
    perCtx = new Map()
    depthCache.set(ctx, perCtx)
  }
  const hit = perCtx.get(key)
  if (hit) return hit

  const ids = Object.keys(ctx.field.nodes)
  const links = Object.values(ctx.field.links).filter(includeLink)

  const inDeg = new Map<string, number>()
  const succ = new Map<string, string[]>()
  // Nodes that actually participate in this projection's link set. A node
  // touched by no included link has *no* position in the chain — which is not
  // the same as sitting at its root, and must not be reported as depth 0.
  const participates = new Set<string>()
  ids.forEach((id) => inDeg.set(id, 0))
  links.forEach((l) => {
    if (!(l.source in ctx.field.nodes) || !(l.target in ctx.field.nodes)) return
    participates.add(l.source)
    participates.add(l.target)
    inDeg.set(l.target, (inDeg.get(l.target) ?? 0) + 1)
    const s = succ.get(l.source)
    if (s) s.push(l.target)
    else succ.set(l.source, [l.target])
  })

  const depth = new Map<string, number>()
  const queue: string[] = []
  ids.forEach((id) => {
    if (participates.has(id) && (inDeg.get(id) ?? 0) === 0) {
      depth.set(id, 0)
      queue.push(id)
    }
  })

  // Longest-path-style relaxation, bounded so a cycle cannot spin forever.
  let guard = ids.length * 4
  while (queue.length > 0 && guard-- > 0) {
    const cur = queue.shift() as string
    const d = depth.get(cur) ?? 0
    for (const nxt of succ.get(cur) ?? []) {
      const prev = depth.get(nxt)
      if (prev === undefined || prev < d + 1) {
        depth.set(nxt, d + 1)
        queue.push(nxt)
      }
    }
  }

  const max = Math.max(1, ...Array.from(depth.values()))
  const out = new Map<string, number | null>()
  ids.forEach((id) => {
    if (!participates.has(id)) {
      out.set(id, null) // not in this chain at all
      return
    }
    const d = depth.get(id)
    // Participates but was never seeded — only reachable inside a cycle.
    // Park it mid-axis rather than claiming a depth the graph cannot support.
    out.set(id, d === undefined ? 0.5 : d / max)
  })
  perCtx.set(key, out)
  return out
}

// ---------------------------------------------------------------------------
// link predicates

const hasGovernance = (l: FieldLink) =>
  l.envelope?.governance != null || l.kind === 'governed_by'

const hasProvenance = (l: FieldLink) =>
  l.envelope?.provenance != null ||
  l.kind === 'derived_from' ||
  l.envelope?.relation_type === 'derived_from'

const WORKFLOW_RELATIONS = new Set([
  'workflow',
  'depends_on',
  'precedes',
  'triggers',
  'produced_evidence_for',
])

const isWorkflow = (l: FieldLink) =>
  (l.kind != null && WORKFLOW_RELATIONS.has(l.kind)) ||
  (l.envelope?.relation_type != null &&
    WORKFLOW_RELATIONS.has(l.envelope.relation_type))

// ---------------------------------------------------------------------------
// the eight built-ins (STATEMENT §9.5)

export const similarityProjection: ProjectionSpec = {
  id: 'similarity',
  label: 'Similarity',
  description:
    'Pure force layout weighted by link confidence — clusters form from semantic proximity rather than from any declared hierarchy.',
  scalar: () => null,
  includeLink: () => true,
  linkWeight: (l) => (isNum(l.envelope?.confidence) ? l.envelope!.confidence! : 0.35),
}

export const governanceProjection: ProjectionSpec = {
  id: 'governance',
  label: 'Governance',
  description:
    'Depth of governance inheritance. Policy authorities sit upstream; the nodes they govern stratify downstream.',
  includeLink: hasGovernance,
  scalar: (node, ctx) => depthAlong(ctx, 'governance', hasGovernance).get(node.id) ?? null,
  linkWeight: () => 0.5,
}

export const trustProjection: ProjectionSpec = {
  id: 'trust',
  label: 'Trust',
  description:
    'Mean trust across a node’s incident links. Nodes reached only over low-trust relationships separate out.',
  includeLink: (l) => isNum(l.envelope?.trust),
  scalar: (node, ctx) => meanIncident(node, ctx, (l) => l.envelope?.trust),
  linkWeight: (l) => (isNum(l.envelope?.trust) ? l.envelope!.trust! : 0.2),
}

export const readinessProjection: ProjectionSpec = {
  id: 'readiness',
  label: 'Execution readiness',
  description:
    'Mean readiness across incident links — how prepared a node is to carry an action right now.',
  includeLink: (l) => isNum(l.envelope?.readiness),
  scalar: (node, ctx) => meanIncident(node, ctx, (l) => l.envelope?.readiness),
  linkWeight: (l) => (isNum(l.envelope?.readiness) ? l.envelope!.readiness! : 0.2),
}

export const provenanceProjection: ProjectionSpec = {
  id: 'provenance',
  label: 'Provenance',
  description:
    'Lineage depth. Origin data sits upstream, derived artifacts downstream.',
  includeLink: hasProvenance,
  scalar: (node, ctx) => depthAlong(ctx, 'provenance', hasProvenance).get(node.id) ?? null,
  linkWeight: () => 0.6,
}

export const workflowProjection: ProjectionSpec = {
  id: 'workflow',
  label: 'Workflow dependency',
  description:
    'Topological depth along workflow dependencies — the closest projection to a conventional execution DAG.',
  includeLink: isWorkflow,
  scalar: (node, ctx) => depthAlong(ctx, 'workflow', isWorkflow).get(node.id) ?? null,
  linkWeight: () => 0.7,
}

export const relearningPressureProjection: ProjectionSpec = {
  id: 'relearning_pressure',
  label: 'Relearning pressure',
  description:
    'Mean relearning pressure — how stale the evidence supporting a node’s relationships has become.',
  includeLink: (l) => isNum(l.envelope?.relearning_pressure),
  scalar: (node, ctx) => meanIncident(node, ctx, (l) => l.envelope?.relearning_pressure),
  linkWeight: () => 0.3,
}

/**
 * Risk takes the *worst* incident link rather than the mean: one untrusted,
 * policy-incompatible relationship is enough to make a node risky, and
 * averaging would let a crowd of benign links hide it.
 */
export const riskProjection: ProjectionSpec = {
  id: 'risk',
  label: 'Risk',
  description:
    'Worst-case exposure across incident links: 1 − min(trust, policy_compat, readiness). A single bad relationship dominates.',
  includeLink: (l) =>
    isNum(l.envelope?.trust) ||
    isNum(l.envelope?.policy_compat) ||
    isNum(l.envelope?.readiness),
  scalar: (node, ctx) => {
    const links = ctx.incident.get(node.id)
    if (!links || links.length === 0) return null
    let worst: number | null = null
    for (const l of links) {
      const parts = [
        l.envelope?.trust,
        l.envelope?.policy_compat,
        l.envelope?.readiness,
      ].filter(isNum)
      if (parts.length === 0) continue
      const risk = 1 - Math.min(...parts)
      if (worst === null || risk > worst) worst = risk
    }
    return worst === null ? null : clamp01(worst)
  },
  linkWeight: () => 0.4,
}

// ---------------------------------------------------------------------------
// deviation from a subject's own baseline
//
// Deliberately NOT one of the eight built-ins, and deliberately not registered
// by `defaultRegistry()`. Its input does not come from the field envelope at
// all — it comes from the gate's bounded store over `/api/scope/v1/pressure` —
// so a canvas rendering a plain topology has no way to compute it and should
// not advertise it. The app registers it once that endpoint answers.

/**
 * Per-subject admission pressure, as the gate's bounded store reports it.
 *
 * `refusals_sigma` is `null` where the baseline is flat: a zero-variance
 * baseline makes every deviation infinite, and the store declines to turn that
 * into a number rather than reporting one that invites acting on it.
 */
export interface AdmissionPressure {
  evaluations_now?: number | null
  refusals_now?: number | null
  refusals_sigma?: number | null
  /** Resolutions the read grant refused, named rather than silently dropped. */
  withheld_resolutions?: string[]
}

/** Where the app parks the pressure reading on a node. */
export const ADMISSION_PRESSURE_KEY = 'admission_pressure'

export function readAdmissionPressure(node: FieldNode): AdmissionPressure | null {
  const raw = node.domain_extensions?.[ADMISSION_PRESSURE_KEY]
  return raw && typeof raw === 'object' ? (raw as AdmissionPressure) : null
}

/** Sigma at which the axis saturates. Four is the usual "unmistakable" mark. */
export const ADMISSION_DEVIATION_FULL_SCALE = 4

/**
 * How far a subject's refusal rate sits *above* its own baseline.
 *
 * One-sided on purpose. The operator question is "is this being refused more
 * than it usually is", so a subject at or below its baseline sits at the foot
 * of the axis rather than being spread across the lower half. Being refused
 * less than usual is not a finding.
 *
 * Three states that must stay distinguishable, and the reason this projection
 * is worth the care:
 *
 *   - **no reading at all** — the store has never been asked about this
 *     subject. `null`, so the node floats unranked and the coverage readout
 *     counts it as unplaced.
 *   - **a reading with no baseline** — asked, but the baseline is flat. Also
 *     `null`. It is not zero deviation; it is a deviation nobody can compute.
 *   - **a reading at baseline** — genuinely 0, and it means something.
 */
export const admissionDeviationProjection: ProjectionSpec = {
  id: 'admission_deviation',
  label: 'Admission deviation',
  description:
    'How far each subject’s refusal rate sits above its own baseline, in that baseline’s own standard deviations. Reads the gate’s bounded store, not the link envelope — subjects the gate has never decided about are unranked rather than calm.',
  scalar: (node) => {
    const p = readAdmissionPressure(node)
    if (!p) return null
    const sigma = p.refusals_sigma
    if (!isNum(sigma)) return null
    return clamp01(sigma / ADMISSION_DEVIATION_FULL_SCALE)
  },
  // Every link participates: the deviation is a property of the node, and
  // excluding links would strand a deviating subject away from the neighbors
  // that give it context.
  includeLink: () => true,
  linkWeight: () => 0.25,
}

export const builtinProjections: ProjectionSpec[] = [
  similarityProjection,
  governanceProjection,
  trustProjection,
  readinessProjection,
  provenanceProjection,
  workflowProjection,
  relearningPressureProjection,
  riskProjection,
]

/** A registry preloaded with the eight built-ins. */
export function defaultRegistry(): ProjectionRegistry {
  return new ProjectionRegistry(builtinProjections)
}
