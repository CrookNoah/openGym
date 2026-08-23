# filter.jq — score, sort, slice and format the project list for the widget.
#
#   in:  the raw array from projects.json
#   out: { query, selected, count, items: [...] }  (one render's worth of state)
#
# args: --arg query  --argjson selected  --argjson limit

def subseq($n; $q):
  if ($q | length) == 0 then true
  else
    ($n | explode) as $nc
    | (reduce ($q | explode)[] as $c ({i: 0, ok: true};
        if .ok then
          ($nc[.i:] | index($c)) as $j
          | if $j == null then .ok = false else .i = (.i + $j + 1) end
        else . end))
      | .ok
  end;

# Higher is better; -1 means "does not match at all".
def score($n; $p; $q):
  if $q == ""                  then 0
  elif ($n | startswith($q))   then 1000 - ($n | length)
  elif ($n | contains($q))     then  800 - ($n | length)
  elif ($p | contains($q))     then  600
  elif subseq($n; $q)          then  400 - ($n | length)
  elif subseq($p; $q)          then  200
  else -1 end;

def ago($t):
  if ($t | type) != "number" or $t <= 0 then ""
  else
    (now - $t) as $d
    | if   $d < 120     then "now"
      elif $d < 3600    then "\(($d / 60)      | floor)m"
      elif $d < 86400   then "\(($d / 3600)    | floor)h"
      elif $d < 604800  then "\(($d / 86400)   | floor)d"
      elif $d < 2592000 then "\(($d / 604800)  | floor)w"
      else                   "\(($d / 2592000) | floor)mo"
      end
  end;

# "⎇ main  ✓"  /  "⎇ feat/sets  ●3"  /  bare path when it is not a repo
def meta:
  if .branch == "" then .path_short
  else "⎇ \(.branch)" + (if .dirty > 0 then "  ●\(.dirty)" else "  ✓" end)
  end;

($query | ascii_downcase) as $q

| [ .[]
    | . as $it
    | ($it.name | ascii_downcase) as $n
    | ($it.path | ascii_downcase) as $p
    | $it + { score: score($n; $p; $q) } ]
| map(select(.score >= 0))
| sort_by([ (if .pinned then 0 else 1 end), (- .score), (- .mru), (- .mtime) ])

| length as $matched
| .[0:$limit]

# Shape each surviving row into exactly what the widget renders.
| [ .[]
    | { kind:       "project",
        name:       .name,
        path:       .path,
        lang:       .lang,
        lang_class: ("lang-" + .lang_class),
        meta:       meta,
        ago:        ago(if .mru > .mtime then .mru else .mtime end),
        badge:      (if .session then "↩" else "" end),
        trusted:    .trusted } ]

# The "New project…" row is the last selectable entry.
| . + [ { kind:       "new",
          name:       "New project…",
          path:       "",
          lang:       "+",
          lang_class: "lang-new",
          meta:       "",
          ago:        "",
          badge:      "",
          trusted:    false } ]

| length as $count
| (if   $selected < 0       then 0
   elif $selected >= $count then $count - 1
   else $selected end) as $sel

| { query:    $query,
    selected: $sel,
    count:    $matched,
    items:    [ to_entries[]
                | .value + { index: .key,
                             cls: ("row " + .value.kind
                                   + (if .key == $sel then " sel" else "" end)) } ] }
