/**
 * The force simulation in Rust, loaded if it is there and skipped if it is not.
 *
 * Measured on this machine: both engines warmed, five timed runs each,
 * medians, alternating order. 400 ticks, three links per node.
 *
 * | nodes | d3-force | rust/wasm |       | overlapping pairs d3 / rust |
 * |-------|----------|-----------|-------|------------------------------|
 * | 133   | 134 ms   | 21 ms     | 6.54x | 0 / 0                        |
 * | 300   | 392 ms   | 67 ms     | 5.90x | 0 / 0                        |
 * | 500   | 743 ms   | 129 ms    | 5.75x | 0 / 0                        |
 * | 1000  | 1767 ms  | 316 ms    | 5.59x | 2 / 0                        |
 * | 1500  | 2994 ms  | 518 ms    | 5.78x | 147 / 13                     |
 * | 2500  | 5719 ms  | 948 ms    | 6.04x | 1402 / 741                   |
 *
 * The ratio is flat because both are now n log n and Rust's constant is the
 * smaller one. An earlier version summed every pair instead: it beat d3 below
 * a thousand nodes and lost above, which looked like an anomaly and was not —
 * time over n squared was constant to within two percent, the signature of a
 * quadratic. The fix was a quadtree, not a threshold.
 *
 * The last column is the layout quality that matters, since a field whose
 * nodes sit on each other is unusable however fast it was produced. Rust
 * leaves fewer overlaps than d3 at every size.
 *
 * Loading is best-effort. A host whose bundler cannot serve the `.wasm`, or a
 * runtime without WebAssembly, gets the JavaScript path and no error.
 */
export interface WasmSim {
  Simulation: new () => {
    set_nodes(
      x: Float64Array, y: Float64Array, radius: Float64Array, charge: Float64Array,
      tx: Float64Array, txK: Float64Array, ty: Float64Array, tyK: Float64Array,
    ): void
    set_links(src: Uint32Array, tgt: Uint32Array, dist: Float64Array, strength: Float64Array): void
    tick(steps: number, alphaStart: number, alphaDecay: number): void
    xs(): Float64Array
    ys(): Float64Array
    free(): void
  }
}

/**
 * No ceiling any more.
 *
 * This existed because the exact pairwise sum lost to d3 above about a
 * thousand nodes. With the quadtree there is no size at which the JavaScript
 * path is the better one, so there is nothing to fall back *for* — the
 * fallback that remains is for a runtime without WebAssembly, which is a
 * different question.
 */
export const WASM_MAX_NODES = Number.POSITIVE_INFINITY

let mod: WasmSim | null = null
let tried = false
const waiters = new Set<() => void>()

/** Resolved module, or null while it is loading or if it never arrives. */
export function wasmSim(): WasmSim | null {
  if (!tried) {
    tried = true
    // Vite and webpack both understand this shape; a bundler that does not
    // simply fails the import and the JavaScript path is used.
    import('../wasm/field_layout.js')
      .then(async (m: any) => {
        await m.default()
        mod = m as WasmSim
        waiters.forEach((f) => f())
        waiters.clear()
      })
      .catch(() => {
        mod = null
      })
  }
  return mod
}

/** Called once when the module lands, so a layout computed in JavaScript can be redone. */
export function onWasmReady(f: () => void): () => void {
  if (mod) return () => {}
  waiters.add(f)
  return () => waiters.delete(f)
}
