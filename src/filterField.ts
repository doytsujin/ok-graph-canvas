import type { SemanticField } from './types'

/**
 * Narrow a field to the nodes a person asked for.
 *
 * Two independent filters, both optional, applied together:
 *
 *   `query` — free text over the node's label, id, kind and group.
 *   `kinds` — restrict to a set of node kinds (the resource tabs).
 *
 * Links survive only when **both** endpoints survive. A link with one end
 * filtered away would draw as an edge to nothing, and a link drawn to a node
 * that is not on screen asserts a relationship the reader cannot check.
 *
 * The result is a new field; the input is never mutated. `filtered` says
 * whether anything was actually removed, so the caller can tell the reader a
 * filter is active rather than letting a short list read as a small cluster —
 * the same rule the coverage readout follows. `matched`/`total` are the counts
 * to report.
 */
export interface FilterResult {
  field: SemanticField
  /** True when any filter is active *and* it removed at least one node. */
  filtered: boolean
  /** Nodes surviving the filter. */
  matched: number
  /** Nodes before filtering. */
  total: number
}

export function filterField(
  field: SemanticField | null,
  query: string,
  kinds?: readonly string[] | null,
): FilterResult {
  if (!field) {
    return { field: { nodes: {}, links: {} }, filtered: false, matched: 0, total: 0 }
  }

  const total = Object.keys(field.nodes).length
  const q = query.trim().toLowerCase()
  const kindSet = kinds && kinds.length > 0 ? new Set(kinds) : null

  // Nothing asked for: return the input untouched rather than a copy, so
  // referential equality still holds for downstream memoisation.
  if (!q && !kindSet) {
    return { field, filtered: false, matched: total, total }
  }

  const nodes: SemanticField['nodes'] = {}
  for (const [id, node] of Object.entries(field.nodes)) {
    if (kindSet && !kindSet.has(node.kind)) continue
    if (q) {
      const haystack = [node.label, node.id, node.kind, node.group ?? '']
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) continue
    }
    nodes[id] = node
  }

  const links: SemanticField['links'] = {}
  for (const [id, link] of Object.entries(field.links)) {
    if (nodes[link.source] && nodes[link.target]) links[id] = link
  }

  const matched = Object.keys(nodes).length
  return {
    field: { ...field, nodes, links },
    filtered: matched !== total,
    matched,
    total,
  }
}
