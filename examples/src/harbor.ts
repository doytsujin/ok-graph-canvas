/**
 * An invented domain: a harbour that issues berth permits.
 *
 * Invented on purpose, and the choice matters more than it looks. This renderer
 * is vocabulary-free by construction, so every example has to be a domain the
 * package has never heard of — otherwise the demo quietly argues the opposite of
 * the design. Nothing here means anything outside this file.
 *
 * The field is shaped so the projections visibly disagree. Governance links
 * carry a `governance` block, provenance links carry `derived_from`, workflow
 * links carry a relation the workflow projection recognises, and the envelope
 * scalars are deliberately uneven -- several are left `undefined`, which is not
 * the same as 0 and is the distinction the whole envelope rests on.
 */
import type {
  DecisionTrace,
  FieldLink,
  FieldNode,
  SemanticField,
  ShapeKind,
} from '@agent-scope-ca/graph-canvas'

const node = (n: FieldNode): [string, FieldNode] => [n.id, n]
const link = (l: FieldLink): [string, FieldLink] => [l.id, l]

export const harborField: SemanticField = {
  nodes: Object.fromEntries([
    node({
      id: 'harbormaster', label: 'Harbormaster', kind: 'controller', group: 'authority',
      state: 'running', metric: { value: 0.72, formatted: '72% duty' },
      descriptor: { shift: 'A', standing: 'statutory' },
    }),
    node({
      id: 'permit-registry', label: 'Permit registry', kind: 'registry', group: 'authority',
      state: 'running', metric: { value: 0.94, formatted: '94% synced' },
      descriptor: { permits_open: 31 },
    }),
    node({
      id: 'pilot-roster', label: 'Pilot roster', kind: 'roster', group: 'authority',
      state: 'idle', metric: { value: 0.4, formatted: '4 of 10 on call' },
    }),

    node({
      id: 'berth-0', label: 'Berth 0 — deep water', kind: 'berth', group: 'north quay',
      state: 'running', metric: { value: 0.88, formatted: '8.8 m draft' },
      descriptor: { permit: 'valid', last_survey: 'day 14' },
    }),
    node({
      id: 'berth-1', label: 'Berth 1 — north quay', kind: 'berth', group: 'north quay',
      state: 'paused', metric: { value: 0.55, formatted: '5.5 m draft' },
      descriptor: { permit: 'suspended', reason: 'silt above threshold at marker 2' },
    }),
    node({
      id: 'berth-2', label: 'Berth 2 — south quay', kind: 'berth', group: 'south quay',
      state: 'running', metric: { value: 0.61, formatted: '6.1 m draft' },
    }),
    node({
      id: 'berth-3', label: 'Berth 3 — lay-by', kind: 'berth', group: 'south quay',
      state: 'pending_human', metric: { value: null },
      descriptor: { permit: 'awaiting sign-off' },
    }),

    node({
      id: 'vessel-114', label: 'Kestrel (vessel 114)', kind: 'vessel', group: 'north quay',
      state: 'completed', metric: { value: 0.3, formatted: '3.0 m draft' },
    }),
    node({
      id: 'vessel-207', label: 'Alder Bay (vessel 207)', kind: 'vessel', group: 'north quay',
      state: 'refused', metric: { value: 0.91, formatted: '9.1 m draft' },
      descriptor: { refusal: 'draft exceeds surveyed depth' },
    }),
    node({
      id: 'vessel-233', label: 'Merle (vessel 233)', kind: 'vessel', group: 'south quay',
      state: 'running', metric: { value: 0.52, formatted: '5.2 m draft' },
    }),

    node({
      id: 'tide-sensor', label: 'Tide sensor', kind: 'sensor', group: 'survey',
      state: 'running', metric: { value: 0.99, formatted: '99% uptime' },
    }),
    node({
      id: 'silt-survey', label: 'Silt survey', kind: 'survey', group: 'survey',
      state: 'completed', metric: { value: 0.66, formatted: 'day 14' },
    }),
    node({
      id: 'depth-model', label: 'Depth model', kind: 'model', group: 'survey',
      state: 'running', metric: { value: 0.78 },
    }),
    node({
      id: 'manifest-store', label: 'Manifest store', kind: 'manifest', group: 'records',
      state: 'idle', metric: { value: 0.83, formatted: '1.2k manifests' },
    }),
  ]),

  links: Object.fromEntries([
    // governance — the harbormaster's authority over each berth
    link({
      id: 'g0', source: 'harbormaster', target: 'berth-0', kind: 'governed_by',
      envelope: {
        confidence: 0.96, policy_compat: 0.98, trust: 0.9, readiness: 0.93,
        governance: { inherited_from: 'harbormaster', policies: ['draft-limit'], enforced: true },
      },
    }),
    link({
      id: 'g1', source: 'harbormaster', target: 'berth-1', kind: 'governed_by',
      envelope: {
        confidence: 0.94, policy_compat: 0.35, trust: 0.42, readiness: 0.2,
        governance: { inherited_from: 'harbormaster', policies: ['draft-limit', 'silt-hold'], enforced: true },
      },
    }),
    link({
      id: 'g2', source: 'harbormaster', target: 'berth-2', kind: 'governed_by',
      envelope: {
        confidence: 0.9, policy_compat: 0.88, trust: 0.81,
        // readiness deliberately not asserted — absent, not zero
        governance: { inherited_from: 'harbormaster', policies: ['draft-limit'], enforced: true },
      },
    }),
    link({
      id: 'g3', source: 'permit-registry', target: 'berth-3', kind: 'governed_by',
      envelope: {
        confidence: 0.7, policy_compat: 0.5, readiness: 0.45,
        governance: { inherited_from: 'harbormaster', policies: ['sign-off'], enforced: false },
      },
    }),
    link({
      id: 'g4', source: 'harbormaster', target: 'permit-registry', kind: 'governed_by',
      envelope: {
        confidence: 0.99, policy_compat: 0.97, trust: 0.95, readiness: 0.97,
        governance: { inherited_from: 'harbormaster', policies: ['records-retention'], enforced: true },
      },
    }),

    // provenance — where the surveyed depth actually comes from
    link({
      id: 'p0', source: 'tide-sensor', target: 'silt-survey', kind: 'derived_from',
      envelope: {
        confidence: 0.88, trust: 0.84,
        provenance: { source: 'tide-sensor', recorded_at: 'day 14', verified: true },
      },
    }),
    link({
      id: 'p1', source: 'silt-survey', target: 'depth-model', kind: 'derived_from',
      envelope: {
        confidence: 0.79, trust: 0.7, relearning_pressure: 0.62,
        provenance: { source: 'silt-survey', derived_from: ['tide-sensor'], verified: true },
      },
    }),
    link({
      id: 'p2', source: 'depth-model', target: 'berth-1', kind: 'derived_from',
      envelope: {
        confidence: 0.64, trust: 0.48, readiness: 0.3, relearning_pressure: 0.81,
        provenance: { source: 'depth-model', derived_from: ['silt-survey'], verified: false },
      },
    }),
    link({
      id: 'p3', source: 'depth-model', target: 'berth-0',
      envelope: {
        relation_type: 'derived_from', confidence: 0.9, trust: 0.86, readiness: 0.9,
        provenance: { source: 'depth-model', verified: true },
      },
    }),

    // workflow — what has to happen before a vessel is alongside
    link({
      id: 'w0', source: 'permit-registry', target: 'vessel-114', kind: 'precedes',
      envelope: { confidence: 0.92, readiness: 0.88, trust: 0.9, policy_compat: 0.95 },
    }),
    link({
      id: 'w1', source: 'vessel-114', target: 'berth-0', kind: 'depends_on',
      envelope: { confidence: 0.95, readiness: 0.92, trust: 0.88, policy_compat: 0.97 },
    }),
    link({
      id: 'w2', source: 'permit-registry', target: 'vessel-207', kind: 'precedes',
      envelope: { confidence: 0.6, readiness: 0.25, trust: 0.4, policy_compat: 0.12 },
    }),
    link({
      id: 'w3', source: 'vessel-207', target: 'berth-1', kind: 'depends_on',
      envelope: { confidence: 0.55, readiness: 0.1, policy_compat: 0.08, relearning_pressure: 0.9 },
    }),
    link({
      id: 'w4', source: 'vessel-233', target: 'berth-2', kind: 'depends_on',
      envelope: { confidence: 0.85, readiness: 0.74, trust: 0.77, policy_compat: 0.8 },
    }),
    link({
      id: 'w5', source: 'pilot-roster', target: 'vessel-233', kind: 'triggers',
      envelope: { confidence: 0.7, readiness: 0.6 },
    }),
    link({
      id: 'w6', source: 'silt-survey', target: 'harbormaster', kind: 'produced_evidence_for',
      envelope: { confidence: 0.82, trust: 0.79 },
    }),

    // plain association — no envelope at all, which must render as absence
    link({ id: 'n0', source: 'manifest-store', target: 'vessel-114' }),
    link({ id: 'n1', source: 'manifest-store', target: 'vessel-233' }),
  ]),

  projection: undefined,
  updated_at: Date.now(),
}

