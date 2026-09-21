# TODO

What is built, what is deliberately not, and what happens next.
See [`README.md`](README.md) for the API and the measured numbers.

## Resume here

**State 2026-09-20. 0.7.0 is the SVG renderer.** The layout is in Rust and compiled to WebAssembly, with Barnes-Hut and a collision grid, so it wins against d3-force at every size worth caring about. The drawing is SVG and stays SVG: every node is an inspectable element, which is the point for a view meant to carry evidence and also the reason the ceiling is where it is.

## 1. Known gaps, deliberate

- **~4,900 SVG elements for a 133-node, 406-link field.** That is the shape of the trade and it is not going to get much cheaper — a DOM element per node is what buys `renderActions`, `renderApproval`, `renderExpandedDetail` and hit-testing the host did not have to write. Above a few thousand nodes, aggregate before rendering rather than expecting this to scale.
- **The force layout dominates everything else.** The deterministic helpers — projection context, scalars, collision radii, fit — are negligible beside it. `npm run bench` prints the table in the README; re-run it rather than trusting the numbers after any change to `rust/field-layout`.

## 2. Release

Publishing runs from a maintainer's machine — `npm run release`, guards in [`scripts/release.sh`](scripts/release.sh). The publish workflow is gone; a `v*` tag is a marker and triggers nothing. See [`RELEASING.md`](RELEASING.md).

- [ ] **Packages carry no provenance.** That went with the workflow and cannot be reproduced off CI: the attestation signs a CI identity, and there is not one here. Restoring it means configuring the trusted publisher on npmjs.com (GitHub Actions / `doytsujin` / `ok-graph-canvas` / no environment) and bringing the workflow back out of the history.
- [ ] **A write-capable npm token now lives on a machine indefinitely**, because it is the mechanism rather than a bootstrap step. `~/.npmjs_key` should stay at mode 600 and is worth rotating on a schedule.

## Traps worth not rediscovering

- **`wasm-pack` writes a `.gitignore` containing `*` into its `--out-dir` on every run**, and npm honors `.gitignore` when there is no `.npmignore`, so `src/wasm` silently vanishes from the tarball. Git keeps the files because they are already tracked, which is what hides it. `npm run build:wasm` deletes it; check a `npm pack --dry-run` listing, not `git status`.
- **Headless Chrome under `--virtual-time-budget` cannot be trusted with a clock.** rAF-based timings are artifacts. Counting renders, counting DOM elements, reading computed styles and screenshots are all reliable.
