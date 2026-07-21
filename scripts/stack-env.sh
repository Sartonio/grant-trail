# shellcheck shell=bash
#
# Per-worktree local Supabase stack identity (Phase 2 of concurrent-worktree
# testing; Phase 1 was the cross-worktree lock in stack-lock.sh).
#
# The MAIN checkout keeps the canonical stack exactly as committed in
# supabase/config.toml: project_id "grant-trail", ports 54320-54329, Vite 3000.
# Every LINKED WORKTREE (git worktree add / Claude worktrees) gets its OWN
# stack so N worktrees can run verify:full concurrently:
#
#   project_id  grant-trail-<worktree-name>-<hash4>   (unique container names)
#   ports       PPP20-PPP29 where PPP = 550 + slot    (slot from a path hash,
#               collision-probed against other live worktrees' registrations;
#               same layout as 543xx, last two digits keep their meaning)
#   Vite/e2e    PPP30 (exported as E2E_PORT; playwright.config.js reads it)
#   inspector   PPP33
#
# The Supabase CLI reads supabase/config.toml from disk, so se_ensure_config
# REGENERATES that file inside the worktree from the committed version + the
# port/id substitutions above, then marks it `git update-index --skip-worktree`
# so the worktree stays clean and the substitution can never be committed.
# (To hand-edit config.toml inside a worktree, first undo with
# `git update-index --no-skip-worktree supabase/config.toml`.)
#
# Regeneration happens automatically in sl_acquire (stack-lock.sh) and
# vf_boot_stack (verify-lib.sh) — i.e. before any stack-touching command. A
# test run standalone in a worktree that never booted its stack will parse the
# still-canonical config.toml and target the MAIN stack, same as before Phase 2.
#
# Each worktree stack is registered in /tmp/grant-trail-stacks/<project_id>
# (path + chosen port prefix). stack-gc.sh uses the registry to stop stacks
# whose worktree no longer exists; the prefix is reused on re-runs so a
# worktree's ports are stable for its lifetime.

SE_REGISTRY_DIR="${SE_REGISTRY_DIR:-/tmp/grant-trail-stacks}"

# se_init — resolve SE_ROOT / SE_IS_WORKTREE / SE_PROJECT_ID / ports.
# Read-only (no config rewrite); safe to call from any command, any cwd inside
# the repo. Idempotent.
se_init() {
  [ -n "${SE_PROJECT_ID:-}" ] && return 0

  SE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  local gitdir commondir
  gitdir="$(git -C "$SE_ROOT" rev-parse --absolute-git-dir 2>/dev/null || echo a)"
  commondir="$(readlink -f "$(git -C "$SE_ROOT" rev-parse --git-common-dir 2>/dev/null || echo a)" 2>/dev/null || echo a)"

  if [ "$gitdir" != "$commondir" ]; then
    SE_IS_WORKTREE=1
    local name hash hash4
    name="$(basename "$SE_ROOT" | tr '[:upper:]' '[:lower:]' \
      | tr -c 'a-z0-9-' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//' | cut -c1-24)"
    hash="$(printf %s "$SE_ROOT" | cksum | cut -d' ' -f1)"
    hash4="$(printf '%04x' $((hash % 65536)))"
    SE_PROJECT_ID="grant-trail-${name:-worktree}-${hash4}"
    SE_PORT_PREFIX="$(se__resolve_prefix "$((hash % 100))")"
    SE_VITE_PORT="$((SE_PORT_PREFIX * 100 + 30))"
    SE_INSPECTOR_PORT="$((SE_PORT_PREFIX * 100 + 33))"
    # Thread the worktree's Vite port to playwright.config.js / `npm run e2e`.
    export E2E_PORT="${E2E_PORT:-$SE_VITE_PORT}"
  else
    SE_IS_WORKTREE=0
    # Canonical values, matching the committed supabase/config.toml.
    SE_PROJECT_ID="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
      "$SE_ROOT/supabase/config.toml" 2>/dev/null | head -n1)"
    SE_PROJECT_ID="${SE_PROJECT_ID:-grant-trail}"
    SE_PORT_PREFIX=543
    SE_VITE_PORT=3000
    SE_INSPECTOR_PORT=8083
  fi

  SE_API_PORT="$((SE_PORT_PREFIX * 100 + 21))"
  export SE_ROOT SE_IS_WORKTREE SE_PROJECT_ID SE_PORT_PREFIX \
    SE_API_PORT SE_VITE_PORT SE_INSPECTOR_PORT
}

