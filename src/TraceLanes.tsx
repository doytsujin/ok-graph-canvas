import { useMemo, type CSSProperties } from 'react'
import {
  affectedBy,
  causalEdges,
  danglingCauses,
  laneDisagreements,
  laneRows,
  orderTrace,
  type DecisionTrace,
  type TraceOrdering,
  type TraceRecord,
} from './trace'

/**
 * The Decision Trace renderer: lanes over one named ordering dimension.
 *
 * Vocabulary-free, on the same terms as the canvas. Every string it displays —
 * lane labels, record kinds, states, sources — arrives from the producer, and
 * the component has no branch that tests any of them for a particular value.
 * Point it at a different profile and it renders that profile instead, with no
 * edit here.
 *
 * What it will not do is as much of the design as what it does:
 *
 * - **It draws no connector the producer did not declare.** Two records side by
 *   side are two records side by side. Causality comes from `caused_by` and
 *   `responds_to` or it is not drawn.
 * - **It never picks the ordering dimension for you.** `order` is a required
 *   prop, and the header says which one is in force, because a timeline that
 *   quietly sorts by wall-clock hides the case that matters most: the control
 *   plane observing something long after it happened.
 * - **It reports absence.** A cause scrolled off the window is named, not
 *   dropped. A record with no state shows nothing rather than a blank chip that
 *   reads like an empty state.
 * - **It puts lane disagreement at the top.** A subject two lanes describe
 *   differently is the failure mode this view exists for, and nobody should
 *   have to spot it by eye.
 */
export interface TraceLanesProps {
  trace: DecisionTrace
  /** Which dimension the lanes are laid out along. Deliberately required. */
  order: TraceOrdering
  onOrderChange?: (order: TraceOrdering) => void
  selectedId?: string | null
  onSelect?: (record: TraceRecord) => void
  /** Ordering dimensions offered in the header. */
  orderings?: TraceOrdering[]
  className?: string
}

/**
 * Colour comes from CSS custom properties with light-mode fallbacks, not from
 * utility classes. Two reasons, and the second is the one that bites.
 *
 * A host that sets the variables gets this component in its own palette,
 * including a dark one, with no Tailwind `dark:` variant and no configuration.
 * A host that sets nothing still gets a readable light component, because every
 * variable carries a fallback.
 *
 * The layout classes below are still Tailwind. Those are theme-independent, so
 * they do not have this problem -- but the component does still need Tailwind
 * for layout, which is a separate rough edge and is documented as one.
 */
const TONE_STYLE: Record<string, CSSProperties> = {
  positive: {
    borderColor: 'var(--gc-positive-line, #6ee7b7)',
    background: 'var(--gc-positive-bg, #ecfdf5)',
    color: 'var(--gc-positive-fg, #064e3b)',
  },
  negative: {
    borderColor: 'var(--gc-negative-line, #fda4af)',
    background: 'var(--gc-negative-bg, #fff1f2)',
    color: 'var(--gc-negative-fg, #881337)',
  },
  warning: {
    borderColor: 'var(--gc-warning-line, #fcd34d)',
    background: 'var(--gc-warning-bg, #fffbeb)',
    color: 'var(--gc-warning-fg, #78350f)',
  },
  neutral: {
    borderColor: 'var(--gc-neutral-line, #cbd5e1)',
    background: 'var(--gc-neutral-bg, #f8fafc)',
    color: 'var(--gc-neutral-fg, #334155)',
  },
}

const FG = 'var(--gc-fg, #1e293b)'
const MUTED = 'var(--gc-fg-muted, #64748b)'
const FAINT = 'var(--gc-fg-faint, #94a3b8)'
const LINE = 'var(--gc-line, #e2e8f0)'
const LINE_SOFT = 'var(--gc-line-soft, #f1f5f9)'
const SURFACE = 'var(--gc-surface, #ffffff)'
const WARN = 'var(--gc-warn, #b45309)'

