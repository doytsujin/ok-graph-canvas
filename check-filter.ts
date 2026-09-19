import { filterField } from './src/filterField'
import type { SemanticField } from './src/types'

// Three namespaces, three kinds, one link that crosses a kind boundary.
const field: SemanticField = {
  nodes: {
    'p-web':   { id: 'p-web',   label: 'web-7d9f',        kind: 'pod',        group: 'web' },
    'p-pay':   { id: 'p-pay',   label: 'payments-5b8c',   kind: 'pod',        group: 'payments' },
    'p-batch': { id: 'p-batch', label: 'batch-5888b9c8b6', kind: 'pod',       group: 'payments' },
    's-web':   { id: 's-web',   label: 'web',             kind: 'service',    group: 'web' },
    'd-web':   { id: 'd-web',   label: 'web',             kind: 'deployment', group: 'web' },
  },
  links: {
    'l-sp':  { id: 'l-sp',  source: 's-web', target: 'p-web' },   // service -> pod
    'l-dp':  { id: 'l-dp',  source: 'd-web', target: 'p-web' },   // deployment -> pod
    'l-pp':  { id: 'l-pp',  source: 'p-web', target: 'p-pay' },   // pod -> pod, crosses group
  },
}

let failures = 0
const check = (name: string, cond: boolean, detail: string) => {
  if (!cond) { failures++; console.log(`FAIL  ${name}: ${detail}`) }
  else console.log(`ok    ${name}`)
}

// --- no filter is not a filter -------------------------------------------
const none = filterField(field, '', null)
check('empty query returns every node', none.matched === 5, String(none.matched))
check('empty query is not reported as filtered', none.filtered === false, String(none.filtered))
check(
  'empty query returns the same object, so memoisation still holds',
  none.field === field,
  'a copy was made',
)

// --- free text ------------------------------------------------------------
const web = filterField(field, 'web', null)
check('query matches label, id and group', web.matched === 3, String(web.matched))
check('query reports filtered', web.filtered === true, String(web.filtered))
check('query is case-insensitive', filterField(field, 'WEB', null).matched === 3, 'case leaked')
check(
  'query matches a substring of a generated pod name',
  filterField(field, '5888', null).matched === 1,
  'substring missed',
)
check('a query matching nothing yields nothing', filterField(field, 'zzz', null).matched === 0, 'not empty')
check(
  'a query matching nothing is still reported as filtered, not as an empty cluster',
  filterField(field, 'zzz', null).filtered === true,
  'silently looked empty',
)

// --- kinds ----------------------------------------------------------------
const pods = filterField(field, '', ['pod'])
check('kind filter keeps only that kind', pods.matched === 3, String(pods.matched))
check(
  'an empty kind list means no kind filter, not "match nothing"',
  filterField(field, '', []).matched === 5,
  'empty list filtered everything out',
)

// --- both together --------------------------------------------------------
check(
  'query and kind filter compose',
  filterField(field, 'web', ['pod']).matched === 1,
  'composition wrong',
)

// --- links ----------------------------------------------------------------
// The rule that matters: a surviving link must have both ends on screen, or it
// draws an edge to nothing and asserts a relationship the reader cannot check.
check(
  'a link survives only when both endpoints do',
  Object.keys(pods.field.links).length === 1 && !!pods.field.links['l-pp'],
  Object.keys(pods.field.links).join(','),
)
check(
  'a link whose target was filtered away is dropped',
  !filterField(field, 'web', ['pod']).field.links['l-pp'],
  'dangling link survived',
)

// --- the input is never mutated ------------------------------------------
check('input node set is untouched', Object.keys(field.nodes).length === 5, 'input mutated')
check('input link set is untouched', Object.keys(field.links).length === 3, 'input mutated')

// --- totals report the whole field, not the filtered one ------------------
check('total reports the unfiltered size', web.total === 5, String(web.total))

// --- a null field is not a crash -----------------------------------------
const nul = filterField(null, 'web', ['pod'])
check('null field yields an empty field', nul.matched === 0 && nul.total === 0, 'threw or guessed')

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
