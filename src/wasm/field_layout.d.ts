/* tslint:disable */
/* eslint-disable */

export class Simulation {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    /**
     * Set the links and derive each one's bias from the degrees of its ends,
     * exactly as `forceLink.initialize` does.
     */
    set_links(src: Uint32Array, tgt: Uint32Array, dist: Float64Array, strength: Float64Array): void;
    /**
     * Seed the bodies. Every slice is parallel and the same length.
     */
    set_nodes(x: Float64Array, y: Float64Array, radius: Float64Array, charge: Float64Array, tx: Float64Array, tx_k: Float64Array, ty: Float64Array, ty_k: Float64Array): void;
    /**
     * Advance the simulation. One call, not one per tick.
     */
    tick(steps: number, alpha_start: number, alpha_decay: number): void;
    xs(): Float64Array;
    ys(): Float64Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_simulation_free: (a: number, b: number) => void;
    readonly simulation_new: () => number;
    readonly simulation_set_links: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly simulation_set_nodes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => void;
    readonly simulation_tick: (a: number, b: number, c: number, d: number) => void;
    readonly simulation_xs: (a: number) => [number, number];
    readonly simulation_ys: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