# se__resolve_prefix <preferred-slot> — echo a 3-digit port prefix (550-649).
# Reuses this worktree's previously registered prefix when there is one (port
# stability across runs); otherwise linear-probes from the hash slot past any
# prefix claimed by ANOTHER registered worktree that still exists on disk.
se__resolve_prefix() {
  local slot="$1" reg="$SE_REGISTRY_DIR/$SE_PROJECT_ID" i p f rpath rprefix
  if [ -f "$reg" ] && [ "$(se__reg_get "$reg" path)" = "$SE_ROOT" ]; then
    rprefix="$(se__reg_get "$reg" port_prefix)"
    case "$rprefix" in [0-9][0-9][0-9]) echo "$rprefix"; return 0 ;; esac
  fi
  for i in $(seq 0 99); do
    p=$((550 + (slot + i) % 100))
    for f in "$SE_REGISTRY_DIR"/*; do
      [ -f "$f" ] || continue
      [ "$(basename "$f")" = "$SE_PROJECT_ID" ] && continue
      rprefix="$(se__reg_get "$f" port_prefix)"
      rpath="$(se__reg_get "$f" path)"
      if [ "$rprefix" = "$p" ] && [ -d "$rpath" ]; then
        continue 2
      fi
    done
    echo "$p"
    return 0
  done
  # 100 live worktrees on one machine — give up on probing, use the hash slot.
  echo "$((550 + slot))"
}

se__reg_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n1; }

# se_ensure_config — make supabase/config.toml describe THIS worktree's stack.
# No-op on the main checkout. Idempotent: always regenerates from the committed
# blob so upstream config.toml changes flow into worktrees on their next run.
se_ensure_config() {
  se_init
  [ "$SE_IS_WORKTREE" = 1 ] || return 0

  local cfg="$SE_ROOT/supabase/config.toml" tmp
  tmp="$(mktemp -t stack-env-cfg.XXXXXX)" || return 1
  if ! git -C "$SE_ROOT" show :supabase/config.toml >"$tmp" 2>/dev/null; then
    rm -f "$tmp"
    if grep -q "^project_id = \"${SE_PROJECT_ID}\"" "$cfg" 2>/dev/null; then
      return 0   # already generated and no committed blob to regenerate from
    fi
    echo "ERROR: cannot read committed supabase/config.toml to derive the worktree stack config" >&2
    return 1
  fi
  # Same substitution everywhere a canonical value appears: ports keep their
  # last two digits under the worktree prefix (54321 -> PPP21, commented ones
  # included — harmless), the Vite origin follows E2E_PORT so auth site_url /
  # redirect allow-lists stay correct, and the edge inspector moves off 8083.
  sed -e "s/^project_id = \".*\"/project_id = \"${SE_PROJECT_ID}\"/" \
      -e "s/\b543\([0-9][0-9]\)\b/${SE_PORT_PREFIX}\1/g" \
      -e "s/\b8083\b/${SE_INSPECTOR_PORT}/g" \
      -e "s/localhost:3000/localhost:${SE_VITE_PORT}/g" \
      -e "s/127\.0\.0\.1:3000/127.0.0.1:${SE_VITE_PORT}/g" \
      "$tmp" >"$cfg" || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"
  # Keep the generated file out of git (worktree stays clean, can't be
  # committed). Undo with: git update-index --no-skip-worktree supabase/config.toml
  git -C "$SE_ROOT" update-index --skip-worktree supabase/config.toml 2>/dev/null || true

  mkdir -p "$SE_REGISTRY_DIR"
  {
    echo "path=$SE_ROOT"
    echo "port_prefix=$SE_PORT_PREFIX"
    echo "project_id=$SE_PROJECT_ID"
  } >"$SE_REGISTRY_DIR/$SE_PROJECT_ID"
}

se_init