const DEFAULT_ORDERINGS: TraceOrdering[] = ['timestamp', 'observed_at', 'revision', 'sequence']

/** Human labels for the dimensions, which are this component's own vocabulary. */
const ORDER_LABEL: Record<TraceOrdering, string> = {
  timestamp: 'when it happened',
  observed_at: 'when it was observed',
  revision: 'state version',
  sequence: 'producer order',
}

function coordinate(r: TraceRecord, by: TraceOrdering): number | undefined {
  return r[by] as number | undefined
}

export function TraceLanes({
  trace,
  order,
  onOrderChange,
  selectedId,
  onSelect,
  orderings = DEFAULT_ORDERINGS,
  className = '',
}: TraceLanesProps) {
  const rows = useMemo(() => laneRows(trace, order), [trace, order])
  const edges = useMemo(() => causalEdges(trace.records), [trace.records])
  const dangling = useMemo(() => danglingCauses(trace.records), [trace.records])
  const gaps = useMemo(() => laneDisagreements(trace.records, order), [trace.records, order])

  // Column positions: every record that carries the chosen dimension shares a
  // column with the records it ties with, and records missing it are collected
  // at the end rather than placed at zero.
  const { columns, missing } = useMemo(() => {
    const present = orderTrace(trace.records, order).filter(
      (r) => coordinate(r, order) !== undefined,
    )
    const keys = [...new Set(present.map((r) => coordinate(r, order) as number))]
    const index = new Map(keys.map((k, i) => [k, i]))
    return {
      columns: index,
      missing: trace.records.filter((r) => coordinate(r, order) === undefined),
    }
  }, [trace.records, order])

  const columnCount = Math.max(columns.size, 1)
  const byId = useMemo(
    () => new Map(trace.records.map((r) => [r.id, r])),
    [trace.records],
  )
  const laneLabel = (id: string) =>
    trace.lanes.find((l) => l.id === id)?.label ?? id

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <header
        className="px-3 py-2 border-b flex items-center gap-3 flex-wrap"
        style={{ borderColor: LINE }}
      >
        <div className="text-sm font-medium" style={{ color: FG }}>
          Decision trace
        </div>
        <label className="text-[11px] flex items-center gap-1" style={{ color: MUTED }}>
          ordered by
          <select
            value={order}
            onChange={(e) => onOrderChange?.(e.target.value as TraceOrdering)}
            disabled={!onOrderChange}
            className="text-[11px] border rounded px-1 py-0.5"
            style={{ borderColor: LINE, background: SURFACE, color: FG }}
          >
            {orderings.map((o) => (
              <option key={o} value={o}>
                {ORDER_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        {trace.meta?.truncated && (
          <span className="text-[11px]" style={{ color: WARN }}>
            truncated — older records are not shown
          </span>
        )}
        {trace.meta?.source && (
          <span className="text-[11px] ml-auto" style={{ color: FAINT }}>
            {trace.meta.source}
          </span>
        )}
      </header>

      {gaps.length > 0 && (
        <div
          className="mx-3 mt-3 p-2 rounded border text-[12px]"
          style={TONE_STYLE.negative}
        >
          <div className="font-medium">
            {gaps.length === 1 ? 'One subject is' : `${gaps.length} subjects are`} described
            differently by different lanes
          </div>
          {gaps.map((g) => (
            <div key={g.subject} className="mt-1.5">
              <div className="text-[11px] font-mono">{g.subject}</div>
              {/* Every lane that asserted, including the ones that agreed: that
                  two of three agree is itself diagnostic, and a renderer that
                  printed only the difference would throw it away. No lane is
                  named as being at fault — which lane is authoritative is a
                  profile's judgement, and the artifacts explain why. */}
              <table className="mt-0.5 text-[11px]">
                <tbody>
                  {g.states.map((s) => (
                    <tr key={s.lane}>
                      <td className="pr-3 opacity-70">{laneLabel(s.lane)}</td>
                      <td className="font-medium">{s.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0 p-3">
        <div className="min-w-max">
          {rows.map(({ lane, records }) => (
            <div
              key={lane.id}
              className="flex items-stretch border-b last:border-b-0"
              style={{ borderColor: LINE_SOFT }}
            >
              <div className="w-40 flex-shrink-0 py-2 pr-3">
                <div className="text-[12px] font-medium" style={{ color: FG }}>
                  {lane.label}
                </div>
                {lane.description && (
                  <div className="text-[10px] leading-tight" style={{ color: FAINT }}>
                    {lane.description}
                  </div>
                )}
                {records.length === 0 && (
                  // A lane nobody produced is not an empty lane, and saying so
                  // costs one line.
                  <div className="text-[10px] italic mt-1" style={{ color: FAINT }}>
                    nothing recorded
                  </div>
                )}
              </div>
              <div
                className="flex-1 grid gap-2 py-2"
                style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(9rem, 1fr))` }}
              >
                {records.map((r) => {
                  const at = coordinate(r, order)
                  const column = at === undefined ? undefined : columns.get(at)
                  if (column === undefined) return null
                  const causes = [...(r.caused_by ?? []), ...(r.responds_to ?? [])]
                  const affects = affectedBy(trace.records, r.id)
                  return (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect?.(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelect?.(r)
                        }
                      }}
                      style={{
                        gridColumn: column + 1,
                        ...(TONE_STYLE[r.tone ?? 'neutral'] ?? TONE_STYLE.neutral),
                        ...(selectedId === r.id
                          ? { outline: `2px solid ${FAINT}`, outlineOffset: '1px' }
                          : {}),
                      }}
                      className="text-left rounded border px-2 py-1 cursor-pointer"
                    >
                      <div className="text-[11px] font-medium truncate">{r.label ?? r.kind}</div>
                      {r.subject && (
                        <div className="text-[10px] font-mono opacity-70 truncate">{r.subject}</div>
                      )}
                      {r.state_after !== undefined && (
                        <div className="text-[10px] mt-0.5">
                          {r.state_before !== undefined && (
                            <span className="opacity-60">{r.state_before} → </span>
                          )}
                          <span className="font-medium">{r.state_after}</span>
                        </div>
                      )}
                      {r.source && (
                        <div className="text-[10px] opacity-60 truncate">{r.source}</div>
                      )}
                      {causes.length > 0 && (
                        <div className="text-[10px] opacity-70 mt-0.5">
                          {/* Named, never inferred. An id we do not hold is
                              labelled as outside the window rather than hidden,
                              and is not offered as something to click. */}
                          after{' '}
                          {causes.map((c, i) => {
                            const cause = byId.get(c)
                            return (
                              <span key={c}>
                                {i > 0 && ', '}
                                {cause ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onSelect?.(cause)
                                    }}
                                    className="underline underline-offset-2"
                                  >
                                    {cause.label ?? cause.kind}
                                  </button>
                                ) : (
                                  <span>{c} (not in view)</span>
                                )}
                              </span>
                            )
                          })}
                        </div>
                      )}
                      {affects.length > 0 && (
                        <div className="text-[10px] opacity-70 mt-0.5">
                          affected {affects.length} later record
                          {affects.length === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer
        className="px-3 py-1.5 border-t text-[10px] flex gap-4 flex-wrap"
        style={{ borderColor: LINE, color: MUTED }}
      >
        <span>{trace.records.length} records</span>
        <span>{edges.length} declared causal links</span>
        {dangling.length > 0 && (
          <span style={{ color: WARN }}>
            {dangling.length} cause{dangling.length === 1 ? '' : 's'} outside this window
          </span>
        )}
        {missing.length > 0 && (
          <span style={{ color: MUTED }}>
            {missing.length} record{missing.length === 1 ? '' : 's'} carry no{' '}
            {ORDER_LABEL[order]}
          </span>
        )}
      </footer>
    </div>
  )
}
