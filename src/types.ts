/**
 * The Semantic Field wire contract.
 *
 * Mirrors the host platform statement §5 (Agentcells), §6 (Semantic Links) and
 * §9 (UI Conceptual Views). Field names are snake_case to match the Rust
 * field-service payload exactly — no rename layer between the API and the
 * renderer, so a contract drift shows up as a type error rather than as
 * silently-undefined props.
 */

/** Agentcell roles — STATEMENT §5. */
export type AgentcellRole =
  | 'dataset'
  | 'index'
  | 'semantic-processor'
  | 'workflow-controller'
  | 'policy-authority'
  | 'telemetry-producer'
  | 'reasoning'

export const AGENTCELL_ROLES: AgentcellRole[] = [
  'dataset',
  'index',
  'semantic-processor',
  'workflow-controller',
  'policy-authority',
  'telemetry-producer',
  'reasoning',
]

/**
 * Execution state of a field node.
 *
 * `pending_human` drives the inline Approve/Reject affordance (TODO §3.3);
 * `refused` is a first-class outcome, not an error — a control plane that can
 * refuse needs somewhere to render the refusal.
 */
export type FieldNodeState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'pending_human'
  | 'refused'
  | 'unknown'

export interface ProvenanceRef {
  source?: string
  derived_from?: string[]
  recorded_at?: string
  /** Whether the lineage chain was verified, not whether it merely exists. */
  verified?: boolean
}

export interface GovernanceRef {
  inherited_from?: string
  policies?: string[]
  enforced?: boolean
}

/**
 * Semantic Link envelope.
 *
 * The generic half of the envelope landed in the platform gateway; the
 * `domain_extensions` hatch is what keeps profile-specific fields (PHI flags,
 * sample lineage, equipment bonds) out of the core struct.
 * See the host platform's extension-point table.
 *
 * Every scalar is normalized to [0, 1]. `undefined` means "not asserted",
 * which is different from 0 — projections skip undefined rather than
 * treating it as a floor.
 */
export interface SemanticLinkEnvelope {
  relation_type?: string
  confidence?: number
  policy_compat?: number
  trust?: number
  readiness?: number
  relearning_pressure?: number
  provenance?: ProvenanceRef
  governance?: GovernanceRef
  domain_extensions?: Record<string, unknown>
}

export interface FieldNodeMetric {
  /** Normalized [0, 1] — drives the clipped metric fill. */
  value: number | null
  formatted?: string
  color?: string
}

export interface FieldNode {
  id: string
  label: string
  /**
   * Open string, not a union. The host vocabulary (pod/service/host, or
   * mbr/ebr/step, or anything a profile registers) resolves to a shape via a
   * `ShapeResolver`; the canvas itself stays vocabulary-free.
   */
  kind: string
  role?: AgentcellRole
  /** Lane assignment — namespace, domain, tenant. */
  group?: string
  /** Explicit depth hint; when absent the projection supplies one. */
  rank?: number
  state?: FieldNodeState
  metric?: FieldNodeMetric
  /** Opaque payload for the Descriptor Inspector (STATEMENT §9.2). */
  descriptor?: Record<string, unknown>
  domain_extensions?: Record<string, unknown>
}

export interface FieldLink {
  id: string
  source: string
  target: string
  /** Coarse edge class, e.g. `network`, `governed_by`, `derived_from`. */
  kind?: string
  envelope?: SemanticLinkEnvelope
  domain_extensions?: Record<string, unknown>
}

export interface SemanticField {
  nodes: Record<string, FieldNode>
  links: Record<string, FieldLink>
  /** Which projection the server rendered this field under, if any. */
  projection?: string
  updated_at?: number
}

/** Convenience for callers holding a k8s-style topology payload. */
export function emptyField(): SemanticField {
  return { nodes: {}, links: {} }
}
