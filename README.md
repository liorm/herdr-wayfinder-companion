# Wayfinder Companion

A [Herdr](https://herdr.dev) plugin that lists the current repo's GitHub issues in a split pane. Wayfinder maps are the roots, and the other tickets sit underneath them. The plugin id is `wayfinder.companion`.

Herdr launches the commands in `herdr-plugin.toml` via `bin/run`. On plugin install, `bin/build` verifies prerequisites (`gh` and `bun`), installs dependencies, and compiles a standalone binary `dist/wayfinder-companion`. In development, `bin/run` can also run `bun src/main.ts` directly. The issue list comes from the GitHub CLI (`gh`), run in the focused pane's directory, or the workspace directory when the pane has none.

Requires Herdr `0.7.0` or newer, `bun` (during install/build), and an authenticated `gh`.

## Develop

```sh
bun install
bun run build
bun test
bun run typecheck
bun run lint
bun run lint:fix
bun run format
bun run format:check
herdr plugin link "$PWD"
herdr plugin action invoke wayfinder.companion.status
herdr plugin action invoke wayfinder.companion.open
```

`plugin link` does not run the manifest build. Install dependencies and optionally build the binary before linking. `plugin unlink wayfinder.companion` unregisters the local checkout and leaves this directory alone.

## Install

```sh
herdr plugin install liorm/herdr-wayfinder-companion
```

Install verifies required binaries (`gh`, `bun`), runs `bun install --frozen-lockfile`, compiles the standalone executable to `dist/wayfinder-companion`, and registers the plugin. Add the GitHub topic `herdr-plugin` to list it in the [marketplace](https://herdr.dev/plugins/).

## Actions

| Action | What it does |
| --- | --- |
| `status` | Prints JSON with the invocation context, `herdr workspace list`, and `herdr agent list`. |
| `open` | Opens the issue list for the current workspace's GitHub repo. |

Inside the pane, each `wayfinder:map` issue is a root. Children are issues whose body says `Part of #<map>`. A row's badges are its wayfinder state: `grilling`, `research`, `prototype`, `task`, or `delivery` (`ready-for-agent`), then `closed`, `blocked`, `in progress` plus the assignee when someone has claimed it, or `frontier` when an open decision ticket is unassigned and not blocked.

The list colors that work state. In progress is green, blocked is red, frontier is cyan, an unblocked `ready-for-agent` or `ready-for-human` ticket is magenta, `needs-triage` and `needs-info` are yellow, maps are blue, and closed rows are dim. The selected row stays inverted.

| Key | Action |
| --- | --- |
| `j` / `k` | Move through the list, or scroll an open issue |
| enter | Show the issue and its comments |
| esc | Return to the list from an open ticket |

An open ticket scrolls in every row above its footer, `j/k scroll   esc back`. Esc closes the ticket and returns to the list.
| `f` | Cycle open, closed, and all issues |
| `r` | Refresh |
| `q` | Close the pane |

Bind `open` in the Herdr config:

```toml
[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "wayfinder.companion.open"
description = "open wayfinder companion"
```

Config and state directories are created by Herdr. `herdr plugin config-dir wayfinder.companion` prints the config path. Keep credentials there, not in this checkout.
