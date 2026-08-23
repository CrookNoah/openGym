#!/usr/bin/env bash
# doctor.sh — check everything the launcher depends on, loudly.
set -uo pipefail

cl_doctor_main() {
  cl_dirs
  cl_load_config

  local fail=0
  local B=$'\033[1m' G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' D=$'\033[2m' N=$'\033[0m'
  [[ -t 1 ]] || { B=""; G=""; Y=""; R=""; D=""; N=""; }

  printf '%sclaude-launcher doctor%s\n\n' "$B" "$N"

  _req() {
    if cl_have "$1"; then
      printf '  %s✓%s %-12s %s%s%s\n' "$G" "$N" "$1" "$D" "$(command -v "$1")" "$N"
    else
      printf '  %s✗%s %-12s %srequired — %s%s\n' "$R" "$N" "$1" "$R" "$2" "$N"
      fail=1
    fi
  }
  _opt() {
    if cl_have "$1"; then
      printf '  %s✓%s %-12s %s%s%s\n' "$G" "$N" "$1" "$D" "$(command -v "$1")" "$N"
    else
      printf '  %s•%s %-12s %soptional — %s%s\n' "$Y" "$N" "$1" "$D" "$2" "$N"
    fi
  }

  printf '%srequired%s\n' "$B" "$N"
  _req eww    "the widget itself"
  _req jq     "list filtering"
  _req git    "branch and dirty state"
  _req claude "the thing we are launching"

  printf '\n%soptional%s\n' "$B" "$N"
  _opt hyprctl     "keyboard navigation via a Hyprland submap"
  _opt fd          "much faster repo scanning than find"
  _opt notify-send "error toasts"
  _opt walker      "the New project prompt (fuzzel/wofi/rofi/gum also work)"

  printf '\n%sterminal%s\n' "$B" "$N"
  local term; term="$(_cl_pick_terminal)"
  if cl_have "$term"; then
    printf '  %s✓%s %-12s %s%s%s\n' "$G" "$N" "$term" "$D" "$(command -v "$term")" "$N"
  else
    printf '  %s✗%s %-12s %snot found — set [launch] terminal in config.toml%s\n' \
      "$R" "$N" "$term" "$R" "$N"
    fail=1
  fi

  printf '\n%spaths%s\n' "$B" "$N"
  _path() {
    if [[ -e $2 ]]; then
      printf '  %s✓%s %-12s %s%s%s\n' "$G" "$N" "$1" "$D" "$(cl_shorten "$2")" "$N"
    else
      printf '  %s•%s %-12s %smissing: %s%s\n' "$Y" "$N" "$1" "$D" "$(cl_shorten "$2")" "$N"
    fi
  }
  _path config "$CL_CONFIG_FILE"
  _path eww    "$CL_EWW_DIR/eww.yuck"
  _path theme  "$CL_EWW_DIR/theme.scss"
  _path cache  "$CL_CACHE_FILE"

  printf '\n%sroots%s\n' "$B" "$N"
  local root rp n total=0
  while IFS= read -r root; do
    [[ -n $root ]] || continue
    rp="$(cl_expand "$root")"
    if [[ -d $rp ]]; then
      n="$(_cl_count_repos "$rp")"
      total=$(( total + n ))
      printf '  %s✓%s %-24s %s%s repo(s)%s\n' "$G" "$N" "$root" "$D" "$n" "$N"
    else
      printf '  %s•%s %-24s %sdoes not exist%s\n' "$Y" "$N" "$root" "$D" "$N"
    fi
  done < <(cl_cfg_lines scan.roots)

  if [[ $total -eq 0 ]]; then
    printf '\n  %s!%s no repos found — check [scan] roots in %s\n' \
      "$Y" "$N" "$(cl_shorten "$CL_CONFIG_FILE")"
  fi

  printf '\n'
  if [[ $fail -eq 0 ]]; then
    printf '%s✓ ready.%s  Bind it:  %sclaude-launcher toggle%s\n' "$G" "$N" "$B" "$N"
  else
    printf '%s✗ missing required dependencies (see above).%s\n' "$R" "$N"
  fi
  return $fail
}

_cl_count_repos() {
  local rp="$1" depth; depth="$(cl_cfg scan.depth 3)"
  if cl_have fd; then
    fd --hidden --no-ignore --type d --max-depth $(( depth + 1 )) \
       '^\.git$' "$rp" 2>/dev/null | grep -c . || true
  else
    find "$rp" -maxdepth $(( depth + 1 )) -type d -name .git -prune -print 2>/dev/null \
      | grep -c . || true
  fi
}
