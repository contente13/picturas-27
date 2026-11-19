#!/usr/bin/env bash
# RNF-FIAB-01, Phase 4, M11: R0 of the original (674709b) and fixed versions in the same
# session, interleaved in blocks (A B A B A B, 10 repetitions per block, 30 per version),
# so that machine load drifts affect both versions alike.
# Requires the baseline images (see compose.ab-baseline.yaml) and the stack running.
set -euo pipefail
cd "$(dirname "$0")"
REPO=../..
BASE=(podman compose -p picturas-fiab -f "$REPO/docker-compose.yaml" -f compose.fiab.yaml)
SERVICES=(projects border_tool brightness_tool rotate_tool)

use() {  # use baseline|final
  if [ "$1" = baseline ]; then
    "${BASE[@]}" -f compose.ab-baseline.yaml up -d --no-deps --no-build --force-recreate "${SERVICES[@]}"
  else
    "${BASE[@]}" up -d --no-deps --no-build --force-recreate "${SERVICES[@]}"
  fi
  # One unrecorded warm-up batch after each switch (cold start of the new containers).
  .venv/bin/python harness.py run --phase m11-warmup --pilot --scenario R0 --reps 1 --t-obs 120 >/dev/null
}

for block in 1 2 3; do
  first=$(( (block - 1) * 10 + 1 )); last=$(( block * 10 ))
  reps=$(seq -s, "$first" "$last")
  for version in baseline final; do
    use "$version"
    .venv/bin/python harness.py run --phase "m11-$version" --scenario R0 --only-reps "$reps" --t-obs 120
  done
done
.venv/bin/python harness.py summarize --phase m11-baseline >/dev/null
.venv/bin/python harness.py summarize --phase m11-final >/dev/null
use final
