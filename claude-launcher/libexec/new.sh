#!/usr/bin/env bash
# new.sh — scaffold a project, then hand it to Claude.
#
# eww has no real dialog widget, so the prompts run through whatever dmenu-ish
# tool is around (Omarchy ships walker) and fall back to a terminal + gum.
set -uo pipefail

_cl_pick_prompter() {
  local want; want="$(cl_cfg new.prompter auto)"
  if [[ $want != "auto" ]]; then printf '%s' "$want"; return; fi
  local p
  for p in walker fuzzel wofi rofi; do
    cl_have "$p" && { printf '%s' "$p"; return; }
  done
  cl_have gum && { printf '%s' "gum"; return; }
  printf '%s' "none"
}

# _cl_prompt <prompt> [menu items on stdin] -> chosen/typed text on stdout
_cl_prompt() {
  local prompt="$1" prompter; prompter="$(_cl_pick_prompter)"
  case "$prompter" in
    walker) walker --dmenu --placeholder "$prompt" 2>/dev/null ;;
    fuzzel) fuzzel --dmenu --prompt "$prompt " 2>/dev/null ;;
    wofi)   wofi --dmenu --prompt "$prompt" 2>/dev/null ;;
    rofi)   rofi -dmenu -p "$prompt" 2>/dev/null ;;
    gum)    cat >/dev/null; gum input --placeholder "$prompt" 2>/dev/null ;;
    *)      cat >/dev/null; return 1 ;;
  esac
}

cl_new_main() {
  cl_dirs
  cl_load_config

  local name
  name="$(printf '' | _cl_prompt "Project name")" || {
    cl_notify "No prompter found — install walker, fuzzel, wofi, rofi or gum."
    return 1
  }
  name="$(_cl_trim "${name:-}")"
  [[ -z $name ]] && return 0

  # Keep it to something safe for a directory and a git remote later.
  local slug; slug="$(printf '%s' "$name" | tr ' ' '-' | tr -cd 'a-zA-Z0-9._-')"
  [[ -z $slug ]] && { cl_notify "That name has no usable characters."; return 1; }

  local template
  template="$(printf '%s\n' \
      "empty — folder + git" \
      "node — package.json" \
      "python — pyproject.toml + venv" \
      "rust — cargo init" \
      "go — go mod init" \
      "clone — from a git URL" \
    | _cl_prompt "Start from")" || true
  template="${template%% *}"
  [[ -z $template ]] && template="empty"

  local root dir
  root="$(cl_expand "$(cl_cfg new.root '~/dev')")"
  dir="$root/$slug"

  if [[ -e $dir ]]; then
    cl_notify "$slug already exists — opening it instead."
    cl_launch_project "$dir" ""
    return 0
  fi

  if [[ $template == "clone" ]]; then
    local url
    url="$(printf '' | _cl_prompt "Git URL")" || return 1
    url="$(_cl_trim "${url:-}")"
    [[ -z $url ]] && return 0
    mkdir -p "$root"
    git clone "$url" "$dir" >/dev/null 2>&1 \
      || { cl_notify "Clone failed: $url"; return 1; }
  else
    mkdir -p "$dir" || { cl_notify "Could not create $dir"; return 1; }
    _cl_scaffold "$dir" "$slug" "$template"
  fi

  cl_launch_project "$dir" "--fresh"
}

_cl_scaffold() {
  local dir="$1" slug="$2" template="$3"

  printf '# %s\n' "$slug" > "$dir/README.md"

  case "$template" in
    node)
      printf 'node_modules/\ndist/\n.env\n' > "$dir/.gitignore"
      ( cd "$dir" && npm init -y >/dev/null 2>&1 ) || true
      ;;
    python)
      printf '__pycache__/\n*.pyc\n.venv/\n.env\n' > "$dir/.gitignore"
      cat > "$dir/pyproject.toml" <<EOF
[project]
name = "$slug"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = []
EOF
      ( cd "$dir" && python3 -m venv .venv >/dev/null 2>&1 ) || true
      ;;
    rust)
      ( cd "$dir" && cargo init --name "$slug" >/dev/null 2>&1 ) || true
      ;;
    go)
      printf 'bin/\n' > "$dir/.gitignore"
      ( cd "$dir" && go mod init "$slug" >/dev/null 2>&1 ) || true
      ;;
    *)
      printf '.env\n' > "$dir/.gitignore"
      ;;
  esac

  if cl_cfg_bool new.scaffold_claude_md true && [[ ! -f $dir/CLAUDE.md ]]; then
    cat > "$dir/CLAUDE.md" <<EOF
# $slug

## What this is
<!-- one or two lines so Claude has context on every session -->

## Commands
<!-- build / test / run — the things worth knowing before touching code -->

## Conventions
<!-- anything you want followed without being asked each time -->
EOF
  fi

  if cl_cfg_bool new.git_init true && [[ ! -d $dir/.git ]]; then
    git -C "$dir" init -q >/dev/null 2>&1 || return 0
    if cl_cfg_bool new.initial_commit true; then
      git -C "$dir" add -A >/dev/null 2>&1 || true
      git -C "$dir" commit -qm "Initial commit" >/dev/null 2>&1 || true
    fi
  fi
}

cl_notify() {
  if cl_have notify-send; then
    notify-send -a "Claude Launcher" "Claude Launcher" "$*" || true
  else
    printf '%s\n' "$*" >&2
  fi
}
