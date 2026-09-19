import { useMemo } from 'react'
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

const TONE_CLASS: Record<string, string> = {
  positive: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  negative: 'border-rose-300 bg-rose-50 text-rose-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  neutral: 'border-slate-300 bg-slate-50 text-slate-700',
}

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
      <header className="px-3 py-2 border-b border-slate-200 flex items-center gap-3 flex-wrap">
        <div className="text-sm font-medium text-slate-800">Decision trace</div>
        <label className="text-[11px] text-slate-500 flex items-center gap-1">
          ordered by
          <select
            value={order}
            onChange={(e) => onOrderChange?.(e.target.value as TraceOrdering)}
            disabled={!onOrderChange}
            className="text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white"
          >
            {orderings.map((o) => (
              <option key={o} value={o}>
                {ORDER_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        {trace.meta?.truncated && (
          <span className="text-[11px] text-amber-700">
            truncated — older records are not shown
          </span>
        )}
        {trace.meta?.source && (
          <span className="text-[11px] text-slate-400 ml-auto">{trace.meta.source}</span>
        )}
      </header>

      {gaps.length > 0 && (
        <div className="mx-3 mt-3 p-2 rounded border border-rose-300 bg-rose-50 text-[12px] text-rose-900">
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
            <div key={lane.id} className="flex items-stretch border-b border-slate-100 last:border-b-0">
              <div className="w-40 flex-shrink-0 py-2 pr-3">
                <div className="text-[12px] font-medium text-slate-700">{lane.label}</div>
                {lane.description && (
                  <div className="text-[10px] text-slate-400 leading-tight">
                    {lane.description}
                  </div>
                )}
                {records.length === 0 && (
                  // A lane nobody produced is not an empty lane, and saying so
                  // costs one line.
                  <div className="text-[10px] text-slate-400 italic mt-1">nothing recorded</div>
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
                      style={{ gridColumn: column + 1 }}
                      className={`text-left rounded border px-2 py-1 cursor-pointer ${
                        TONE_CLASS[r.tone ?? 'neutral'] ?? TONE_CLASS.neutral
                      } ${selectedId === r.id ? 'ring-2 ring-slate-400' : ''}`}
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

      <footer className="px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 flex gap-4 flex-wrap">
        <span>{trace.records.length} records</span>
        <span>{edges.length} declared causal links</span>
        {dangling.length > 0 && (
          <span className="text-amber-700">
            {dangling.length} cause{dangling.length === 1 ? '' : 's'} outside this window
          </span>
        )}
        {missing.length > 0 && (
          <span className="text-slate-500">
            {missing.length} record{missing.length === 1 ? '' : 's'} carry no{' '}
            {ORDER_LABEL[order]}
          </span>
        )}
      </footer>
    </div>
  )
}
