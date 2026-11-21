#!/usr/bin/env bash
set -euo pipefail

remote=${1:?Missing Git remote}
packed=${2:?Missing pack directory}
dist=$(mktemp -d)
trap 'rm -rf "$dist"' EXIT

git init -q -b dist "$dist"
head=$(git ls-remote "$remote" refs/heads/dist)
if [[ -n "$head" ]]; then
    git -C "$dist" fetch --depth=1 "$remote" refs/heads/dist
    git -C "$dist" checkout -q --detach FETCH_HEAD
fi

node "$(dirname "$0")/stage-dist.cjs" "$packed" "$dist"
git -C "$dist" add -A -- .
if ! git -C "$dist" diff --cached --quiet; then
    git -C "$dist" -c user.name=semi-plugins -c user.email=semi-plugins@users.noreply.github.com commit -m 'Archive community plugin packages'
    git -C "$dist" push "$remote" HEAD:refs/heads/dist
fi
commit=$(git -C "$dist" rev-parse HEAD)
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'commit=%s\n' "$commit" >> "$GITHUB_OUTPUT"
fi
