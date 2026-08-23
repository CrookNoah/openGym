#!/usr/bin/env bash
# install.sh — put claude-launcher on PATH, install its eww config, and
# (optionally) wire up the Hyprland keybind.
#
#   ./install.sh            copy the eww config into ~/.config
#   ./install.sh --link     symlink it instead (for hacking on this repo)
#   ./install.sh --no-hypr  skip the Hyprland keybind entirely
set -euo pipefail

SRC="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/claude-launcher"
BIN_DIR="$HOME/.local/bin"
HYPR_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hypr"

LINK=0
HYPR=1
for arg in "$@"; do
  case "$arg" in
    --link)    LINK=1 ;;
    --no-hypr) HYPR=0 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; D=$'\033[2m'; N=$'\033[0m'
[[ -t 1 ]] || { B=""; G=""; Y=""; D=""; N=""; }
say()  { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
note() { printf '%s•%s %s\n' "$Y" "$N" "$*"; }

printf '%sinstalling claude-launcher%s\n\n' "$B" "$N"

# ── binary ───────────────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
ln -sf "$SRC/bin/claude-launcher" "$BIN_DIR/claude-launcher"
say "linked $BIN_DIR/claude-launcher"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) note "$BIN_DIR is not on your PATH — add it to your shell profile" ;;
esac

# ── eww config ───────────────────────────────────────────────────────────────
mkdir -p "$CONFIG_DIR"
if [[ $LINK -eq 1 ]]; then
  rm -rf "$CONFIG_DIR/eww"
  ln -sfn "$SRC/eww" "$CONFIG_DIR/eww"
  say "symlinked eww config -> $SRC/eww"
else
  mkdir -p "$CONFIG_DIR/eww"
  # theme.scss is regenerated below; never clobber a user's tweaked copy of it
  # with the stock palette if they already have one.
  cp -f "$SRC/eww/eww.yuck" "$SRC/eww/eww.scss" "$CONFIG_DIR/eww/"
  [[ -f $CONFIG_DIR/eww/theme.scss ]] || cp -f "$SRC/eww/theme.scss" "$CONFIG_DIR/eww/"
  say "installed eww config to $CONFIG_DIR/eww"
fi

# ── user config ──────────────────────────────────────────────────────────────
if [[ -f $CONFIG_DIR/config.toml ]]; then
  note "kept existing config.toml"
else
  cp "$SRC/config/config.toml.example" "$CONFIG_DIR/config.toml"
  say "wrote $CONFIG_DIR/config.toml"
fi

# ── palette ──────────────────────────────────────────────────────────────────
"$BIN_DIR/claude-launcher" theme >/dev/null 2>&1 \
  && say "synced palette from the active Omarchy theme" \
  || note "kept the default Tokyo Night palette"

# ── Hyprland ─────────────────────────────────────────────────────────────────
if [[ $HYPR -eq 1 && -d $HYPR_DIR ]]; then
  cp -f "$SRC/hypr/claude-launcher.conf" "$HYPR_DIR/claude-launcher.conf"
  say "wrote $HYPR_DIR/claude-launcher.conf"

  BINDINGS="$HYPR_DIR/bindings.conf"
  LINE='source = ~/.config/hypr/claude-launcher.conf'

  if [[ -f $BINDINGS ]] && grep -qF 'claude-launcher.conf' "$BINDINGS"; then
    note "bindings.conf already sources it"
  else
    printf '\n%sAdd the SUPER+A keybind to %s?%s [y/N] ' "$B" "$(basename "$BINDINGS")" "$N"
    read -r reply < /dev/tty || reply="n"
    if [[ ${reply,,} == y* ]]; then
      [[ -f $BINDINGS ]] && cp "$BINDINGS" "$BINDINGS.bak.$(date +%s)"
      printf '\n# claude-launcher\n%s\n' "$LINE" >> "$BINDINGS"
      say "appended to $BINDINGS (backup alongside it)"
      command -v hyprctl >/dev/null 2>&1 && hyprctl reload >/dev/null 2>&1 || true
    else
      note "skipped — add this line to your Hyprland config yourself:"
      printf '    %s%s%s\n' "$D" "$LINE" "$N"
    fi
  fi
elif [[ $HYPR -eq 1 ]]; then
  note "no ~/.config/hypr — skipping the keybind"
fi

# ── done ─────────────────────────────────────────────────────────────────────
printf '\n'
"$BIN_DIR/claude-launcher" doctor || true
printf '\n%sTry it:%s claude-launcher toggle   %s(or SUPER+A)%s\n' "$B" "$N" "$D" "$N"
