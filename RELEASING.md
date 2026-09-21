# Releasing

Releases are published from a maintainer's machine with `npm run release`. There is no publish workflow; `scripts/release.sh` is the whole process.

```
# bump the version in package.json, commit it, then
npm run release --dry-run   # checks, build and a tarball listing, no publish
npm run release
git tag -a v0.7.1 -m 0.7.1 && git push origin v0.7.1
```

The tag is a marker after the fact, not the trigger. Nothing watches it.

## What the script refuses to do

These are the guards the old CI workflow enforced, kept because dropping CI should cost one thing and not several.

- **A dirty working tree.** Otherwise the tarball is the only place that code will ever have existed.
- **A version already on the registry.** `npm publish` fails on this anyway, but later and less clearly.
- **A tag that disagrees with `package.json`.** If `vX.Y.Z` exists and does not point at `HEAD`, the release stops. A tag that disagrees publishes a version nobody asked for under a name that says otherwise.

It then runs `npm run check` and `npm run build` before publishing, and reads the token from `~/.npmjs_key` at call time rather than writing it into an `.npmrc` that would outlive the command.

## What this arrangement gives up

**Provenance.** Trusted publishing mints a short-lived OIDC token inside GitHub Actions, and npm attaches a provenance attestation automatically — a signed statement of which repository and which workflow built the tarball. That cannot be reproduced from a laptop at any effort: it is the CI identity being attested, and there is not one here. Packages published this way carry no provenance, and consumers who check for it will not find it.

**The absence of a long-lived token.** A write-capable token now has to exist on a machine, indefinitely, because it is the mechanism rather than a bootstrap step. Keep `~/.npmjs_key` at mode 600.

Both were the reasons the workflow existed. If the trusted publisher is ever configured on npmjs.com — GitHub Actions / `doytsujin` / `ok-graph-canvas` / no environment — restoring it is worth doing, and the history has the file.

## Why trusted publishing was not in use

npm has no equivalent of PyPI's pending publishers. The trusted-publisher setting lives on the package's settings page, and that page does not exist until the package does, so the first version cannot be published by OIDC. See [npm/cli#8544](https://github.com/npm/cli/issues/8544). The bootstrap publish happened; the follow-up configuration never did, so every `v*` tag pushed a workflow run that minted a token npm did not recognize and answered `404` on `PUT`.

## Toolchain versions are load-bearing

Trusted publishing needs **npm ≥ 11.5.1** and **Node ≥ 22.14.0**. `setup-node`
with `node-version: 22` still ships npm 10.x, which fails with an authentication
error rather than a version error — which reads as a misconfigured publisher and
sends you looking in the wrong place. The workflow upgrades npm explicitly and
prints both versions before publishing.
