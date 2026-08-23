#!/usr/bin/env bash
# scan.sh — walk the configured roots and cache a JSON list of projects.
set -uo pipefail

cl_scan_main() {
  local print_only=0
  [[ ${1-} == "--print" ]] && print_only=1

  cl_dirs
  cl_load_config

  # One scan at a time; a second caller just uses the cache.
  exec 9>"$CL_LOCK"
  if ! flock -n 9; then
    [[ $print_only -eq 1 && -f $CL_CACHE_FILE ]] && cat "$CL_CACHE_FILE"
    return 0
  fi

  local depth; depth="$(cl_cfg scan.depth 3)"
  local do_git=1; cl_cfg_bool scan.git_status true || do_git=0
  local untracked="no"; cl_cfg_bool scan.untracked false && untracked="normal"

  # ── sets we consult per repo ───────────────────────────────────────────────
  declare -A hidden=() pinned_rank=() trusted=() mru=()
  local line i=0

  while IFS= read -r line; do
    [[ -n $line ]] && hidden["$(cl_expand "$line")"]=1
  done < <(cl_cfg_lines scan.hidden)

  while IFS= read -r line; do
    [[ -n $line ]] || continue
    pinned_rank["$(cl_expand "$line")"]=$(( i++ ))
  done < <(cl_cfg_lines scan.pinned)

  while IFS= read -r line; do
    [[ -n $line ]] && trusted["$(cl_expand "$line")"]=1
  done < <(cl_cfg_lines launch.trusted)

  if [[ -f $CL_RECENT ]]; then
    local ts path
    while IFS=$'\t' read -r ts path; do
      [[ -n ${path-} && -z ${mru[$path]-} ]] && mru["$path"]="$ts"
    done < "$CL_RECENT"
  fi

  # Claude keeps per-project session logs under ~/.claude/projects/<mangled-cwd>.
  # The mangling has varied between versions, so index the directory once and
  # probe a couple of plausible keys per repo rather than guessing one scheme.
  declare -A sessions=()
  local projdir="$HOME/.claude/projects" d newest
  if [[ -d $projdir ]]; then
    for d in "$projdir"/*/; do
      [[ -d $d ]] || continue
      newest="$(find "$d" -maxdepth 1 -name '*.jsonl' -printf '%T@\n' 2>/dev/null \
                | sort -rn | head -1)"
      [[ -n $newest ]] && sessions["$(basename "$d")"]="${newest%%.*}"
    done
  fi

  # ── collect candidate repos ────────────────────────────────────────────────
  local -a repos=()
  local root rp
  while IFS= read -r root; do
    [[ -n $root ]] || continue
    rp="$(cl_expand "$root")"
    [[ -d $rp ]] || continue
    if cl_have fd; then
      while IFS= read -r line; do repos+=("${line%/.git}"); done < <(
        fd --hidden --no-ignore --type d --max-depth $(( depth + 1 )) \
           --absolute-path '^\.git$' "$rp" 2>/dev/null | sed 's#/$##'
      )
    else
      while IFS= read -r line; do repos+=("${line%/.git}"); done < <(
        find "$rp" -maxdepth $(( depth + 1 )) -type d -name .git -prune -print 2>/dev/null
      )
    fi
  done < <(cl_cfg_lines scan.roots)

  # ── one TSV row per repo, converted to JSON in a single jq pass ────────────
  local tsv; tsv="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$tsv'" RETURN

  local dir name branch dirty mtime lang lang_class sess key1 key2 pin trust m
  for dir in "${repos[@]}"; do
    [[ -d $dir ]] || continue
    [[ -n ${hidden[$dir]-} ]] && continue

    name="$(basename "$dir")"
    branch=""; dirty=0; mtime=0

    if [[ $do_git -eq 1 ]]; then
      branch="$(git -C "$dir" --no-optional-locks symbolic-ref --quiet --short HEAD 2>/dev/null)" \
        || branch="$(git -C "$dir" --no-optional-locks rev-parse --short HEAD 2>/dev/null)" \
        || branch=""
      dirty="$(git -C "$dir" --no-optional-locks status --porcelain \
                 --untracked-files="$untracked" 2>/dev/null | grep -c . || true)"
      mtime="$(git -C "$dir" --no-optional-locks log -1 --format=%ct 2>/dev/null || echo 0)"
    fi
    [[ -z $mtime || $mtime == 0 ]] && mtime="$(stat -c %Y "$dir" 2>/dev/null || echo 0)"

    read -r lang lang_class <<< "$(_cl_detect_lang "$dir")"

    # Probe both mangling schemes Claude Code has used for session dirs.
    key1="${dir//\//-}"
    key2="$(printf '%s' "$dir" | tr -c 'a-zA-Z0-9' '-')"
    sess="${sessions[$key1]-${sessions[$key2]-}}"

    pin="null";   [[ -n ${pinned_rank[$dir]-} ]] && pin="${pinned_rank[$dir]}"
    trust="false"; [[ -n ${trusted[$dir]-} ]] && trust="true"
    m="${mru[$dir]-0}"

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "${name//$'\t'/ }" "${dir//$'\t'/ }" "$(cl_shorten "$dir")" \
      "$branch" "${dirty:-0}" "${mtime:-0}" "$lang" "$lang_class" \
      "${sess:+true}" "$pin" "$trust" "$m" >> "$tsv"
  done

  local json
  json="$(jq -R -s -c '
    split("\n") | map(select(length > 0)) | map(split("\t")) | map({
      name:       .[0],
      path:       .[1],
      path_short: .[2],
      branch:     .[3],
      dirty:      (.[4] | tonumber? // 0),
      mtime:      (.[5] | tonumber? // 0),
      lang:       .[6],
      lang_class: .[7],
      session:    (.[8] == "true"),
      pinned:     (.[9] != "null"),
      pin_rank:   (.[9] | tonumber? // 9999),
      trusted:    (.[10] == "true"),
      mru:        (.[11] | tonumber? // 0)
    }) | sort_by(.pin_rank)
  ' "$tsv" 2>/dev/null)" || json=""

  [[ -z $json ]] && json="[]"
  printf '%s\n' "$json" > "$CL_CACHE_FILE.tmp" && mv -f "$CL_CACHE_FILE.tmp" "$CL_CACHE_FILE"
  [[ $print_only -eq 1 ]] && printf '%s\n' "$json"
  return 0
}

# Echoes "<badge> <css-suffix>" for a project directory.
_cl_detect_lang() {
  local d="$1"
  if   [[ -f $d/Cargo.toml ]];       then echo "RS rs"
  elif [[ -f $d/go.mod ]];           then echo "GO go"
  elif [[ -f $d/tsconfig.json ]];    then echo "TS ts"
  elif [[ -f $d/pyproject.toml || -f $d/requirements.txt || -f $d/setup.py || -f $d/Pipfile ]]; then echo "PY py"
  elif [[ -f $d/package.json ]];     then echo "JS js"
  elif [[ -f $d/pubspec.yaml ]];     then echo "DA dart"
  elif [[ -f $d/Gemfile ]];          then echo "RB rb"
  elif [[ -f $d/composer.json ]];    then echo "PH php"
  elif [[ -f $d/pom.xml || -f $d/build.gradle || -f $d/build.gradle.kts ]]; then echo "JV java"
  elif [[ -f $d/flake.nix || -f $d/default.nix ]]; then echo "NX nix"
  elif [[ -f $d/CMakeLists.txt || -f $d/Makefile ]]; then echo "C c"
  elif compgen -G "$d/*.sh" >/dev/null 2>&1; then echo "SH sh"
  else echo "•• git"
  fi
}

# Refresh in the background when the cache is older than cache_ttl.
cl_scan_if_stale() {
  local ttl age now
  ttl="$(cl_cfg scan.cache_ttl 300)"
  now="$(date +%s)"
  if [[ -f $CL_CACHE_FILE ]]; then
    age=$(( now - $(stat -c %Y "$CL_CACHE_FILE" 2>/dev/null || echo 0) ))
    (( age < ttl )) && return 0
  fi
  ( cl_scan_main >/dev/null 2>&1 & ) &
  return 0
}
