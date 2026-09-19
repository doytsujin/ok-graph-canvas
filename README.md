# `@agent-scope-ca/graph-canvas`

The Semantic Field canvas, extracted from the Agent Scope topology view so
that the same renderer can back more than one consumer.

Three things live here:

1. **The shape stack** — `curvedUnitPolygonPath(n)` and the layered
   highlight → background → metric → shadow → border → anchor composition,
   ported from `weaveworks-ui-components/GraphNode`.
2. **The Semantic Link envelope** — links carry `policy_compat`, `trust`,
   `readiness`, `provenance`, `governance`, `relearning_pressure`,
   `confidence` and a `domain_extensions` escape hatch, and the renderer
   encodes those into stroke, dash, hue and opacity.
   (The host platform's architecture notes define this as the *Semantic Link
   envelope* extension point.)
3. **The projection registry** — the same node set laid out along different
   control-plane dimensions. A *registry*, not an enum, because profiles are
   expected to contribute projections at runtime — the host platform's
   architecture notes call for "a runtime registry, not an enum".

## What this package does not know about

Nothing here is Kubernetes-shaped, and nothing imports from the host app.
`FieldNode.kind` is an open string; per-node action affordances arrive via a
`renderActions` render prop; colours arrive as props rather than being looked
up from a namespace theme. That is what lets a second consumer adopt it
without inheriting a Kubernetes vocabulary.

## Install

```
npm install @agent-scope-ca/graph-canvas
```

Peer dependencies, none of which this package bundles: `react` 18+,
`@react-spring/web` 9+, `d3-force`, `d3-selection`, `d3-shape`, `d3-zoom` and
`lodash-es`. They are peers rather than dependencies so an application ships one
copy of each rather than two.

The build is ESM with type declarations. `src/` ships in the tarball as well, so
a stack trace lands somewhere readable.

### Styling, which differs by component

`FieldCanvas` and the shape stack need **no CSS at all** — they are SVG with
inline attributes, and colours arrive as props. Give the element a height and it
renders.

`TraceLanes` is the exception and it is worth knowing before you import it: it is
styled with **Tailwind utility classes** and ships no stylesheet. Without Tailwind
in the host — and with a `content` glob that reaches this package's source, or
the classes are purged — it renders as unstyled text. That is a rough edge, not a
design: the canvas is dependency-free and the trace view should be too.

## Usage

```tsx
import {
  FieldCanvas,
  ProjectionRegistry,
  builtinProjections,
  type SemanticField,
} from '@agent-scope-ca/graph-canvas'

const registry = new ProjectionRegistry(builtinProjections)

<FieldCanvas
  field={field}
  registry={registry}
  projection="trust"
  selectedId={selectedId}
  onSelect={setSelectedId}
  colorForNode={(n) => themes[n.group ?? 'default'].borderColor}
  renderActions={(node) => <NodeActions nodeId={node.id} />}
/>
```

## Built-in projections

The eight named in the host platform statement, §9.5:

| id | ranks nodes by |
|---|---|
| `similarity` | no rank — pure force, link weight = `confidence` |
| `governance` | governance inheritance depth; links filtered to governed-by |
| `trust` | mean incident-link `trust` |
| `readiness` | mean incident-link `readiness` |
| `provenance` | lineage depth along provenance links |
| `workflow` | topological depth along workflow links |
| `relearning_pressure` | mean incident-link `relearning_pressure` |
| `risk` | `1 − min(trust, policy_compat, readiness)` |

Each returns the same node set with a different anchor scheme and a different
participating link set, which is the acceptance criterion the host platform
sets for them.

## Author

Built by **Alexander Chernov** — [chernov.ca](https://chernov.ca) ·
[github.com/doytsujin](https://github.com/doytsujin) ·
[ORCID 0009-0007-3198-2712](https://orcid.org/0009-0007-3198-2712)

## Licence

Apache-2.0. The shape stack is ported from
[`weaveworks-ui-components`](https://github.com/weaveworks/ui-components),
also Apache-2.0; `NOTICE` records which files are derived and how they were
modified.

Contributions take a DCO sign-off and no CLA — see `CONTRIBUTING.md`.
