/**
 * The force simulation in Rust, loaded if it is there and skipped if it is not.
 *
 * Measured on this machine: both engines warmed first, five timed runs each,
 * medians, alternating which ran first. 400 ticks, three links per node.
 *
 * | nodes | d3-force | rust/wasm |       |
 * |-------|----------|-----------|-------|
 * | 133   | 127 ms   | 29 ms     | 4.43x |
 * | 300   | 375 ms   | 134 ms    | 2.80x |
 * | 500   | 705 ms   | 364 ms    | 1.94x |
 * | 700   | 1074 ms  | 717 ms    | 1.50x |
 * | 1000  | 1693 ms  | 1443 ms   | 1.17x |
 * | 1500  | 2900 ms  | 3295 ms   | 0.88x |
 *
 * The decline is not a cliff, it is the two complexities crossing. This sums
 * every pair exactly, which is quadratic; d3 walks a Barnes-Hut quadtree,
 * which is n log n. Rust's constant is far smaller, so it leads by a wide
 * margin at small n and the ratio decays roughly as 1/n until the quadratic
 * term catches up. Six points show that curve; an earlier four-point table
 * made the last row look like a sudden failure, and it was also measured
 * without warming either engine, which flattered d3's cold first call.
 *
 * `WASM_MAX_NODES` sits below the crossing. Raising it means teaching this a
 * quadtree, not tuning the number.
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

/** Above this, d3's quadtree beats an exact sum. See the table above. */
export const WASM_MAX_NODES = 1200

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
