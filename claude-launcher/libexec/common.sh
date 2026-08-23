#!/usr/bin/env bash
# common.sh — shared paths, config parsing and helpers for claude-launcher.
# Sourced by every subcommand; never executed directly.

CL_NAME="claude-launcher"

CL_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/$CL_NAME"
CL_CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/$CL_NAME"
CL_STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/$CL_NAME"
CL_RUN_DIR="${XDG_RUNTIME_DIR:-/tmp}/$CL_NAME-$(id -u)"

CL_CONFIG_FILE="$CL_CONFIG_DIR/config.toml"
CL_EWW_DIR="$CL_CONFIG_DIR/eww"
CL_CACHE_FILE="$CL_CACHE_DIR/projects.json"
CL_STATE_FILE="$CL_RUN_DIR/state.json"
CL_FIFO="$CL_RUN_DIR/cmd.fifo"
CL_LOCK="$CL_RUN_DIR/scan.lock"
CL_RECENT="$CL_STATE_DIR/recent.tsv"

cl_dirs() {
  mkdir -p "$CL_CONFIG_DIR" "$CL_CACHE_DIR" "$CL_STATE_DIR" "$CL_RUN_DIR"
  chmod 700 "$CL_RUN_DIR" 2>/dev/null || true
}

cl_die()  { printf '%s: %s\n' "$CL_NAME" "$*" >&2; exit 1; }
cl_warn() { printf '%s: %s\n' "$CL_NAME" "$*" >&2; }

# Expand a leading ~ (config values are written by humans, not the shell).
cl_expand() {
  case "$1" in
    "~")   printf '%s' "$HOME" ;;
    "~/"*) printf '%s' "$HOME/${1#\~/}" ;;
    *)     printf '%s' "$1" ;;
  esac
}

# Collapse $HOME back to ~ for display.
cl_shorten() {
  case "$1" in
    "$HOME") printf '~' ;;
    "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# ── minimal TOML ────────────────────────────────────────────────────────────
# Supports the subset the config actually uses: [section] headers, quoted
# strings, bare numbers/booleans, and single-line arrays of strings. Values
# land in CL_CFG keyed as "section.key"; arrays are stored newline-joined.

declare -gA CL_CFG=()

_cl_strip_comment() {
  local s="$1" out="" i c inq=0
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    [[ $c == '"' ]] && inq=$(( 1 - inq ))
    [[ $c == "#" && $inq -eq 0 ]] && break
    out+="$c"
  done
  printf '%s' "$out"
}

_cl_trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

_cl_unquote() {
  local s="$1"
  [[ $s == \"*\" ]] && s="${s:1:${#s}-2}"
  [[ $s == \'*\' ]] && s="${s:1:${#s}-2}"
  printf '%s' "$s"
}

cl_parse_toml() {
  local file="$1" line section="" key val item
  [[ -f $file ]] || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    line="${line%$'\r'}"
    line="$(_cl_strip_comment "$line")"
    line="$(_cl_trim "$line")"
    [[ -z $line ]] && continue

    if [[ $line == "["*"]" ]]; then
      section="$(_cl_trim "${line:1:${#line}-2}")"
      continue
    fi

    [[ $line != *"="* ]] && continue
    key="$(_cl_trim "${line%%=*}")"
    val="$(_cl_trim "${line#*=}")"
    key="$(_cl_unquote "$key")"
    [[ -n $section ]] && key="$section.$key"

    if [[ $val == "["*"]" ]]; then
      local inner="${val:1:${#val}-2}" joined=""
      local IFS=','
      for item in $inner; do
        item="$(_cl_unquote "$(_cl_trim "$item")")"
        [[ -z $item ]] && continue
        joined+="${joined:+$'\n'}$item"
      done
      CL_CFG["$key"]="$joined"
    else
      CL_CFG["$key"]="$(_cl_unquote "$val")"
    fi
  done < "$file"
}

# Defaults live here so a missing/partial config file still works.
cl_load_config() {
  CL_CFG=(
    [scan.roots]=$'~/dev\n~/work\n~/src\n~/projects'
    [scan.depth]="3"
    [scan.hidden]=""
    [scan.pinned]=""
    [scan.git_status]="true"
    [scan.untracked]="false"
    [scan.cache_ttl]="300"

    [launch.terminal]="auto"
    [launch.resume_by_default]="true"
    [launch.trusted]=""
    [launch.extra_args]=""

    [new.root]="~/dev"
    [new.git_init]="true"
    [new.initial_commit]="true"
    [new.scaffold_claude_md]="true"
    [new.prompter]="auto"

    [ui.max_results]="12"
    [ui.anchor]="center"
  )
  cl_parse_toml "$CL_CONFIG_FILE"
}

cl_cfg()       { printf '%s' "${CL_CFG[$1]-${2-}}"; }
cl_cfg_bool()  { [[ "$(cl_cfg "$1" "${2-false}")" == "true" ]]; }
cl_cfg_lines() { local v="${CL_CFG[$1]-}"; [[ -n $v ]] && printf '%s\n' "$v"; }

# ── misc ────────────────────────────────────────────────────────────────────

cl_have() { command -v "$1" >/dev/null 2>&1; }

# Non-blocking write to the feed's command FIFO.
cl_send() {
  [[ -p $CL_FIFO ]] || return 0
  timeout 0.5 bash -c 'printf "%s\n" "$1" > "$2"' _ "$*" "$CL_FIFO" 2>/dev/null || true
}

cl_eww() {
  cl_have eww || cl_die "eww is not installed (see: claude-launcher doctor)"
  eww --config "$CL_EWW_DIR" "$@"
}

# Hyprland submap guard — every open/close path must leave the submap reset.
cl_submap() {
  cl_have hyprctl || return 0
  hyprctl dispatch submap "$1" >/dev/null 2>&1 || true
}

cl_record_recent() {
  local path="$1" tmp
  mkdir -p "$CL_STATE_DIR"
  tmp="$(mktemp "$CL_STATE_DIR/recent.XXXXXX")"
  {
    printf '%s\t%s\n' "$(date +%s)" "$path"
    [[ -f $CL_RECENT ]] && grep -vF "$(printf '\t%s' "$path")" "$CL_RECENT" 2>/dev/null | head -n 200
  } > "$tmp" || true
  mv -f "$tmp" "$CL_RECENT"
}
