import { useMemo, useState } from 'react'
import {
  FieldCanvas,
  TraceLanes,
  builtinProjections,
  defaultRegistry,
  filterField,
  type FieldNode,
  type TraceOrdering,
  type TraceRecord,
} from '@agent-scope-ca/graph-canvas'
import { colorForNode, harborField, harborShapeResolver, harborTrace } from './harbor'

const registry = defaultRegistry()

type Choice = 'light' | 'dark' | 'system'

function readChoice(): Choice {
  try {
    const t = localStorage.getItem('theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

/**
 * Three states, not a switch. A two-state toggle cannot express "follow the
 * system", so picking it once would pin the page to whatever the OS said at
 * that moment -- and a reader who later switches their machine to dark would
 * find this page still light with no way to say why.
 */
function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>(readChoice)

  const apply = (next: Choice) => {
    setChoice(next)
    const root = document.documentElement
    if (next === 'system') delete root.dataset.theme
    else root.dataset.theme = next
    try {
      if (next === 'system') localStorage.removeItem('theme')
      else localStorage.setItem('theme', next)
    } catch {
      // A private window or blocked storage still gets the theme it asked for
      // for this visit; only the memory of it is lost.
    }
  }

  return (
    <div className="theme" role="group" aria-label="Color scheme">
      {(['light', 'dark', 'system'] as Choice[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={choice === c}
          className={choice === c ? 'on' : undefined}
          onClick={() => apply(c)}
        >
          {c[0].toUpperCase() + c.slice(1)}
        </button>
      ))}
    </div>
  )
}
const ORDERINGS: TraceOrdering[] = ['timestamp', 'observed_at', 'revision']

export default function App() {
  const [projection, setProjection] = useState('similarity')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settled, setSettled] = useState(true)
  const [order, setOrder] = useState<TraceOrdering>('timestamp')
  const [record, setRecord] = useState<TraceRecord | null>(null)

  const result = useMemo(() => filterField(harborField, query), [query])
  const selected: FieldNode | null = selectedId ? (result.field.nodes[selectedId] ?? null) : null

  return (
    <>
      <header className="page-header">
        <div className="wrap">
          <div className="topbar">
            <p className="eyebrow">Apache-2.0 · React · SVG</p>
            <ThemeToggle />
          </div>
          <h1>Semantic Field Canvas</h1>
          <p className="tagline">A domain-neutral renderer for observable, policy-aware systems.</p>
          <p className="lede">
            It renders nodes, links, a metric, a state and a decision trace, and has no branch that
            tests any of them for a particular value — the build fails if domain vocabulary appears
            anywhere in the source. Links carry an evidence envelope rather than being mere
            connections, projections reinterpret one field along different dimensions instead of
            producing different graphs, an unasserted value stays distinct from zero, and refusal is
            a state rather than an error.
          </p>
          <pre className="install"><code>npm install @agent-scope-ca/graph-canvas</code></pre>
          <p className="links">
            <a href="https://github.com/doytsujin/ok-graph-canvas">Source</a>
            <a href="https://www.npmjs.com/package/@agent-scope-ca/graph-canvas">npm</a>
            <a href="https://github.com/doytsujin/ok-graph-canvas/blob/main/README.md">README</a>
            <a href="https://github.com/doytsujin/ok-graph-canvas/blob/main/NOTICE">Attribution</a>
          </p>
          <p className="byline">
            Built by <a href="https://chernov.ca">Alexander Chernov</a>
          </p>
        </div>
      </header>

      <main className="wrap">
        <section>
          <h2>A field, projected</h2>
          <p>
            Everything below is an invented domain — a harbor issuing berth permits. It has to be
            invented: the renderer is vocabulary-free by construction, so an example borrowed from a
            real system would quietly argue the opposite of the design. The harbor supplies its own
            shapes and colors through props; the canvas looks nothing up.
          </p>

          <div className="controls">
            <label>
              <span>Projection</span>
              <select value={projection} onChange={(e) => setProjection(e.target.value)}>
                {builtinProjections.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Filter</span>
              <input
                type="search"
                value={query}
                placeholder="berth, vessel, survey…"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settled}
                onChange={(e) => setSettled(e.target.checked)}
              />
              <span>Settle before first paint</span>
            </label>
          </div>

          <p className="readout">
            {result.filtered
              ? `${result.matched} of ${result.total} nodes match. A link survives only when both of its ends do.`
              : `${result.total} nodes, ${Object.keys(result.field.links).length} links.`}
          </p>

          <div className="canvas">
            <FieldCanvas
              field={result.field}
              projection={projection}
              registry={registry}
              selectedId={selectedId}
              onSelect={setSelectedId}
              colorForNode={colorForNode}
              shapeResolver={harborShapeResolver}
              settle={settled ? 300 : 0}
              className="field"
              showFitControl
            />
          </div>

          <div className="inspector">
            {selected ? (
              <>
                <h3>{selected.label}</h3>
                <dl>
                  <div><dt>kind</dt><dd>{selected.kind}</dd></div>
                  <div><dt>group</dt><dd>{selected.group ?? '—'}</dd></div>
                  <div><dt>state</dt><dd>{selected.state ?? '—'}</dd></div>
                  <div>
                    <dt>metric</dt>
                    <dd>
                      {selected.metric?.value == null
                        ? 'not asserted'
                        : (selected.metric.formatted ?? selected.metric.value.toFixed(2))}
                    </dd>
                  </div>
                </dl>
                {selected.descriptor ? (
                  <pre><code>{JSON.stringify(selected.descriptor, null, 2)}</code></pre>
                ) : null}
              </>
            ) : (
              <p className="muted">Select a node. Selection hands over an identity, never a payload.</p>
            )}
          </div>
        </section>

        <section>
          <h2>Absence is reported, never implied</h2>
          <p>
            Every scalar on a link envelope is optional, and <code>undefined</code> is not{' '}
            <code>0</code>. An unasserted value leaves its visual channel neutral rather than
            pinning it to the minimum, because a link nobody has assessed and a link assessed as
            untrustworthy are different claims and must not draw the same. Two links in the field
            above carry no envelope at all; switch to <em>Trust</em> or <em>Readiness</em> and watch
            what happens to them, and to the berth whose readiness was never stated.
          </p>
        </section>

        <section>
          <h2>The decision trace</h2>
          <p>
            The same harbor as a causal record: a permit granted, suspended when the survey came
            back, invalidating what relied on it, then restored. Three rules the contract enforces,
            all visible here.
          </p>
          <ul className="rules">
            <li>
              <strong>Adjacency is not causality.</strong> A connector is drawn only where the
              producer declared <code>caused_by</code> or <code>responds_to</code>. Records that
              merely sit next to each other stay unconnected.
            </li>
            <li>
              <strong>Time is not one dimension.</strong> <code>order</code> is a required prop with
              no default. Switch it below: two records were observed long after they happened, and
              a view that quietly sorted by wall-clock would hide exactly that.
            </li>
            <li>
              <strong>A self-reference is an identity, not an edge.</strong> Following a reference is
              uniform because a record may reference itself; read as causality it would loop.
            </li>
          </ul>

          <p className="note">
            The components need no CSS framework. FieldCanvas is SVG and needs no CSS at all; the
            trace view below carries one small stylesheet you import once. Color in both comes from
            CSS custom properties, which is how this page themes them light and dark.
          </p>

          <div className="canvas trace">
            <TraceLanes
              trace={harborTrace}
              order={order}
              orderings={ORDERINGS}
              onOrderChange={setOrder}
              selectedId={record?.id ?? null}
              onSelect={setRecord}
            />
          </div>

          {record ? (
            <div className="inspector">
              <h3>{record.kind}</h3>
              <dl>
                <div><dt>subject</dt><dd>{record.subject ?? '—'}</dd></div>
                <div><dt>source</dt><dd>{record.source ?? '—'}</dd></div>
                <div>
                  <dt>state</dt>
                  <dd>{record.state_before ? `${record.state_before} → ` : ''}{record.state_after ?? '—'}</dd>
                </div>
                <div>
                  <dt>caused by</dt>
                  <dd>{record.caused_by?.join(', ') ?? 'nothing declared'}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </section>

        <section>
          <h2>What it will not do</h2>
          <p>
            The package ships a check that fails the build if domain vocabulary appears anywhere
            under <code>src/</code>, and the sweep walks the whole tree rather than a list someone
            has to remember to extend. The decision trace&rsquo;s own test fixture is an invented
            domain for the same reason — a fixture is the easiest place for a real one to hide.
          </p>
          <p>
            It draws no edge a producer did not declare, picks no ordering dimension for you, and
            reports a cause that fell outside the window rather than dropping it.
          </p>
        </section>
      </main>

      <footer className="page-footer">
        <div className="wrap">
          <h2 className="footer-h">Who made this</h2>
          <p>
            <strong>Alexander Chernov</strong> — a data and platform engineer working on the control
            planes behind regulated science: the systems that decide what may be executed, and what a
            computed result must carry before anyone may act on it. This renderer came out of that
            work, which is why it insists on drawing only what a producer actually declared.
          </p>
          <p className="author-links">
            <a href="https://chernov.ca">chernov.ca</a>
            <a href="https://github.com/doytsujin">github.com/doytsujin</a>
            <a href="https://orcid.org/0009-0007-3198-2712">ORCID 0009-0007-3198-2712</a>
          </p>
          <p>
            &copy; 2026 Alexander Chernov. Apache-2.0. The shape stack is ported from{' '}
            <a href="https://github.com/weaveworks/ui-components">weaveworks-ui-components</a>, also
            Apache-2.0; <a href="https://github.com/doytsujin/ok-graph-canvas/blob/main/NOTICE">NOTICE</a>{' '}
            records which files are derived and how they were modified.
          </p>
          <p>Contributions take a DCO sign-off and no CLA. There is no closed edition.</p>
        </div>
      </footer>
    </>
  )
}
