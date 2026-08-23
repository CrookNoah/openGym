# claude-launcher

A keybind-summoned project picker for the Claude CLI, built for [Omarchy](https://omarchy.org).

Hit `SUPER+A` anywhere. A frosted panel floats over your desktop with your git
repos in it — most recent first, branch and dirty state on every row. Type a few
letters, press enter, and a terminal opens in that repo with Claude already
running. No `cd`, no remembering paths, no flags.

```
  ✻  Launch Claude                              6 projects
  ┌──────────────────────────────────────────────────────┐
  │ ⌕  gym                                               │
  └──────────────────────────────────────────────────────┘
  ▍ TS   openGym            ⎇ main  ✓              ↩  2h
    GO   gym-tracker        ⎇ feat/sets  ●3           3d
    PY   meal-api           ⎇ main  ✓                 1w
    ───────────────────────────────────────────────────
    +    New project…
  ↑↓ nav   ↵ open   ⇧↵ fresh   esc close       omarchy
```

## What it does

- **Fuzzy project search** — subsequence matching over names and paths, so `ogym`
  and `dtf` both find what you mean.
- **Live git state** — branch, plus `✓` clean or `●3` dirty, on every row. You can
  see which repos have work in progress before opening one.
- **Resume or start fresh** — a `↩` marks projects with a previous Claude session.
  `Enter` picks it up where you left off, `Shift+Enter` starts clean.
- **Most-recently-used ordering** — the repo you touched last is already selected,
  so the common case is one keypress.
- **New projects** — scaffold a folder, `git init`, optional language template and
  a starter `CLAUDE.md`, then drop straight into Claude.
- **Follows your Omarchy theme** — the palette is read from the active theme, so it
  restyles itself when you switch themes.

## Install

```bash
git clone <this-repo> ~/src/claude-launcher
cd ~/src/claude-launcher
./install.sh
```

The installer links `claude-launcher` into `~/.local/bin`, copies the eww config
to `~/.config/claude-launcher/eww`, writes a starter `config.toml`, syncs the
palette, and offers to add the `SUPER+A` keybind to your Hyprland config
(it backs up `bindings.conf` first, and `--no-hypr` skips it entirely).

Then check everything is wired up:

```bash
claude-launcher doctor
```

### Requirements

**Required:** `eww`, `jq`, `git`, `claude`, and a terminal
(`alacritty`, `ghostty`, `kitty`, `foot` and `wezterm` are auto-detected).

**Optional:** `hyprctl` for keyboard navigation, `fd` for much faster scanning,
`walker`/`fuzzel`/`wofi`/`rofi`/`gum` for the New-project prompts, `notify-send`
for error toasts.

On Omarchy: `yay -S eww fd` covers what isn't already there.

## Keys

| Key | Action |
|---|---|
| `SUPER+A` | summon / dismiss |
| type | filter |
| `↑` `↓` (or `Ctrl+J/K`, `Ctrl+N/P`) | move selection |
| `Enter` | open — resuming the last session if there is one |
| `Shift+Enter` | open with a fresh session |
| `Ctrl+R` | rescan projects |
| `Esc` | dismiss |
| click / middle-click | open / open fresh |

Keyboard navigation runs through a Hyprland submap (`hypr/claude-launcher.conf`):
opening the widget enters it, the keys above are captured, and everything else
falls through to the search field. Every exit path resets the submap, so the
keyboard can't get stuck.

## Configuration

`~/.config/claude-launcher/config.toml` — see
[`config/config.toml.example`](config/config.toml.example) for every option with
comments. The ones worth knowing:

```toml
[scan]
roots  = ["~/dev", "~/work"]   # where to look for repos
pinned = ["~/dev/openGym"]     # always at the top
hidden = []                    # never show these

[launch]
terminal = "auto"
trusted  = []                  # launch these with --dangerously-skip-permissions
```

`trusted` is off by default and worth leaving that way: repos listed there skip
Claude's permission prompts entirely, so it will edit files and run commands
without asking.

## Commands

```
claude-launcher toggle          summon / dismiss  (this is the one you bind)
claude-launcher new             scaffold a project, then launch it
claude-launcher launch <path>   skip the UI, open one project
claude-launcher scan --print    rebuild the project cache and dump it
claude-launcher theme           re-sync colours from the active Omarchy theme
claude-launcher doctor          check dependencies, paths and roots
```

## How it works

```
SUPER+A ──▶ claude-launcher toggle
              ├─▶ eww opens the window, enters the Hyprland submap
              └─▶ eww runs `claude-launcher feed` as a deflisten
                        │
    scan ──▶ projects.json ──▶ filter.jq ──▶ one JSON blob per render
                        ▲                         │
    ctl (keys/clicks) ──┘                         ▼
                                            the widget redraws
              Enter ──▶ ctl open ──▶ terminal + claude, in the repo
```

All list state — the query, the selection, every formatted string — is computed
in the shell and handed to eww as a single JSON object. The yuck stays purely
declarative and there is exactly one place that decides what is selected, which
is what keeps arrow keys, clicks and filtering from disagreeing.

Project scanning is cached (`~/.cache/claude-launcher/projects.json`) and
refreshed in the background when it goes stale, so summoning stays instant even
with a lot of repos. Recently-used projects are tracked in
`~/.local/state/claude-launcher/recent.tsv`.

### Notes and limits

- **eww version.** Built against eww 0.4–0.6. On 0.6+ you may see a deprecation
  warning about `:focusable true`; change it to `:focusable "exclusive"` in
  `eww.yuck` to silence it.
- **The blur** comes from the `layerrule` in the Hyprland config, not from the
  stylesheet — GTK3 CSS has no `backdrop-filter`.
- **Session detection** reads `~/.claude/projects/`, whose directory-naming has
  changed between Claude Code versions. Two known schemes are probed; if the `↩`
  badge never appears, that's why, and `Enter` simply starts a fresh session.
- **This launches the CLI, it does not replace it.** Claude still runs in a real
  terminal with all its own UI — the widget's job is picking the project.

## Uninstall

```bash
./uninstall.sh           # keeps config.toml
./uninstall.sh --purge   # removes everything
```

## Layout

```
bin/claude-launcher      single entry point, dispatches subcommands
libexec/
  common.sh              paths, TOML parsing, shared helpers
  scan.sh                repo discovery, git state, language detection
  filter.jq              fuzzy scoring, sorting, display formatting
  feed.sh                the deflisten daemon — owns query and selection
  ctl.sh                 commands from the widget and the submap
  launch.sh              terminal detection, building the claude invocation
  window.sh              eww window + Hyprland submap lifecycle
  new.sh                 new-project scaffolding
  theme.sh               Omarchy palette extraction
  doctor.sh              dependency and configuration checks
eww/                     the widget: eww.yuck, eww.scss, theme.scss
hypr/                    keybind, submap and layerrules
```
