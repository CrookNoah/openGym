#!/usr/bin/env bash
# launch.sh — open a terminal in a project and start Claude in it.
set -uo pipefail

# Terminals we know how to point at a directory, in preference order.
_cl_pick_terminal() {
  local want; want="$(cl_cfg launch.terminal auto)"
  if [[ $want != "auto" ]]; then printf '%s' "$want"; return; fi
  local t
  for t in alacritty ghostty kitty foot wezterm; do
    cl_have "$t" && { printf '%s' "$t"; return; }
  done
  printf '%s' "${TERMINAL:-xterm}"
}

# Build the argv that runs $script inside $term, starting in $dir.
_cl_term_argv() {
  local term="$1" dir="$2" script="$3"
  local sh="${SHELL:-/bin/bash}"
  case "$(basename "$term")" in
    alacritty) CL_ARGV=("$term" --working-directory "$dir" -e "$sh" -lc "$script") ;;
    ghostty)   CL_ARGV=("$term" "--working-directory=$dir" -e "$sh" -lc "$script") ;;
    kitty)     CL_ARGV=("$term" --directory "$dir" -- "$sh" -lc "$script") ;;
    foot)      CL_ARGV=("$term" "--working-directory=$dir" -- "$sh" -lc "$script") ;;
    wezterm)   CL_ARGV=("$term" start --cwd "$dir" -- "$sh" -lc "$script") ;;
    *)         CL_ARGV=("$term" -e "$sh" -lc "cd $(printf '%q' "$dir") && $script") ;;
  esac
}

# $1 project path, $2 "--fresh" to ignore any resumable session
cl_launch_project() {
  local dir="$1" mode="${2-}"
  cl_load_config
  [[ -d $dir ]] || cl_die "project directory is gone: $dir"

  local -a claude_args=()

  # Resume only when a session actually exists — `claude --continue` errors out
  # in a fresh project and the terminal would flash and vanish.
  local resume=0
  cl_cfg_bool launch.resume_by_default true && resume=1
  [[ $mode == "--fresh" ]] && resume=0
  if [[ $resume -eq 1 ]] && _cl_has_session "$dir"; then
    claude_args+=(--continue)
  fi

  local t
  while IFS= read -r t; do
    [[ -n $t && "$(cl_expand "$t")" == "$dir" ]] && claude_args+=(--dangerously-skip-permissions)
  done < <(cl_cfg_lines launch.trusted)

  local extra; extra="$(cl_cfg launch.extra_args "")"

  # Keep the window up if Claude exits non-zero, otherwise the error is unreadable.
  local script
  script="claude $(_cl_quote_all "${claude_args[@]}") ${extra}"
  script+='; rc=$?; if [ $rc -ne 0 ]; then printf "\n\033[31mclaude exited (%s)\033[0m — press any key\n" "$rc"; read -rsn1; fi'

  cl_record_recent "$dir"

  local term; term="$(_cl_pick_terminal)"
  _cl_term_argv "$term" "$dir" "$script"
  setsid -f "${CL_ARGV[@]}" >/dev/null 2>&1 \
    || nohup "${CL_ARGV[@]}" >/dev/null 2>&1 &
}

_cl_quote_all() {
  local out="" a
  for a in "$@"; do out+="${out:+ }$(printf '%q' "$a")"; done
  printf '%s' "$out"
}

_cl_has_session() {
  local dir="$1" projdir="$HOME/.claude/projects"
  local k1="${dir//\//-}" k2
  k2="$(printf '%s' "$dir" | tr -c 'a-zA-Z0-9' '-')"
  local k
  for k in "$k1" "$k2"; do
    compgen -G "$projdir/$k/*.jsonl" >/dev/null 2>&1 && return 0
  done
  return 1
}
