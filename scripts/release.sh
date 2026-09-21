#!/usr/bin/env bash
#
# Publish from this machine.
#
# Releases used to run in GitHub Actions under trusted publishing, which is the
# better arrangement and is not the one in use: the trusted publisher was never
# configured, so every tag left a failed run behind it. Publishing happens here
# instead, with a token.
#
# The guards below are the ones the workflow enforced. They are the reason this
# is a script and not a bare `npm publish` -- dropping CI should cost the
# provenance attestation, which cannot be had outside Actions, and nothing else.
#
#   scripts/release.sh            # publish the version in package.json
#   scripts/release.sh --dry-run  # everything except the publish
set -euo pipefail

cd "$(dirname "$0")/.."

DRY=""
[ "${1:-}" = "--dry-run" ] && DRY=1

version="$(node -p 'require("./package.json").version')"
name="$(node -p 'require("./package.json").name')"

# A dirty tree publishes something that is in no commit, and the tarball is the
# only place it will ever have existed.
if [ -n "$(git status --porcelain)" ]; then
  echo "refusing: working tree is dirty" >&2
  exit 1
fi

# Publishing a version that is already on the registry fails anyway, but it
# fails after the build and with a less clear message.
if npm view "$name@$version" version >/dev/null 2>&1; then
  echo "refusing: $name@$version is already published" >&2
  exit 1
fi

# A tag that disagrees with package.json publishes a version nobody asked for,
# under a name that says otherwise.
tag="v$version"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  tagged="$(git rev-parse "refs/tags/$tag^{commit}")"
  head="$(git rev-parse HEAD)"
  if [ "$tagged" != "$head" ]; then
    echo "refusing: $tag points at $tagged, HEAD is $head" >&2
    exit 1
  fi
fi

echo "==> $name@$version"
npm run check
npm run build

if [ -n "$DRY" ]; then
  echo "==> dry run, not publishing"
  npm pack --dry-run
  exit 0
fi

# The token is read at call time and never written into .npmrc, so it does not
# end up in a file that outlives the command.
if [ ! -r "$HOME/.npmjs_key" ]; then
  echo "refusing: no token at ~/.npmjs_key" >&2
  exit 1
fi

NPM_CONFIG_//registry.npmjs.org/:_authToken="$(cat "$HOME/.npmjs_key")" npm publish
echo "==> published. Tag with: git tag -a $tag -m $version && git push origin $tag"