/**
 * The host brings its own vocabulary. `defaultShapeResolver` knows an
 * infrastructure vocabulary the harbour does not share, so the harbour supplies
 * its own — which is the extension point, demonstrated rather than described.
 */
export function harborShapeResolver(n: FieldNode): ShapeKind {
  switch (n.kind) {
    case 'controller': return 'octagon'
    case 'registry': return 'cylinder'
    case 'roster': return 'sheet'
    case 'berth': return 'square'
    case 'vessel': return 'triangle'
    case 'sensor': return 'circle'
    case 'survey': return 'cloud'
    case 'model': return 'hexagon'
    case 'manifest': return 'heptagon'
    default: return 'circle'
  }
}

/** Lane colour by group. Colours arrive as props; the canvas looks nothing up. */
export const groupColor: Record<string, string> = {
  authority: '#7c3aed',
  'north quay': '#0891b2',
  'south quay': '#0d9488',
  survey: '#b45309',
  records: '#64748b',
}

export function colorForNode(n: FieldNode): string {
  return groupColor[n.group ?? ''] ?? '#64748b'
}

/**
 * The same story as a decision trace: a permit granted, suspended when the silt
 * survey came back, invalidating what relied on it, and later restored.
 *
 * Note what is NOT here. No edge exists between two records merely because they
 * are adjacent in time -- every connector below was declared by the producer
 * with `caused_by` or `responds_to`. And `observed_at` differs from `timestamp`
 * on the records where the harbour learned late, which is the case the ordering
 * switch exists to expose.
 */
