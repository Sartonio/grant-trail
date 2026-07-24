#!/usr/bin/env bash
#
# stack:gc — stop per-worktree Supabase stacks whose worktree no longer exists.
#
# Each worktree stack (see scripts/stack-env.sh) costs ~1 GB RAM while running,
# and nothing stops it when the worktree is removed. This walks every
# supabase_db_grant-trail-* container (worktree stacks only — the canonical
# "grant-trail" stack of the main checkout is never touched), resolves its
# worktree via the /tmp/grant-trail-stacks registry, and `supabase stop
# --no-backup`s stacks whose worktree path is gone. Stacks whose per-stack lock
# is currently held are skipped (a run is using them).
#
#   npm run stack:gc            # stop stacks of deleted worktrees
#   npm run stack:gc -- --all   # also stop UNREGISTERED worktree stacks
#                               # (registry lost, e.g. /tmp cleaned)
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REG_DIR="${SE_REGISTRY_DIR:-/tmp/grant-trail-stacks}"
ALL=0
[ "${1:-}" = "--all" ] && ALL=1

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker unavailable — nothing to gc." >&2
  exit 1
fi

lock_held() {
  # Probe without taking: held == flock -n fails.
  ! ( exec 9>>"/tmp/grant-trail-stack-$1.lock" && flock -n 9 ) 2>/dev/null
}

stop_stack() {
  local pid="$1"
  echo "==> stopping stack ${pid}"
  npx --prefix frontend supabase stop --project-id "$pid" --no-backup \
    || { echo "WARN: supabase stop failed for ${pid}" >&2; return 1; }
  rm -f "$REG_DIR/$pid" "/tmp/grant-trail-stack-$pid.lock" "/tmp/grant-trail-stack-$pid.lock.info"
}

stopped=0 kept=0 skipped=0
# -a: a crashed CLI can leave stopped containers behind; they still hold disk.
for name in $(docker ps -a --format '{{.Names}}' | grep '^supabase_db_grant-trail-' | sort -u); do
  pid="${name#supabase_db_}"
  reg="$REG_DIR/$pid"
  # Stacks created before ids were budgeted to 40 chars have a container name
  # the CLI truncated, so it no longer equals the registry filename — recover
  # the full id by prefix so those stacks stay collectable.
  if [ ! -f "$reg" ]; then
    for cand in "$REG_DIR/$pid"*; do
      [ -f "$cand" ] || continue
      reg="$cand"; pid="$(basename "$cand")"; break
    done
  fi
  path="$(sed -n 's/^path=//p' "$reg" 2>/dev/null | head -n1)"

  if lock_held "$pid"; then
    echo "--  ${pid}: lock HELD (a run is using it) — skipping"
    skipped=$((skipped + 1))
    continue
  fi

  if [ -n "$path" ] && [ -d "$path" ]; then
    echo "--  ${pid}: worktree exists (${path}) — keeping"
    kept=$((kept + 1))
  elif [ -n "$path" ]; then
    echo "--  ${pid}: worktree GONE (${path})"
    stop_stack "$pid" && stopped=$((stopped + 1))
  elif [ "$ALL" = 1 ]; then
    echo "--  ${pid}: not in the registry"
    stop_stack "$pid" && stopped=$((stopped + 1))
  else
    echo "--  ${pid}: not in the registry (worktree unknown) — keeping; use --all to stop"
    kept=$((kept + 1))
  fi
done

# Registry entries whose worktree AND containers are both gone are just litter.
for f in "$REG_DIR"/*; do
  [ -f "$f" ] || continue
  pid="$(basename "$f")"
  path="$(sed -n 's/^path=//p' "$f" 2>/dev/null | head -n1)"
  [ -d "$path" ] && continue
  docker ps -a --format '{{.Names}}' | grep -q "^supabase_db_${pid}\$" && continue
  rm -f "$f" "/tmp/grant-trail-stack-$pid.lock" "/tmp/grant-trail-stack-$pid.lock.info"
  echo "--  ${pid}: cleaned stale registry entry"
done

echo "==> stack:gc done — stopped ${stopped}, kept ${kept}, skipped (in use) ${skipped}"
