/**
 * Decision Trace — the wire contract and its ordering rules.
 *
 * A trace puts what a control plane *did* next to what happened *to* it. That is
 * only useful if the renderer stays as vocabulary-free as the canvas: `kind` is
 * an open string a profile owns, exactly like `FieldNode.kind`. No term from any
 * profile's domain appears below — not in a type, not in a branch, not in a
 * comment — and a check greps this file to keep it that way.
 *
 * Three rules this module exists to enforce.
 *
 * **Adjacency is not causality.** Two records printed next to each other say
 * nothing about one having caused the other. A connector is drawn only where a
 * producer declared `caused_by` or `responds_to`. Inferring it from proximity
 * would manufacture a relationship the evidence does not contain — and would do
 * so most confidently when events arrive from several pods at once.
 *
 * **Time is not one dimension.** `timestamp` is when a thing happened at its
 * source, `observed_at` is when the control plane noticed, and `revision` is the
 * state a decision was taken against. A controller can observe revision 163 at
 * 14:03:12 for a decision made against 163 at 14:03:10; reordering history
 * because one observation arrived later would be a lie about which state the
 * decision saw. {@link orderTrace} makes the caller name the dimension.
 *
 * **Absence is reported, never implied.** A record without `state_after` is not
 * a record asserting an empty state, and a lane nobody produced is not an empty
 * lane.
 */

/** Which track a record belongs to. Open, like `kind`: a profile may add lanes. */
export type TraceLaneId = string

/**
 * The four lanes the control-plane model uses. Declared here as a convenience,
 * not as a closed set — a profile with no notion of "intent" simply never
 * produces one, and the renderer shows the lanes it is given.
 */
export const CONTROL_LANES = {
  /** What configuration asked for. */
  intent: 'intent',
  /** What the control plane observed or resolved. */
  control: 'control',
  /** What the enforcing component would actually do right now. */
  verified: 'verified',
  /** Work the system performed. */
  computation: 'computation',
} as const

/** Presentation only, supplied by the profile. Never inferred from `kind`. */
export type TraceTone = 'positive' | 'negative' | 'warning' | 'neutral'

/** A pointer out of the trace: to an artifact, a record, a revision. */
export interface TraceRef {
  /** Open string — `artifact`, `decision`, `evidence`, `revision`, … */
  kind: string
  id: string
  /** Where a consumer can fetch it, when the producer knows. */
  href?: string
}

export interface TraceLane {
  id: TraceLaneId
  label: string
  /** Ordering hint for stacking lanes; absent means "after the declared ones". */
  order?: number
  description?: string
}

export interface TraceRecord {
  id: string
  /** Wall-clock at the source, in seconds. */
  timestamp: number
  /** When the control plane observed it, when that is a different moment. */
  observed_at?: number
  /**
   * Monotonic per-subject ordering that does not depend on any clock: the
   * version of the state a record was produced against. Two records sharing one
   * revision saw the same world, however far apart their clocks were.
   */
  revision?: number
  /** A producer-assigned total order, when one exists. */
  sequence?: number
  /** Profile vocabulary. The renderer prints it and does not interpret it. */
  kind: string
  lane: TraceLaneId
  /** Who emitted it — a monitor, a controller, a pod. */
  source?: string
  /** What it is about: a backend, a run, an object id. */
  subject?: string
  correlation_id?: string
  state_before?: string
  state_after?: string
  /** Causality, declared rather than inferred. */
  caused_by?: string[]
  responds_to?: string[]
  refs?: TraceRef[]
  tone?: TraceTone
  label?: string
  descriptor?: Record<string, unknown>
}

export interface TraceMeta {
  source?: string
  /** Reported so a reader knows whether they are seeing the whole story. */
  truncated?: boolean
  window?: { from?: number; to?: number }
}

export interface DecisionTrace {
  records: TraceRecord[]
  lanes: TraceLane[]
  meta?: TraceMeta
}

