#!/bin/sh

# Safe local ai-config v2 bootstrap. It may fetch only SHA-256-pinned external
# skill archives declared in ai-specs and runs the exact lock-installed CLI in
# isolated staging. It never updates a Git checkout, runs Ansible, or replaces
# a provider home; package installation is forced and isolated.

set -eu

if [ -z "${HOME-}" ]; then
  echo "ai-config: HOME must be set before installation" >&2
  exit 1
fi

TRUSTED_PATH=${PATH-}
SYSTEM_PATH=/usr/bin:/bin
PATH=$SYSTEM_PATH

if [ "$(id -u)" -eq 0 ]; then
  echo "ai-config: refuse to install as root" >&2
  exit 1
fi

case "$0" in
  /*) SCRIPT_PATH=$0 ;;
  *) SCRIPT_PATH=$PWD/$0 ;;
esac
REALPATH=$(command -v realpath)
[ -x "$REALPATH" ] || { echo "ai-config: system realpath helper is required" >&2; exit 1; }
SCRIPT_PATH=$($REALPATH "$SCRIPT_PATH")
SCRIPT_DIR=$(CDPATH= cd -- "${SCRIPT_PATH%/*}" && pwd -P)

for file in generated/manifest.json package.json bun.lock bunfig.toml; do
  if [ ! -f "$SCRIPT_DIR/$file" ] || [ -L "$SCRIPT_DIR/$file" ]; then
    echo "ai-config: complete pinned release metadata must be a regular file: $file" >&2
    exit 1
  fi
done

if ! BUN=$(PATH="$TRUSTED_PATH" command -v bun 2>/dev/null); then
  echo "ai-config: Bun 1.4.0 is required; install it through your trusted package manager" >&2
  exit 1
fi

# Resolve the command before using it, so PATH aliases/symlinks cannot change
# the runtime between validation and install.
case "$BUN" in
  /*) ;;
  *) echo "ai-config: Bun executable must resolve to an absolute path" >&2; exit 1 ;;
esac
BUN_DIR=${BUN%/*}
BUN_NAME=${BUN##*/}
BUN_DIR=$(CDPATH= cd -- "$BUN_DIR" && pwd -P)
BUN="$BUN_DIR/$BUN_NAME"
[ -x "$BUN" ] || { echo "ai-config: Bun executable is not executable" >&2; exit 1; }
BUN=$($REALPATH "$BUN")
[ -x "$BUN" ] || { echo "ai-config: Bun executable is not executable" >&2; exit 1; }

if [ "$(/usr/bin/env -i PATH="$PATH" HOME="$HOME" "$BUN" --no-env-file --no-install --config="$SCRIPT_DIR/bunfig.toml" --version)" != "1.4.0" ]; then
  echo "ai-config: exactly Bun 1.4.0 is required" >&2
  exit 1
fi

atomic_rename() {
  /usr/bin/env -i "PATH=$SYSTEM_PATH" "HOME=$HOME" "TMPDIR=/tmp" "$BUN" --no-env-file --no-install --config="$SCRIPT_DIR/bunfig.toml" "$SCRIPT_DIR/bin/atomic-rename.mjs" "$1" "$2"
}

DRY_RUN=0
for argument in "$@"; do
  if [ "$argument" = "--dry-run" ]; then DRY_RUN=1; fi
done
if [ "$DRY_RUN" -eq 1 ]; then
  if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "ai-config: --dry-run requires an existing dependency tree; run a normal install first" >&2
    exit 1
  fi
  DRY_ISOLATION=$(mktemp -d "$SCRIPT_DIR/.ai-config-dry.XXXXXX")
  DRY_HOME="$DRY_ISOLATION/home"; DRY_CACHE="$DRY_ISOLATION/cache"; DRY_CONFIG="$DRY_ISOLATION/config"; DRY_DATA="$DRY_ISOLATION/data"
  mkdir -p "$DRY_HOME" "$DRY_CACHE" "$DRY_CONFIG" "$DRY_DATA"; chmod 700 "$DRY_HOME" "$DRY_CACHE" "$DRY_CONFIG" "$DRY_DATA"
  dry_cleanup() { rm -rf "$DRY_ISOLATION"; }
  trap dry_cleanup EXIT
  if ! /usr/bin/env -i "PATH=$SYSTEM_PATH" "HOME=$DRY_HOME" "TMPDIR=/tmp" "XDG_CACHE_HOME=$DRY_CACHE" "XDG_CONFIG_HOME=$DRY_CONFIG" "XDG_DATA_HOME=$DRY_DATA" "$BUN" --no-env-file --no-install --config="$SCRIPT_DIR/bunfig.toml" "$SCRIPT_DIR/bin/verify-bun-deps.mjs" "$SCRIPT_DIR"; then
    echo "ai-config: --dry-run requires existing dependency metadata matching package.json and bun.lock; no changes were made" >&2
    exit 1
  fi
  if /usr/bin/env -i "PATH=$TRUSTED_PATH" "HOME=$DRY_HOME" "TMPDIR=/tmp" "XDG_CACHE_HOME=$DRY_CACHE" "XDG_CONFIG_HOME=$DRY_CONFIG" "XDG_DATA_HOME=$DRY_DATA" "$BUN" --no-env-file --no-install --config="$SCRIPT_DIR/bunfig.toml" "$SCRIPT_DIR/bin/ai-config-lifecycle.mjs" install --target "$HOME" "$@"; then
    dry_status=0
  else
    dry_status=$?
  fi
  exit "$dry_status"
