# Releasing

Publishes run from GitHub Actions with **trusted publishing**: GitHub mints a
short-lived OIDC token for `.github/workflows/publish.yml`, npm verifies it
against the trusted publisher configured for this package, and no long-lived
token exists in the repository, in a secret, or on anyone's laptop. npm attaches
a provenance attestation automatically.

## Cutting a release

```
# bump the version in package.json, commit it, then
git tag v0.1.1
git push origin v0.1.1
```

The workflow installs, runs `npm run check`, builds, refuses if the tag and
`package.json` disagree, and publishes.

## The first publish is different, and this is not a mistake

npm has no equivalent of PyPI's *pending publishers*. The trusted-publisher
setting lives on the package's settings page on npmjs.com, and that page does
not exist until the package does — so the very first version cannot be published
by OIDC. See [npm/cli#8544](https://github.com/npm/cli/issues/8544).

The sequence is therefore:

1. **Publish `0.1.0` once with a token.** A granular access token with *write*
   access to the `@agent-scope-ca` scope and **Bypass 2FA** enabled, or an
   interactive `npm publish --otp=<code>`. A read-only granular token is not
   enough: the registry answers `403 … Two-factor authentication or granular
   access token with bypass 2fa enabled is required to publish packages`.
2. **Configure the trusted publisher** at npmjs.com → the package → Settings →
   Trusted Publisher:

   | field | value |
   |---|---|
   | Provider | GitHub Actions |
   | Organization or user | `doytsujin` |
   | Repository | `ok-graph-canvas` |
   | Workflow filename | `publish.yml` |
   | Environment | *(leave empty)* |

3. **Revoke the bootstrap token.** It has done its only job, and a write token
   that outlives its purpose is the thing trusted publishing exists to remove.

From then on a tag is the whole release process.

## Toolchain versions are load-bearing

Trusted publishing needs **npm ≥ 11.5.1** and **Node ≥ 22.14.0**. `setup-node`
with `node-version: 22` still ships npm 10.x, which fails with an authentication
error rather than a version error — which reads as a misconfigured publisher and
sends you looking in the wrong place. The workflow upgrades npm explicitly and
prints both versions before publishing.
