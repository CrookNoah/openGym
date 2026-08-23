#!/usr/bin/env bash
# window.sh — open / close / toggle the eww window and the Hyprland submap.
#
# Every exit path resets the submap. If the widget ever dies while the submap
# is active the keyboard would stay captured, so this is the one invariant
# worth being paranoid about.
set -uo pipefail

_cl_focused_monitor() {
  cl_have hyprctl || return 1
  hyprctl monitors -j 2>/dev/null | jq -r 'map(select(.focused)) | .[0].id // empty' 2>/dev/null
}

cl_window_open() {
  cl_dirs
  cl_load_config
  # Checked up front: the eww calls below redirect stderr, so a failure there
  # would otherwise exit without ever printing why.
  cl_have eww || cl_die "eww is not installed — see: claude-launcher doctor"
  [[ -d $CL_EWW_DIR ]] || cl_die "eww config missing at $CL_EWW_DIR — run install.sh"

  # Warm the cache before the window paints so the first frame has real rows.
  cl_scan_if_stale

  local -a args=(open launcher)
  local mon; mon="$(_cl_focused_monitor || true)"
  [[ -n ${mon:-} ]] && args+=(--screen "$mon")

  # Anchor comes from config so moving the widget needs no yuck edit.
  args+=(--anchor "$(cl_cfg ui.anchor center)")

  if ! cl_eww "${args[@]}" >/dev/null 2>&1; then
    # Fall back to the geometry baked into eww.yuck if this build dislikes
    # the override (anchor names differ slightly across eww versions).
    cl_eww open launcher ${mon:+--screen "$mon"} >/dev/null 2>&1 \
      || cl_die "eww failed to open the launcher window"
  fi

  cl_submap claude_launcher
}

# Never fails: this runs on the way to launching a project, and a missing eww
# must not stop the terminal from opening. Resetting the submap matters most —
# skipping it would leave the keyboard captured.
cl_close_window() {
  cl_submap reset
  cl_have eww || return 0
  eww --config "$CL_EWW_DIR" close launcher >/dev/null 2>&1 || true
}

cl_window_is_open() {
  cl_have eww || return 1
  eww --config "$CL_EWW_DIR" active-windows 2>/dev/null | grep -q '^launcher'
}

cl_window_toggle() {
  if cl_window_is_open; then cl_close_window; else cl_window_open; fi
}
