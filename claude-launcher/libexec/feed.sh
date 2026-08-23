#!/usr/bin/env bash
# feed.sh — the widget's single source of truth.
#
# Runs as eww's `deflisten` target: prints one compact JSON object per line,
# re-emitting whenever a command arrives on the FIFO. Selection and query live
# here (not in eww) so the shell can clamp them against the real list length.
set -uo pipefail

cl_feed_main() {
  cl_dirs
  cl_load_config

  local query="" selected=0
  local limit; limit="$(cl_cfg ui.max_results 12)"
  local filter="$CL_LIBEXEC/filter.jq"

  rm -f "$CL_FIFO"
  mkfifo -m 600 "$CL_FIFO" || cl_die "could not create $CL_FIFO"
  # shellcheck disable=SC2064
  trap "rm -f '$CL_FIFO'" EXIT
  trap 'exit 0' INT TERM

  # Hold both ends open so reads never see EOF and writers never block.
  exec 3<>"$CL_FIFO"

  cl_scan_if_stale
  [[ -f $CL_CACHE_FILE ]] || cl_scan_main >/dev/null 2>&1

  _emit() {
    local out
    out="$(jq -c --arg query "$query" \
                 --argjson selected "$selected" \
                 --argjson limit "$limit" \
                 -f "$filter" "$CL_CACHE_FILE" 2>/dev/null)" || out=""
    [[ -z $out ]] && out='{"query":"","selected":0,"count":0,"items":[]}'

    # Persist for `ctl open`, which runs in a separate process.
    printf '%s\n' "$out" > "$CL_STATE_FILE.tmp" 2>/dev/null \
      && mv -f "$CL_STATE_FILE.tmp" "$CL_STATE_FILE" 2>/dev/null

    # Re-read the clamped selection so arrow keys stop at the ends.
    selected="$(printf '%s' "$out" | jq -r '.selected' 2>/dev/null || echo 0)"

    printf '%s\n' "$out"
  }

  _emit

  # A plain blocking read would swallow SIGTERM until a command arrived, so eww
  # could never reap this process on window close. The timeout gives bash a
  # chance to run the trap roughly once a second.
  local line cmd arg count rc
  while true; do
    IFS= read -r -t 1 line <&3 || {
      rc=$?
      (( rc > 128 )) && continue   # timeout: nothing to do, just let traps run
      break                        # genuine read error
    }

    cmd="${line%% *}"
    arg="${line#* }"
    [[ $arg == "$line" ]] && arg=""

    case "$cmd" in
      query)
        query="$arg"
        selected=0
        ;;
      move)
        count="$(jq -r '.items | length' "$CL_STATE_FILE" 2>/dev/null || echo 1)"
        case "$arg" in
          up)     selected=$(( selected - 1 )) ;;
          down)   selected=$(( selected + 1 )) ;;
          top)    selected=0 ;;
          bottom) selected=$(( count - 1 )) ;;
        esac
        # Wrap around — a launcher list is short enough that this feels right.
        (( selected < 0 ))       && selected=$(( count - 1 ))
        (( selected >= count ))  && selected=0
        ;;
      select)
        selected="${arg:-0}"
        ;;
      refresh)
        cl_scan_main >/dev/null 2>&1
        ;;
      quit)
        break
        ;;
    esac
    _emit
  done
}
