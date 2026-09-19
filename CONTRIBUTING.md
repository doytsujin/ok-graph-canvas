# Contributing

## Licence and sign-off

This project is Apache-2.0, and **inbound is outbound**: contributions are
accepted under the same licence the project ships under. There is no CLA and no
closed edition — that was decided on 2026-09-19 rather than left open, because a
contribution policy settled after the first pull request is settled by accident.

Sign off every commit under the [Developer Certificate of
Origin](https://developercertificate.org/):

```
git commit -s -m "..."
```

which appends `Signed-off-by: Your Name <you@example.com>`. The sign-off is you
stating you have the right to submit the work under Apache-2.0. Commits without
it will be asked for one before merge.

## What belongs in this package

The renderer, and nothing that knows a domain. This package draws nodes, links,
a metric, a state and a trace; it does not know what any of them mean. That is
not a style preference — it is enforced, and the build fails if it is violated:

- `npm run check:trace` rejects profile vocabulary anywhere under `src/`
- the same check rejects references to private repositories, in `src/` and in
  `README.md`

So a fixture, test, story or example must use invented vocabulary with no
meaning outside this repository. If a change needs the renderer to understand
what a node *is*, the change belongs in the consumer, not here.

## Attribution

The shape stack is ported from `weaveworks-ui-components/GraphNode` under
Apache-2.0. `NOTICE` records exactly which files are derived and how they were
modified. If you change one of those files, keep that record accurate — and if
you add a derived file, add it there.

## Before opening a pull request

```
npm run build        # library build + type declarations
npm run check:trace  # vocabulary and private-identifier sweep
```
