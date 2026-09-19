import type { SemanticField } from './types'

/**
 * Validate a SemanticField arriving from outside the process.
 *
 * TypeScript checks the code that builds a field inside this repository. It
 * checks nothing at all about a payload that arrived over HTTP from a service
 * written in another language, which is where malformed fields actually come
 * from -- and where the failure is worst, because a renderer handed a bad field
 * draws something wrong rather than refusing.
 *
 * Deliberately NOT called on every render. Validation belongs at the boundary,
 * once, where the untrusted data arrives; a renderer that re-validated its props
 * on each frame would pay for it forever and still not know where the data came
 * from. `FieldCanvas` therefore trusts its props, and this is what a host calls
 * before handing them over.
 *
 * Errors are written in the caller's terms -- the path a producer would
 * recognize in its own payload, what was expected, and what arrived -- because
 * an error naming an internal type tells the wrong person the wrong thing.
 *
 * Zero dependencies. `schema/semantic-field.schema.json` states the same
 * contract for producers in other languages, and `check-schema.ts` requires the
 * two to agree on every fixture, so neither can drift without the build failing.
 */
export interface FieldProblem {
  /** Where, in the payload's own shape: `links.l3.target`. */
  path: string
  message: string
}

export interface FieldValidation {
  valid: boolean
  problems: FieldProblem[]
  /** The input, typed, when and only when `valid` is true. */
  field: SemanticField | null
}

const STATES = new Set([
  'idle',
  'running',
  'paused',
  'completed',
  'failed',
  'pending_human',
  'refused',
  'unknown',
])

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function scalar(v: unknown, path: string, out: FieldProblem[]) {
  if (v === undefined) return
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    out.push({ path, message: `expected a number in [0,1], received ${describe(v)}` })
    return
  }
  if (v < 0 || v > 1) {
    out.push({ path, message: `expected a number in [0,1], received ${v}` })
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'an array'
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`
  return `${typeof v} ${JSON.stringify(v) ?? ''}`.trim()
}

function str(v: unknown, path: string, out: FieldProblem[], required: boolean) {
  if (v === undefined) {
    if (required) out.push({ path, message: 'is required and missing' })
    return
  }
  if (typeof v !== 'string') {
    out.push({ path, message: `expected a string, received ${describe(v)}` })
  } else if (required && v.length === 0) {
    out.push({ path, message: 'is required and empty' })
  }
}

export function validateField(input: unknown): FieldValidation {
  const problems: FieldProblem[] = []

  if (!isObj(input)) {
    return {
      valid: false,
      problems: [{ path: '', message: `expected an object, received ${describe(input)}` }],
      field: null,
    }
  }

  const nodes = input.nodes
  const links = input.links

  if (!isObj(nodes)) {
    problems.push({ path: 'nodes', message: `expected an object keyed by node id, received ${describe(nodes)}` })
  }
  if (!isObj(links)) {
    problems.push({ path: 'links', message: `expected an object keyed by link id, received ${describe(links)}` })
  }

  if (isObj(nodes)) {
    for (const [key, n] of Object.entries(nodes)) {
      const at = `nodes.${key}`
      if (!isObj(n)) {
        problems.push({ path: at, message: `expected an object, received ${describe(n)}` })
        continue
      }
      str(n.id, `${at}.id`, problems, true)
      str(n.label, `${at}.label`, problems, true)
      str(n.kind, `${at}.kind`, problems, true)
      // The map key and the node's own id are two statements of the same fact.
      // When they disagree there is no way to tell which one a producer meant,
      // and every link that references one of them is ambiguous.
      if (typeof n.id === 'string' && n.id !== key) {
        problems.push({
          path: `${at}.id`,
          message: `is ${JSON.stringify(n.id)} but the node is keyed as ${JSON.stringify(key)}; the key and the id must match`,
        })
      }
      if (n.state !== undefined && (typeof n.state !== 'string' || !STATES.has(n.state))) {
        problems.push({
          path: `${at}.state`,
          message: `expected one of ${[...STATES].join(', ')}, received ${describe(n.state)}`,
        })
      }
      if (n.metric !== undefined) {
        if (!isObj(n.metric)) {
          problems.push({ path: `${at}.metric`, message: `expected an object, received ${describe(n.metric)}` })
        } else if (n.metric.value === undefined) {
          problems.push({
            path: `${at}.metric.value`,
            message: 'is required; use null to say the metric is not asserted',
          })
        } else if (n.metric.value !== null) {
          scalar(n.metric.value, `${at}.metric.value`, problems)
        }
      }
    }
  }

  if (isObj(links)) {
    for (const [key, l] of Object.entries(links)) {
      const at = `links.${key}`
      if (!isObj(l)) {
        problems.push({ path: at, message: `expected an object, received ${describe(l)}` })
        continue
      }
      str(l.id, `${at}.id`, problems, true)
      str(l.source, `${at}.source`, problems, true)
      str(l.target, `${at}.target`, problems, true)
      if (typeof l.id === 'string' && l.id !== key) {
        problems.push({
          path: `${at}.id`,
          message: `is ${JSON.stringify(l.id)} but the link is keyed as ${JSON.stringify(key)}; the key and the id must match`,
        })
      }
      // The check TypeScript cannot make and a remote producer gets wrong: an
      // edge to a node that is not in the payload. Drawn, it asserts a
      // relationship against something the reader cannot see.
      if (isObj(nodes)) {
        for (const end of ['source', 'target'] as const) {
          const v = l[end]
          if (typeof v === 'string' && v.length > 0 && !(v in nodes)) {
            problems.push({
              path: `${at}.${end}`,
              message: `names ${JSON.stringify(v)}, which is not a node in this field`,
            })
          }
        }
      }
      if (l.envelope !== undefined) {
        if (!isObj(l.envelope)) {
          problems.push({ path: `${at}.envelope`, message: `expected an object, received ${describe(l.envelope)}` })
        } else {
          for (const k of ['confidence', 'policy_compat', 'trust', 'readiness', 'relearning_pressure'] as const) {
            scalar(l.envelope[k], `${at}.envelope.${k}`, problems)
          }
        }
      }
    }
  }

  if (input.projection !== undefined) str(input.projection, 'projection', problems, false)
  if (input.updated_at !== undefined && typeof input.updated_at !== 'number') {
    problems.push({ path: 'updated_at', message: `expected a number, received ${describe(input.updated_at)}` })
  }

  return {
    valid: problems.length === 0,
    problems,
    field: problems.length === 0 ? (input as unknown as SemanticField) : null,
  }
}