export function emptyTrace(): DecisionTrace {
  return { records: [], lanes: [] }
}

/** Which clock (or counter) an ordering is taken over. */
export type TraceOrdering = 'timestamp' | 'observed_at' | 'revision' | 'sequence'

/**
 * Order records along one named dimension, oldest first.
 *
 * The dimension is a parameter and has no default on purpose. A trace sorted by
 * "time" without saying *which* time silently picks one, and the choice is
 * exactly what distinguishes when a thing happened from when anyone noticed.
 *
 * Records missing the chosen dimension keep their relative input order and sort
 * after those that have it: they are not asserted to be at zero.
 */
export function orderTrace(
  records: readonly TraceRecord[],
  by: TraceOrdering,
): TraceRecord[] {
  const keyed: { r: TraceRecord; k: number | undefined; i: number }[] = records.map(
    (r, i) => ({ r, k: r[by] as number | undefined, i }),
  )
  keyed.sort((a, b) => {
    if (a.k === undefined && b.k === undefined) return a.i - b.i
    if (a.k === undefined) return 1
    if (b.k === undefined) return -1
    return a.k === b.k ? a.i - b.i : a.k - b.k
  })
  return keyed.map((x) => x.r)
}

export interface CausalEdge {
  from: string
  to: string
  /** `caused_by` is a claim about production; `responds_to` about reaction. */
  relation: 'caused_by' | 'responds_to'
}

/**
 * The causal edges a trace actually declares.
 *
 * Dangling references are dropped rather than invented: a record naming a
 * `caused_by` that is not in this window is a record whose cause is outside the
 * window, which is not the same as a cause that does not exist. Callers wanting
 * to show that should compare against {@link danglingCauses}.
 */
export function causalEdges(records: readonly TraceRecord[]): CausalEdge[] {
  const present = new Set(records.map((r) => r.id))
  const out: CausalEdge[] = []
  for (const r of records) {
    for (const c of r.caused_by ?? []) {
      if (c !== r.id && present.has(c)) out.push({ from: c, to: r.id, relation: 'caused_by' })
    }
    for (const c of r.responds_to ?? []) {
      if (c !== r.id && present.has(c)) out.push({ from: c, to: r.id, relation: 'responds_to' })
    }
  }
  return out
}

/**
 * Records that name themselves as their own cause.
 *
 * A malformed claim rather than an absence, so it is reported separately from
 * {@link danglingCauses} and excluded from {@link causalEdges}. Left in, it
 * would draw a loop, and any consumer walking causality to find an origin would
 * never reach one.
 */
export function selfCauses(records: readonly TraceRecord[]): string[] {
  return records
    .filter((r) => [...(r.caused_by ?? []), ...(r.responds_to ?? [])].includes(r.id))
    .map((r) => r.id)
}

/**
 * The records that declared `id` as their cause — the reverse of
 * {@link causalEdges}.
 *
 * Causality that can only be walked forwards is causality a reader can confirm
 * but not explore. "Why did this refuse" is answerable from the record itself;
 * "what else did that affect" is the question asked immediately afterwards, and
 * it needs the index built the other way round.
 */
export function affectedBy(
  records: readonly TraceRecord[],
  id: string,
): TraceRecord[] {
  return records.filter(
    (r) =>
      // A record is never downstream of itself. See {@link selfCauses}.
      r.id !== id &&
      ((r.caused_by ?? []).includes(id) || (r.responds_to ?? []).includes(id)),
  )
}

/**
 * The reference a consumer should follow when this record is selected.
 *
 * Selection hands over an identity and nothing else. The alternative — building
 * an inspector payload out of the trace row — would quietly make the summary
 * authoritative for a decision's contents, and the summary is the thing that
 * gets filtered, paged and re-ordered on its way to a reader.
 *
 * A record with no reference is not a broken record. It is a record that is its
 * own subject, and a consumer should show it directly rather than fetching
 * something that was never promised.
 */
