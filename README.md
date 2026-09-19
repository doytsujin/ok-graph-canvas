# Semantic Field Canvas

`@agent-scope-ca/graph-canvas` — a domain-neutral renderer for observable,
policy-aware systems.

It draws nodes, links, a metric, a state and a decision trace, and has no branch
that tests any of them for a particular value. Links carry an evidence envelope
rather than being mere connections; projections reinterpret one field along
different dimensions rather than producing different graphs; an unasserted value
stays distinct from zero; and refusal is a state, not an error.

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
`renderActions` render prop; colors arrive as props rather than being looked
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

### Styling

No CSS framework, and nothing to configure.

`FieldCanvas` and the shape stack need **no CSS at all** — they are SVG with
inline attributes. Give the element a height and it renders.

`TraceLanes` is a layout of boxes, so it carries one small stylesheet:

```js
import '@agent-scope-ca/graph-canvas/styles.css'
```

Color in both comes from `--gc-*` custom properties with light fallbacks, so a
host themes them — including a dark theme — without overriding the stylesheet:

```css
:root[data-theme='dark'] {
  --gc-fg: #f2efec;
  --gc-fg-muted: #a39a93;
  --gc-line: #332c28;
  --gc-surface: #1c1917;
  --gc-negative-line: #6b2233; --gc-negative-bg: #251318; --gc-negative-fg: #fda4af;
}
```

### Shapes are the host's vocabulary

`defaultShapeResolver` knows no vocabulary: it hashes `kind` so distinct kinds
get distinct, stable shapes. It used to carry an infrastructure vocabulary
(`pod`, `container`, `service`, `host`) and a set of platform roles. Both were
overridable and neither misbehaved, but a package claiming not to know what it is
drawing cannot ship a list of the things it knows. Bring your own:

```ts
const resolver: ShapeResolver = (node) =>
  node.kind === 'pod' ? 'hexagon' : node.kind === 'host' ? 'cylinder' : 'circle'
```

### Validate at the boundary

TypeScript checks the code that builds a field in your repository. It checks
nothing about a payload that arrived over HTTP from a service written in another
language, which is where malformed fields come from.

```ts
import { validateField } from '@agent-scope-ca/graph-canvas'

const result = validateField(await res.json())
if (!result.valid) {
  console.error(result.problems) // [{ path: 'links.l3.target', message: 'names "ghost", which is not a node in this field' }]
  return
}
render(result.field)
```

Problems name the path in the producer's own payload. The validator catches what
a schema cannot express — a link endpoint naming a node that is not in the
field, or a map key disagreeing with the id inside it.

`schema/semantic-field.schema.json` states the same contract for producers in
other languages, and `npm run check` requires the validator and the schema to
agree on every fixture, so they cannot drift apart silently.

`FieldCanvas` does **not** validate its props. Validation belongs at the
boundary, once, where the untrusted data arrives — not on every render.

### Operating range

Measured with `npm run bench` on one machine, so read the shape rather than the
absolute numbers. The force simulation dominates; the deterministic helpers
(projection context, scalars, collision radii, fit) are negligible beside it.

| nodes | links | helpers | force layout, 300 ticks |
|------:|------:|--------:|------------------------:|
| 100   | 160   | 0.5 ms  | 79 ms                   |
| 500   | 800   | 1.1 ms  | 515 ms                  |
| 1,000 | 1,600 | 1.1 ms  | 1,168 ms                |
| 5,000 | 8,000 | 7.4 ms  | 8,493 ms                |

So: comfortable to a few hundred nodes, usable at a thousand with a visible
settle, and at five thousand the layout takes seconds. **This is not a renderer
for 50,000-node graphs, and it is not trying to be.** Every node is an
inspectable SVG element, which is the point for a view meant to carry evidence,
and it is also the reason the ceiling is where it is. Above a few thousand nodes,
aggregate before rendering.

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
  showMaximizeControl
/>
```

### Camera controls

`showFitControl` (on by default) frames the whole field and re-engages auto-fit
after a manual zoom. `showMaximizeControl` (**off** by default) adds a Maximize
toggle beside it: the canvas becomes `position: fixed` over the viewport until
Escape or the same button dismisses it, and re-fits on the way in and out. The
layout does not move — the simulation is keyed on node, link and projection
identity, not on width and height — so maximizing changes the camera, not the
picture.

It is off by default because a component that can cover the host's whole page
should not acquire that ability through an upgrade. Two things a host owns:

- **A transformed ancestor breaks it.** `transform`, `filter`, `perspective`,
  `contain` or `will-change` on any ancestor makes that element the containing
  block for fixed positioning, so the expanded canvas fills *it* rather than the
  viewport. This is a CSS rule, not a choice this component can make.
- **Stacking.** The expanded canvas sits at `z-index: 9999`, which clears a
  sticky header and stays below a host modal that asks for more.

### Detail while expanded

Expanding covers the page, and it takes the host's inspector with it — typically
a panel under the canvas, now somewhere off-screen. Selection still works and
nothing shows the result, which is the one thing maximizing breaks.

`renderExpandedDetail={(node) => …}` closes that: the canvas anchors a popup to
the selected node, and the host renders what goes in it. Same arrangement as
`renderActions` — the canvas positions a translucent surface and knows nothing
about its contents, so the package stays free of any vocabulary. It renders only
while expanded, because in the page the host's own inspector is visible and two
of them would be one too many.

```tsx
<FieldCanvas
  showMaximizeControl
  renderExpandedDetail={(node) => <NodeDetail node={node} />}
/>
```

The popup sits beside the node and follows it through a pan or a zoom — its
position is derived from the zoom transform rather than stored — flipping to the
other side when it would cross the viewport edge and pinning itself inside when
neither side fits. Clicking the background clears the selection and closes it,
as does its own close button; clicking inside it does not. Give the same
component to the panel and to this, or the two drift and a reader who maximized
the canvas is quietly told less.

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

## License

Apache-2.0. The shape stack is ported from
[`weaveworks-ui-components`](https://github.com/weaveworks/ui-components),
also Apache-2.0; `NOTICE` records which files are derived and how they were
modified.

Contributions take a DCO sign-off and no CLA — see `CONTRIBUTING.md`.