fi

INSTALL_LOCK="$SCRIPT_DIR/.ai-config-install.lock"
RECOVERY_MARKER="$SCRIPT_DIR/.ai-config-node-modules.recovery"
INSTALL_BACKUP="$SCRIPT_DIR/.ai-config-node_modules.previous"
if [ -e "$RECOVERY_MARKER" ] && { [ -L "$RECOVERY_MARKER" ] || [ ! -f "$RECOVERY_MARKER" ]; }; then
  echo "ai-config: recovery marker must be a regular file" >&2
  exit 1
fi
if [ -e "$INSTALL_BACKUP" ] && { [ -L "$INSTALL_BACKUP" ] || [ ! -d "$INSTALL_BACKUP" ]; }; then
  echo "ai-config: dependency backup must be a real directory" >&2
  exit 1
fi
if [ -e "$SCRIPT_DIR/node_modules" ] && { [ -L "$SCRIPT_DIR/node_modules" ] || [ ! -d "$SCRIPT_DIR/node_modules" ]; }; then
  echo "ai-config: node_modules must be a real directory" >&2
  exit 1
fi
if ! mkdir "$INSTALL_LOCK" 2>/dev/null; then
  echo "ai-config: another dependency installation or recovery is active" >&2
  exit 1
fi
trap 'rmdir "$INSTALL_LOCK" 2>/dev/null || true' EXIT
trap 'rmdir "$INSTALL_LOCK" 2>/dev/null || true; exit 1' HUP INT TERM
if [ -e "$INSTALL_BACKUP" ] && [ ! -e "$RECOVERY_MARKER" ]; then
  echo "ai-config: an untracked dependency backup exists; recover it before retrying" >&2
  exit 1
fi
if [ -e "$RECOVERY_MARKER" ]; then
  if [ ! -e "$SCRIPT_DIR/node_modules" ] && [ -d "$INSTALL_BACKUP" ]; then
    if atomic_rename "$INSTALL_BACKUP" "$SCRIPT_DIR/node_modules"; then
      rm -f "$RECOVERY_MARKER"
    else
      echo "ai-config: deterministic dependency recovery could not publish the backup" >&2
      exit 1
    fi
  else
    echo "ai-config: interrupted dependency publication requires manual recovery; inspect $RECOVERY_MARKER" >&2
    exit 1
  fi
fi
INSTALL_ISOLATION=$(mktemp -d "$SCRIPT_DIR/.ai-config-install.XXXXXX")
INSTALL_HOME="$INSTALL_ISOLATION/home"
INSTALL_CACHE="$INSTALL_ISOLATION/cache"
INSTALL_CONFIG="$INSTALL_ISOLATION/config"
INSTALL_DATA="$INSTALL_ISOLATION/data"
INSTALL_STAGE="$INSTALL_ISOLATION/stage"
mkdir -p "$INSTALL_HOME" "$INSTALL_CACHE" "$INSTALL_CONFIG" "$INSTALL_DATA"
chmod 700 "$INSTALL_HOME" "$INSTALL_CACHE" "$INSTALL_CONFIG" "$INSTALL_DATA"
SWAPPED=0
COMPLETE=0
cleanup() {
  if [ "$SWAPPED" -eq 1 ] && [ "$COMPLETE" -eq 0 ]; then
    if [ -e "$SCRIPT_DIR/node_modules" ]; then
      atomic_rename "$SCRIPT_DIR/node_modules" "$INSTALL_STAGE/node_modules.failed" 2>/dev/null || true
    fi
    if [ ! -e "$SCRIPT_DIR/node_modules" ] && [ -e "$INSTALL_BACKUP" ]; then
      if atomic_rename "$INSTALL_BACKUP" "$SCRIPT_DIR/node_modules"; then
        rm -f "$RECOVERY_MARKER"
      fi
    fi
  fi
  rm -f "${MARKER_TMP-}" 2>/dev/null || true
  rm -rf "$INSTALL_ISOLATION"
  rmdir "$INSTALL_LOCK" 2>/dev/null || true
}
trap cleanup EXIT
trap 'cleanup; exit 1' HUP INT TERM