export function primaryRef(record: TraceRecord): TraceRef | undefined {
  return record.refs?.[0]
}

/**
 * Whether a record's primary reference points at the record itself.
 *
 * **A self-reference is an identity, not a relationship.** Producers whose
 * records *are* the thing a reader wants to open — a control event, say —
 * declare a reference to their own id, so that following a reference works the
 * same way everywhere instead of being conditional on what kind of record it
 * is. It names the canonical subject and the focus target, and nothing else.
 *
 * It is emphatically not an edge. A consumer that treated it as one would walk
 * from a record to itself and back for ever, and the loop would only appear
 * once inspectors became interactive enough to follow references automatically.
 * Causality lives in `caused_by` and `responds_to`, and nowhere else.
 */
export function isSelfReference(record: TraceRecord): boolean {
  const ref = primaryRef(record)
  return ref !== undefined && ref.id === record.id
}

/** References to records outside this window, so truncation is visible. */
export function danglingCauses(records: readonly TraceRecord[]): string[] {
  const present = new Set(records.map((r) => r.id))
  const missing = new Set<string>()
  for (const r of records) {
    for (const c of [...(r.caused_by ?? []), ...(r.responds_to ?? [])]) {
      if (!present.has(c)) missing.add(c)
    }
  }
  return [...missing]
}

/** Records grouped into the lanes a trace declares, in declared order. */
export function laneRows(
  trace: DecisionTrace,
  by: TraceOrdering = 'timestamp',
): { lane: TraceLane; records: TraceRecord[] }[] {
  const lanes = [...trace.lanes].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
  )
  const ordered = orderTrace(trace.records, by)
  return lanes.map((lane) => ({
    lane,
    records: ordered.filter((r) => r.lane === lane.id),
  }))
}

export interface LaneDisagreement {
  subject: string
  /** The most recent asserted state in each lane that asserted one. */
  states: { lane: TraceLaneId; state: string; record: string; at: number }[]
}

/**
 * Subjects whose lanes disagree about the state they are in.
 *
 * Structural, not semantic: it compares `state_after` strings for one subject
 * across lanes and reports where the latest assertions differ. It does not know
 * which lane is authoritative, and must not — that is a profile's judgement.
 *
 * This is what makes a control plane's worst failure mode legible. A system
 * reporting "not ready" while still acting as though it were ready produces two
 * lanes asserting different states for one subject, and the point of surfacing
 * it here is that no one has to notice it by eye.
 */
export function laneDisagreements(
  records: readonly TraceRecord[],
  by: TraceOrdering = 'timestamp',
): LaneDisagreement[] {
  const latest = new Map<string, Map<TraceLaneId, TraceRecord>>()
  for (const r of orderTrace(records, by)) {
    if (!r.subject || r.state_after === undefined) continue
    if (!latest.has(r.subject)) latest.set(r.subject, new Map())
    latest.get(r.subject)!.set(r.lane, r)
  }
  const out: LaneDisagreement[] = []
  for (const [subject, byLane] of latest) {
    const states = [...byLane.entries()].map(([lane, r]) => ({
      lane,
      state: r.state_after!,
      record: r.id,
      at: (r[by] as number | undefined) ?? r.timestamp,
    }))
    if (new Set(states.map((s) => s.state)).size > 1) out.push({ subject, states })
  }
  return out
}

/**
 * The state track for one subject in one lane, oldest first.
 *
 * Useful for rendering a lane as a run of states rather than a run of events,
 * which is how a reader actually reasons about "what was it, and when did that
 * change".
 */
export function stateTrack(
  records: readonly TraceRecord[],
  subject: string,
  lane: TraceLaneId,
  by: TraceOrdering = 'timestamp',
): TraceRecord[] {
  return orderTrace(records, by).filter(
    (r) => r.subject === subject && r.lane === lane && r.state_after !== undefined,
  )
}
