#!/usr/bin/env bash
# ctl.sh — commands the widget and the Hyprland submap fire at the feed.
set -uo pipefail

cl_ctl_main() {
  local cmd="${1-}"; shift || true

  case "$cmd" in
    query)
      # eww hands us the raw input text as one argument.
      cl_send "query ${*-}"
      ;;

    move)
      cl_send "move ${1-down}"
      ;;

    refresh)
      cl_send "refresh"
      ;;

    open)
      _cl_open_selected "" "${1-}"
      ;;

    open-fresh)
      _cl_open_selected "" "--fresh"
      ;;

    open-index)
      _cl_open_selected "${1-0}" "${2-}"
      ;;

    close)
      cl_close_window
      ;;

    *)
      cl_die "unknown ctl command: ${cmd:-<none>}"
      ;;
  esac
}

# Reads the feed's last render, picks a row, dispatches it, dismisses the UI.
_cl_open_selected() {
  local want_index="$1" mode="${2-}"
  [[ -f $CL_STATE_FILE ]] || { cl_close_window; return 0; }

  local idx
  if [[ -n $want_index ]]; then
    idx="$want_index"
  else
    idx="$(jq -r '.selected' "$CL_STATE_FILE" 2>/dev/null || echo 0)"
  fi

  local row
  row="$(jq -c --argjson i "${idx:-0}" '.items[] | select(.index == $i)' \
          "$CL_STATE_FILE" 2>/dev/null)" || row=""
  [[ -z $row ]] && { cl_close_window; return 0; }

  local kind path
  kind="$(printf '%s' "$row" | jq -r '.kind')"
  path="$(printf '%s' "$row" | jq -r '.path')"

  # Dismiss first so the terminal opens onto a clean desktop.
  cl_close_window

  case "$kind" in
    new)     setsid -f "$CL_BIN" new >/dev/null 2>&1 || "$CL_BIN" new & ;;
    project) cl_launch_project "$path" "$mode" ;;
  esac
}
