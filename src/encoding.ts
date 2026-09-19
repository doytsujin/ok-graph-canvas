/**
 * Semantic Link envelope → visual encoding.
 *
 * Each envelope scalar gets its own visual channel so several can be read at
 * once without collapsing into a single colour ramp:
 *
 * | envelope field        | channel      | reading                                  |
 * |-----------------------|--------------|------------------------------------------|
 * | `policy_compat`       | hue          | red = incompatible, green = compatible   |
 * | `trust`               | dash pattern | solid = trusted, short dash = untrusted  |
 * | `confidence`          | opacity      | faint = weakly asserted                  |
 * | `readiness`           | width        | thin = not ready to carry an action      |
 * | `governance.enforced` | outer halo   | halo = enforced, not merely declared     |
 * | `relearning_pressure` | tick mark    | ticked = evidence is going stale         |
 *
 * An `undefined` scalar leaves its channel at the neutral default. That is the
 * point of the distinction between `undefined` and `0`: "not asserted" must not
 * render as "asserted to be zero", or every field without governance metadata
 * would read as maximally unsafe.
 */

import type { FieldLink, FieldNodeState, SemanticLinkEnvelope } from './types'

export interface LinkVisual {
  stroke: string
  strokeWidth: number
  strokeOpacity: number
  strokeDasharray?: string
  /** Draw a second, wider, low-opacity stroke underneath. */
  halo: boolean
  /** Cross-tick at the midpoint — relearning pressure above threshold. */
  tick: boolean
  /** Ordered, human-readable reasons; feeds the hover tooltip. */
  summary: string[]
}

const NEUTRAL_STROKE = '#94a3b8'
const HIGHLIGHT_STROKE = '#7c1e42'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/**
 * Red (0°) → amber → green (145°) across [0, 1]. Kept at a fixed saturation
 * and lightness so the hue alone carries the signal and the line does not
 * change apparent weight as compatibility varies.
 */
export function policyCompatHue(v: number): string {
  const hue = Math.round(145 * clamp01(v))
  return `hsl(${hue}, 62%, 45%)`
}

export function trustDash(v: number): string | undefined {
  if (v >= 0.85) return undefined // solid
  if (v >= 0.6) return '10 4'
  if (v >= 0.3) return '6 4'
  return '2 4'
}

export interface EncodeLinkOptions {
  highlighted?: boolean
  /** Legacy traffic signal — dashes the line when there is live flow. */
  active?: boolean
  relearningThreshold?: number
}

export function encodeLink(
  link: Pick<FieldLink, 'envelope'>,
  opts: EncodeLinkOptions = {},
): LinkVisual {
  const { highlighted = false, active = false, relearningThreshold = 0.5 } = opts
  const env: SemanticLinkEnvelope = link.envelope ?? {}
  const summary: string[] = []

  let stroke = NEUTRAL_STROKE
  if (isNum(env.policy_compat)) {
    stroke = policyCompatHue(env.policy_compat)
    summary.push(`policy compat ${env.policy_compat.toFixed(2)}`)
  }

  let strokeDasharray: string | undefined
  if (isNum(env.trust)) {
    strokeDasharray = trustDash(env.trust)
    summary.push(`trust ${env.trust.toFixed(2)}`)
  } else if (active) {
    strokeDasharray = '6 4'
  }

  let strokeOpacity = 0.55
  if (isNum(env.confidence)) {
    strokeOpacity = 0.25 + 0.7 * clamp01(env.confidence)
    summary.push(`confidence ${env.confidence.toFixed(2)}`)
  }

  let strokeWidth = 1.4
  if (isNum(env.readiness)) {
    strokeWidth = 1.0 + 1.6 * clamp01(env.readiness)
    summary.push(`readiness ${env.readiness.toFixed(2)}`)
  }

  const halo = env.governance?.enforced === true
  if (halo) summary.push('governance enforced')

  const tick =
    isNum(env.relearning_pressure) && env.relearning_pressure > relearningThreshold
  if (tick) {
    summary.push(`relearning pressure ${env.relearning_pressure!.toFixed(2)}`)
  }

  if (env.relation_type) summary.unshift(env.relation_type)
  if (env.provenance?.verified === false) summary.push('provenance unverified')

  // Highlight overrides hue but preserves every other channel, so hovering a
  // node does not erase the semantics of its incident links.
  if (highlighted) {
    stroke = HIGHLIGHT_STROKE
    strokeOpacity = Math.max(strokeOpacity, 0.95)
    strokeWidth = Math.max(strokeWidth, 2.2)
  }

  return { stroke, strokeWidth, strokeOpacity, strokeDasharray, halo, tick, summary }
}

export interface StateVisual {
  color: string
  label: string
  /** Continuous animation — the node is doing something right now. */
  animated: boolean
}

const STATE_VISUALS: Record<FieldNodeState, StateVisual> = {
  idle: { color: '#94a3b8', label: 'idle', animated: false },
  running: { color: '#2563eb', label: 'running', animated: true },
  paused: { color: '#d97706', label: 'paused', animated: false },
  completed: { color: '#16a34a', label: 'completed', animated: false },
  failed: { color: '#dc2626', label: 'failed', animated: false },
  pending_human: { color: '#7c3aed', label: 'awaiting approval', animated: true },
  refused: { color: '#b91c1c', label: 'refused', animated: false },
  unknown: { color: '#cbd5e1', label: 'unknown', animated: false },
}

export function encodeState(state: FieldNodeState | undefined): StateVisual | null {
  if (!state || state === 'idle') return null
  return STATE_VISUALS[state] ?? STATE_VISUALS.unknown
}
