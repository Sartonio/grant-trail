#!/usr/bin/env bash
#
# Mutex for the ONE shared local Supabase stack. Every worktree on this machine
# talks to the same fixed ports (54321-54329) and the same container
# (supabase_db_grant-trail), and vf_boot_stack runs a destructive `db reset` —
# so two concurrent stack-tier runs wipe each other's data mid-test. This lock
# serializes them and makes the holder VISIBLE: on contention you're told which
# worktree/branch/command holds the stack and since when.
#
# Two ways to use it:
#   source scripts/stack-lock.sh     # then call sl_acquire "<label>" (verify scripts)
#   bash scripts/stack-lock.sh who   # is the stack free? who holds it?
#   bash scripts/stack-lock.sh run <cmd...>   # run one command under the lock
#
# The lock lives in /tmp (NOT the repo) because it must be shared across
# worktrees. flock ties it to an open fd, so it auto-releases when the holding
# process dies — no stale-lock cleanup needed. Only the .info sidecar can go
# stale (crash before trap); `who` detects and labels that case.
#
# Env knobs: STACK_LOCK_FILE (path), STACK_LOCK_TIMEOUT (max wait, s, default 1800).

STACK_LOCK_FILE="${STACK_LOCK_FILE:-/tmp/grant-trail-stack.lock}"
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