export const harborTrace: DecisionTrace = {
  lanes: [
    { id: 'intent', label: 'Intent', order: 0, description: 'what was asked for' },
    { id: 'control', label: 'Control', order: 1, description: 'what the authority resolved' },
    { id: 'verified', label: 'Verified', order: 2, description: 'what was confirmed in effect' },
    { id: 'computation', label: 'Berthing', order: 3, description: 'what actually happened' },
  ],
  records: [
    {
      id: 'e1', timestamp: 100, revision: 41, kind: 'permit.requested', lane: 'intent',
      subject: 'berth-1', source: 'permit-registry', state_after: 'Requested', tone: 'neutral',
    },
    {
      id: 'e2', timestamp: 101, observed_at: 104, revision: 41, kind: 'permit.granted',
      lane: 'control', subject: 'berth-1', source: 'harbormaster', state_after: 'Valid',
      responds_to: ['e1'], tone: 'positive',
    },
    {
      id: 'v1', timestamp: 102, revision: 41, kind: 'permit.effective', lane: 'verified',
      subject: 'berth-1', source: 'harbormaster', state_after: 'Valid', caused_by: ['e2'],
      tone: 'positive',
    },
    {
      id: 'd1', timestamp: 104, revision: 41, kind: 'berth.assign', lane: 'computation',
      subject: 'vessel-114', source: 'harbormaster', tone: 'positive',
      refs: [{ kind: 'artifact', id: 'vessel-114' }],
    },
    {
      id: 'w1', timestamp: 106, kind: 'permit.suspended', lane: 'intent', subject: 'berth-1',
      source: 'silt-survey', state_before: 'Valid', state_after: 'Suspended', tone: 'negative',
      descriptor: { reason: 'silt reading above threshold at marker 2' },
    },
    {
      id: 'v2', timestamp: 107, observed_at: 112, revision: 42, kind: 'permit.effective',
      lane: 'verified', subject: 'berth-1', source: 'harbormaster', state_before: 'Valid',
      state_after: 'Void', caused_by: ['w1'], tone: 'negative',
    },
    {
      id: 'd2', timestamp: 108, revision: 42, kind: 'berth.divert', lane: 'computation',
      subject: 'vessel-207', source: 'harbormaster', caused_by: ['v2'], tone: 'warning',
      refs: [{ kind: 'artifact', id: 'vessel-207' }],
    },
    {
      id: 'r1', timestamp: 200, kind: 'permit.restored', lane: 'intent', subject: 'berth-1',
      source: 'silt-survey', state_before: 'Suspended', state_after: 'Valid', tone: 'positive',
    },
    {
      id: 'v3', timestamp: 201, revision: 43, kind: 'permit.effective', lane: 'verified',
      subject: 'berth-1', source: 'harbormaster', state_before: 'Void', state_after: 'Valid',
      caused_by: ['r1'], tone: 'positive',
    },
    {
      id: 'd3', timestamp: 202, revision: 43, kind: 'berth.assign', lane: 'computation',
      subject: 'vessel-233', source: 'harbormaster', tone: 'positive',
      refs: [{ kind: 'artifact', id: 'vessel-233' }],
    },
  ],
  meta: { source: 'harbor-scheduling' },
}
