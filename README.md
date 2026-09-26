# Wayfinder Companion

A [Herdr](https://herdr.dev) plugin that lists the current repo's GitHub issues in a split pane. Wayfinder maps are the roots, and the other tickets sit underneath them. The plugin id is `wayfinder.companion`.

Herdr launches the commands in `herdr-plugin.toml`. This package is TypeScript run by [Bun](https://bun.sh). There is no compile step: `bun src/main.ts` is the entrypoint. The issue list comes from the GitHub CLI (`gh`), run in the focused pane's directory, or the workspace directory when the pane has none.

Requires Herdr `0.7.0` or newer, `bun` on `PATH`, and an authenticated `gh`.

## Develop

```sh
bun install
bun test
bun run typecheck
herdr plugin link "$PWD"
herdr plugin action invoke wayfinder.companion.status
herdr plugin action invoke wayfinder.companion.open
```

`plugin link` does not run the manifest build. Install dependencies yourself before linking. `plugin unlink wayfinder.companion` unregisters the local checkout and leaves this directory alone.

## Install

From GitHub, once this repository is public:

```sh
herdr plugin install <owner>/herdr-wayfinder-companion
```

Install runs `bun install --frozen-lockfile`, then registers the plugin. Add the GitHub topic `herdr-plugin` to list it in the [marketplace](https://herdr.dev/plugins/).

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
key = "prefix+g"
type = "plugin_action"
command = "wayfinder.companion.open"
description = "open wayfinder companion"
```

Config and state directories are created by Herdr. `herdr plugin config-dir wayfinder.companion` prints the config path. Keep credentials there, not in this checkout.
