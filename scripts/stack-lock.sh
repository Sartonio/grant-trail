#!/usr/bin/env bash
#
# Mutex for ONE local Supabase stack. Since Phase 2 (scripts/stack-env.sh)
# each worktree has its OWN stack, so the lock is per-stack: it serializes
# concurrent stack-tier runs *of the same checkout* (vf_boot_stack runs a
# destructive `db reset`), while different worktrees run fully in parallel.
# On contention you're told which worktree/branch/command holds the stack and
# since when.
#
# Two ways to use it:
#   source scripts/stack-lock.sh     # then call sl_acquire "<label>" (verify scripts)
#   bash scripts/stack-lock.sh who   # is this stack free? any other stacks held?
#   bash scripts/stack-lock.sh run <cmd...>   # run one command under the lock
#
# The lock lives in /tmp (NOT the repo) because it must be shared across
# processes. flock ties it to an open fd, so it auto-releases when the holding
# process dies — no stale-lock cleanup needed. Only the .info sidecar can go
# stale (crash before trap); `who` detects and labels that case.
#
# sl_acquire also regenerates the worktree's supabase/config.toml
# (se_ensure_config) right after taking the lock, so every stack-touching
# command targets its own stack without the callers having to remember.
#
# Env knobs: STACK_LOCK_FILE (path), STACK_LOCK_TIMEOUT (max wait, s, default 1800).

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stack-env.sh"

STACK_LOCK_FILE="${STACK_LOCK_FILE:-/tmp/grant-trail-stack-${SE_PROJECT_ID}.lock}"
STACK_LOCK_INFO="$STACK_LOCK_FILE.info"
STACK_LOCK_TIMEOUT="${STACK_LOCK_TIMEOUT:-1800}"
STACK_LOCK_FD=200

# Acquire the lock for the LIFETIME OF THE CALLING SCRIPT (fd stays open until
# the shell exits; a trap clears the info sidecar). Callers that fork the stack
# boot into a background subshell must acquire in the PARENT first — a lock
# taken inside the subshell would release when the subshell exits.
# $1: human-readable label for the .info file (e.g. "npm run verify:full").
sl_acquire() {
  local label="${1:-$0}"
  eval "exec $STACK_LOCK_FD>>\"\$STACK_LOCK_FILE\""
  if ! flock -n "$STACK_LOCK_FD"; then
    echo "==> local Supabase stack is IN USE by another run:"
    sed 's/^/      /' "$STACK_LOCK_INFO" 2>/dev/null || echo "      (holder info unavailable)"
    echo "    waiting up to ${STACK_LOCK_TIMEOUT}s for it to finish (STACK_LOCK_TIMEOUT to change)..."
    if ! flock -w "$STACK_LOCK_TIMEOUT" "$STACK_LOCK_FD"; then
      echo "ERROR: timed out waiting for the stack lock. Check 'npm run stack:who'."
      return 1
    fi
    echo "    stack lock acquired — continuing."
  fi
  # We now own the stack: make sure config.toml describes THIS worktree's
  # stack before any supabase command reads it (no-op on the main checkout).
  se_ensure_config || { sl_release; return 1; }
  {
    echo "worktree: $(pwd)"
    echo "branch:   $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
    echo "command:  $label"
    echo "pid:      $$"
    echo "since:    $(date '+%Y-%m-%d %H:%M:%S')"
  } >"$STACK_LOCK_INFO"
  trap sl_release EXIT
}

sl_release() {
  rm -f "$STACK_LOCK_INFO"
  eval "exec $STACK_LOCK_FD>&-" 2>/dev/null || true
}

# Report lock state without taking it (probe with a throwaway fd + flock -n).
sl_who() {
  echo "this checkout's stack: ${SE_PROJECT_ID}"
  if ( exec 9>>"$STACK_LOCK_FILE" && flock -n 9 ) 2>/dev/null; then
    echo "stack lock: FREE"
    if [ -f "$STACK_LOCK_INFO" ]; then
      echo "(stale holder info left behind by a crashed run:)"
      sed 's/^/  /' "$STACK_LOCK_INFO"
    fi
  else
    echo "stack lock: HELD"
    sed 's/^/  /' "$STACK_LOCK_INFO" 2>/dev/null || echo "  (holder info unavailable)"
  fi
  # Other checkouts' stacks (per-worktree since Phase 2), plus the legacy
  # shared-lock path — anything held elsewhere on this machine.
  local f
  for f in /tmp/grant-trail-stack.lock /tmp/grant-trail-stack-*.lock; do
    [ -e "$f" ] || continue
    [ "$f" = "$STACK_LOCK_FILE" ] && continue
    if ! ( exec 9>>"$f" && flock -n 9 ) 2>/dev/null; then
      echo "also HELD: $f"
      sed 's/^/  /' "$f.info" 2>/dev/null || echo "  (holder info unavailable)"
    fi
  done
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -uo pipefail
  case "${1:-}" in
    who)
      sl_who
      ;;
    run)
      shift
      [ "$#" -gt 0 ] || { echo "usage: stack-lock.sh run <cmd...>"; exit 2; }
      sl_acquire "$*" || exit 1
      "$@"
      ;;
    *)
      echo "usage: stack-lock.sh who | run <cmd...>"
      exit 2
      ;;
  esac
fi
