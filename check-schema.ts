/**
 * The validator and the published JSON Schema must not drift.
 *
 * Two artifacts state the same contract: `src/validateField.ts`, which a
 * JavaScript host calls, and `schema/semantic-field.schema.json`, which a
 * producer in Rust or Python validates against. Two statements of one contract
 * is exactly the arrangement that silently diverges, so this runs both over one
 * fixture corpus and requires them to agree.
 *
 * They cannot agree on everything, and pretending otherwise would be the bug
 * this file exists to prevent. Plain JSON Schema cannot express that a link
 * endpoint must name a node present in the same payload, nor that a map key and
 * the id inside it must match -- both are relationships between parts of the
 * document. Those cases are listed separately and the asymmetry is ASSERTED: the
 * validator must reject them and the schema must accept them. If the schema ever
 * starts rejecting one, someone has taught it something and this check should
 * be the thing that notices.
 */
// The schema declares draft 2020-12, so it needs ajv's 2020 entry point. The
// default export only knows draft-07 and fails with "no schema with key or ref",
// which reads like a missing reference rather than a wrong dialect.
import Ajv from 'ajv/dist/2020'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateField } from './src/validateField'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const nested = join(process.cwd(), 'packages/graph-canvas')
const root = existsSync(join(nested, 'package.json')) ? nested : process.cwd()
const schema = JSON.parse(readFileSync(join(root, 'schema/semantic-field.schema.json'), 'utf8'))
const ajv = new Ajv({ strict: false, allErrors: true })
const bySchema = ajv.compile(schema)

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  kind: 'thing',
  ...extra,
})

/** Both must agree on every one of these. */
const agreed: Array<[string, unknown, boolean]> = [
  ['an empty field', { nodes: {}, links: {} }, true],
  ['a node and a link', { nodes: { a: node('a'), b: node('b') }, links: { l: { id: 'l', source: 'a', target: 'b' } } }, true],
  ['a null metric, meaning not asserted', { nodes: { a: node('a', { metric: { value: null } }) }, links: {} }, true],
  ['a full envelope', { nodes: { a: node('a'), b: node('b') }, links: { l: { id: 'l', source: 'a', target: 'b', envelope: { confidence: 1, trust: 0, policy_compat: 0.5 } } } }, true],
  ['missing nodes', { links: {} }, false],
  ['missing links', { nodes: {} }, false],
  ['a node with no id', { nodes: { a: { label: 'a', kind: 'thing' } }, links: {} }, false],
  ['a node with no kind', { nodes: { a: { id: 'a', label: 'a' } }, links: {} }, false],
  ['a scalar above 1', { nodes: { a: node('a'), b: node('b') }, links: { l: { id: 'l', source: 'a', target: 'b', envelope: { trust: 1.4 } } } }, false],
  ['a scalar below 0', { nodes: { a: node('a'), b: node('b') }, links: { l: { id: 'l', source: 'a', target: 'b', envelope: { trust: -0.2 } } } }, false],
  ['a metric above 1', { nodes: { a: node('a', { metric: { value: 3 } }) }, links: {} }, false],
  ['an unknown state', { nodes: { a: node('a', { state: 'elsewhere' }) }, links: {} }, false],
  ['a link with no target', { nodes: { a: node('a') }, links: { l: { id: 'l', source: 'a' } } }, false],
  ['a non-object', 42, false],
]

console.log('schema and validator agree')
for (const [name, value, expected] of agreed) {
  const mine = validateField(value).valid
  const theirs = bySchema(value) as boolean
  check(
    `${name}: both say ${expected ? 'valid' : 'invalid'}`,
    mine === expected && theirs === expected,
    `validator=${mine} schema=${theirs}`,
  )
}

/** The validator must catch these; plain JSON Schema cannot express them. */
const beyondSchema: Array<[string, unknown]> = [
  ['a link to a node that is not in the field', { nodes: { a: node('a') }, links: { l: { id: 'l', source: 'a', target: 'ghost' } } }],
  ['a node keyed as something other than its id', { nodes: { a: node('b') }, links: {} }],
  ['a link keyed as something other than its id', { nodes: { a: node('a') }, links: { l: { id: 'other', source: 'a', target: 'a' } } }],
]

console.log('\nbeyond what the schema can express')
for (const [name, value] of beyondSchema) {
  const mine = validateField(value).valid
  const theirs = bySchema(value) as boolean
  check(`${name}: the validator rejects it`, mine === false)
  check(`${name}: the schema accepts it, as expected`, theirs === true, `schema=${theirs}`)
}

console.log('\nproblems are addressed to the producer')
const bad = validateField({ nodes: { a: node('a') }, links: { l: { id: 'l', source: 'a', target: 'ghost' } } })
check('a problem names the path in the payload', bad.problems[0]?.path === 'links.l.target', bad.problems[0]?.path)
check(
  'and says what was wrong in the producer’s terms',
  /is not a node in this field/.test(bad.problems[0]?.message ?? ''),
  bad.problems[0]?.message,
)
check('an invalid field hands back no field', bad.field === null)
check('a valid field hands the field back', validateField({ nodes: {}, links: {} }).field !== null)

console.log(failures === 0 ? '\nschema: all checks passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