mkdir -p "$INSTALL_STAGE"
cp "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/bun.lock" "$SCRIPT_DIR/bunfig.toml" "$SCRIPT_DIR/bin/verify-bun-deps.mjs" "$INSTALL_STAGE/"
cd "$INSTALL_STAGE"
/usr/bin/env -i "PATH=$SYSTEM_PATH" "HOME=$INSTALL_HOME" "TMPDIR=/tmp" "XDG_CACHE_HOME=$INSTALL_CACHE" "XDG_CONFIG_HOME=$INSTALL_CONFIG" "XDG_DATA_HOME=$INSTALL_DATA" "BUN_INSTALL_CACHE_DIR=$INSTALL_CACHE" "$BUN" --no-env-file --config="$INSTALL_STAGE/bunfig.toml" install --frozen-lockfile --ignore-scripts >&2

if [ ! -x "$INSTALL_STAGE/node_modules/.bin/skills" ]; then
  echo "ai-config: clean Bun skills executable is missing" >&2
  exit 1
fi
if [ -L "$INSTALL_STAGE/node_modules" ] || [ ! -d "$INSTALL_STAGE/node_modules" ]; then
  echo "ai-config: staged node_modules must be a real directory" >&2
  exit 1
fi
if ! /usr/bin/env -i "PATH=$SYSTEM_PATH" "HOME=$INSTALL_HOME" "TMPDIR=/tmp" "XDG_CACHE_HOME=$INSTALL_CACHE" "XDG_CONFIG_HOME=$INSTALL_CONFIG" "XDG_DATA_HOME=$INSTALL_DATA" "BUN_INSTALL_CACHE_DIR=$INSTALL_CACHE" "$BUN" --no-env-file --no-install --config="$INSTALL_STAGE/bunfig.toml" "$INSTALL_STAGE/verify-bun-deps.mjs" "$INSTALL_STAGE"; then
  echo "ai-config: local dependencies are missing; run bun install in this pinned checkout after reviewing bun.lock" >&2
  exit 1
fi

MARKER_TMP=$(mktemp "$SCRIPT_DIR/.ai-config-node-modules.recovery.tmp.XXXXXX")
[ -f "$MARKER_TMP" ] && [ ! -L "$MARKER_TMP" ] || { echo "ai-config: recovery marker temp must be a regular file" >&2; exit 1; }
if [ -e "$INSTALL_BACKUP" ]; then
  echo "ai-config: dependency backup unexpectedly exists" >&2
  exit 1
fi
printf '%s\n' "source=$SCRIPT_DIR/node_modules" "backup=$INSTALL_BACKUP" > "$MARKER_TMP"
if ! atomic_rename "$MARKER_TMP" "$RECOVERY_MARKER"; then
  echo "ai-config: unable to publish dependency recovery marker" >&2
  exit 1
fi
if [ -e "$SCRIPT_DIR/node_modules" ]; then
  atomic_rename "$SCRIPT_DIR/node_modules" "$INSTALL_BACKUP"
fi
if ! atomic_rename "$INSTALL_STAGE/node_modules" "$SCRIPT_DIR/node_modules"; then
  if [ -e "$INSTALL_BACKUP" ]; then
    if atomic_rename "$INSTALL_BACKUP" "$SCRIPT_DIR/node_modules"; then
      rm -f "$RECOVERY_MARKER"
    fi
  fi
  echo "ai-config: unable to publish clean Bun dependencies; previous installation restored" >&2
  exit 1
fi
SWAPPED=1
if ! /usr/bin/env -i "PATH=$SYSTEM_PATH" "HOME=$INSTALL_HOME" "TMPDIR=/tmp" "XDG_CACHE_HOME=$INSTALL_CACHE" "XDG_CONFIG_HOME=$INSTALL_CONFIG" "XDG_DATA_HOME=$INSTALL_DATA" "BUN_INSTALL_CACHE_DIR=$INSTALL_CACHE" "$BUN" --no-env-file --no-install --config="$SCRIPT_DIR/bunfig.toml" "$SCRIPT_DIR/bin/verify-bun-deps.mjs" "$SCRIPT_DIR"; then
  echo "ai-config: published dependency tree failed post-publication verification; previous installation restored" >&2
  exit 1
fi
if [ -e "$INSTALL_BACKUP" ]; then rm -rf "$INSTALL_BACKUP"; fi
rm -f "$RECOVERY_MARKER"
COMPLETE=1
rm -rf "$INSTALL_ISOLATION"
rmdir "$INSTALL_LOCK"
trap - EXIT HUP INT TERM

exec /usr/bin/env -i "PATH=$TRUSTED_PATH" "HOME=$HOME" "TMPDIR=/tmp" "XDG_CACHE_HOME=$HOME/.cache" "XDG_CONFIG_HOME=$HOME/.config" "XDG_DATA_HOME=$HOME/.local/share" "$BUN" --no-env-file --no-install --config="$SCRIPT_DIR/bunfig.toml" "$SCRIPT_DIR/bin/ai-config-lifecycle.mjs" install --target "$HOME" "$@"
