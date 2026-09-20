/**
 * The force simulation in Rust, loaded if it is there and skipped if it is not.
 *
 * Measured on this machine, 400 ticks, three links per node:
 *
 * | nodes | d3-force | rust/wasm |        |
 * |-------|----------|-----------|--------|
 * | 133   | 161 ms   | 45 ms     | 3.6x   |
 * | 300   | 418 ms   | 208 ms    | 2.0x   |
 * | 500   | 746 ms   | 574 ms    | 1.3x   |
 * | 1000  | 1687 ms  | 2222 ms   | 0.8x   |
 *
 * The last row is why `WASM_MAX_NODES` exists. The Rust sums every pair
 * exactly where d3 walks a Barnes-Hut quadtree, which is faster and more
 * accurate until the quadratic term catches up — at a thousand nodes d3 wins,
 * so above the threshold the JavaScript path is used and nothing regresses.
 * Raising the threshold means teaching the Rust a quadtree, not tuning a
 * number.
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
export const WASM_MAX_NODES = 600

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
