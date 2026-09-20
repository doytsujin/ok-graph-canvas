# TODO

What is built, what is deliberately not, and what happens next.
See [`README.md`](README.md) for the API and the measured numbers.

## Resume here

**State 2026-09-20. 0.6.0 is published. Performance is solved; the look is
not.** The WebGL renderer draws a 133-node, 406-link field in 7 DOM elements
against the SVG renderer's 4,957, and it is fast enough to use. It does not
yet look like the SVG renderer, and the two drawing the same field should not
look like two products.

## 1. Visual parity for `FieldCanvasGL` — the open work

All of it is in the fragment shader in
[`src/gl/NodePolygonProgram.ts`](src/gl/NodePolygonProgram.ts) unless noted.

- [ ] **The shape should be the node, not a glyph inside a disc.** This is the
  big one and the reason the GL field reads as a different product: every node
  currently has a circular silhouette, because the shader draws a white disc
  with a faint ring and then a smaller polygon *outline* inside it. The SVG
  renderer makes the polygon itself the node — full size, white fill, coloured
  border. Fill the polygon and stroke its border; drop the disc.
- [ ] **Metric fill.** `BaseShape` clips a coloured band into the shape from
  the bottom at `1 - 2 * metric.value`, so a node carries its metric in its
  own body. The shader has no equivalent, so metrics are invisible in GL.
- [ ] **Selection halo.** `BaseShape` draws a double ring when a node is
  selected or linked. GL currently signals selection only by size, which is
  weaker at a distance and disappears when the field is zoomed out.
- [ ] **`cloud`, `cylinder` and `sheet` have no regular-polygon form** and
  draw as circles. A signed-distance function per shape would fix it; three
  more SDFs is the whole job. Until then those three kinds are
  indistinguishable from `circle`, which is a real loss of information.

## 2. Known gaps, deliberate

- **No per-node React affordances in GL** — no hover actions, no approval
  control, no captions with their own layout engine. `renderActions`,
  `renderApproval` and `renderExpandedDetail` are `FieldCanvas` only. This is
  the trade the GL renderer makes and the reason it sits beside the SVG one
  rather than replacing it.
- **The SVG renderer still emits ~4,900 elements** for that field. It is not
  going to get much cheaper; the answer for a large field is `/gl`.

## 3. Release

- [ ] **Configure the trusted publisher on npmjs.com** (GitHub Actions /
  `doytsujin` / `ok-graph-canvas` / `publish.yml` / no environment). Five
  releases have now gone out on the bootstrap token and every `v*` tag leaves
  a failed CI run behind it, because OIDC mints a token npm does not
  recognise and answers `404` on `PUT`. See [`RELEASING.md`](RELEASING.md).
- [ ] **Revoke the bootstrap token** once that is done. `~/.npmjs_key` is
  still live and world-readable.

## Traps worth not rediscovering

- **`wasm-pack` writes a `.gitignore` containing `*` into its `--out-dir` on
  every run**, and npm honours `.gitignore` when there is no `.npmignore`, so
  `src/wasm` silently vanishes from the tarball. Git keeps the files because
  they are already tracked, which is what hides it. `npm run build:wasm`
  deletes it; check a `npm pack --dry-run` listing, not `git status`.
- **Sigma's WebGL colour parser reads neither `hsl()` nor `rgba()`.**
  `encodeLink` returns `hsl(...)` for policy compatibility, and every
  policy-coloured link rendered black until that was converted to hex. A
  browser parses both, which is why the SVG renderer never noticed.
- **Sigma's edge `size` is not an SVG stroke width.** The same number is
  several times heavier.
- **Headless Chrome under `--virtual-time-budget` cannot be trusted with a
  clock.** rAF-based timings are artefacts. Counting renders, counting DOM
  elements, reading computed styles and screenshots are all reliable.
