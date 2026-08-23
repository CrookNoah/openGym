#!/usr/bin/env bash
# uninstall.sh — remove everything install.sh put in place.
# Leaves ~/.config/claude-launcher/config.toml alone unless --purge is given.
set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/claude-launcher"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/claude-launcher"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/claude-launcher"
BIN="$HOME/.local/bin/claude-launcher"
HYPR_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hypr"

PURGE=0
[[ ${1-} == "--purge" ]] && PURGE=1

command -v claude-launcher >/dev/null 2>&1 && claude-launcher close >/dev/null 2>&1 || true
command -v hyprctl >/dev/null 2>&1 && hyprctl dispatch submap reset >/dev/null 2>&1 || true

rm -f "$BIN"
rm -rf "$CONFIG_DIR/eww" "$CACHE_DIR"
rm -f "$HYPR_DIR/claude-launcher.conf"

if [[ -f $HYPR_DIR/bindings.conf ]] && grep -qF 'claude-launcher.conf' "$HYPR_DIR/bindings.conf"; then
  cp "$HYPR_DIR/bindings.conf" "$HYPR_DIR/bindings.conf.bak.$(date +%s)"
  # Drop the source line and the comment directly above it.
  sed -i '/^# claude-launcher$/,+1{/^# claude-launcher$/d; /claude-launcher\.conf/d}' \
    "$HYPR_DIR/bindings.conf"
  sed -i '/claude-launcher\.conf/d' "$HYPR_DIR/bindings.conf"
  echo "✓ removed the source line from bindings.conf (backup alongside it)"
fi

if [[ $PURGE -eq 1 ]]; then
  rm -rf "$CONFIG_DIR" "$STATE_DIR"
  echo "✓ purged config and recent-project history"
else
  echo "• kept $CONFIG_DIR/config.toml (use --purge to remove)"
fi

command -v hyprctl >/dev/null 2>&1 && hyprctl reload >/dev/null 2>&1 || true
echo "✓ uninstalled"
