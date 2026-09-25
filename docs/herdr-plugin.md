# Herdr plugin capabilities

Notes for working on Wayfinder Companion. Herdr does not ship a plugin SDK. A plugin is a directory with `herdr-plugin.toml` plus commands Herdr can launch. The plugin API is the Herdr CLI and the local socket API.

Re-check the installed binary before relying on a method or event name:

```sh
herdr api schema
herdr api schema --json
```

Official references:

- [Plugins](https://herdr.dev/docs/plugins/)
- [CLI reference](https://herdr.dev/docs/cli-reference/)
- [Socket API](https://herdr.dev/docs/socket-api/)
- [Marketplace](https://herdr.dev/docs/marketplace/)
- Example plugins: `ogulcancelik/herdr-plugin-examples`

This file was written against Herdr 0.9.1 and those docs. Prefer `herdr api schema` when they disagree.

## What a plugin is

Herdr owns install, manifest validation, keybindings, panes, events, invocation context, and socket access. The plugin owns its language, dependencies, files, and durable state.

Commands are argv arrays. Herdr does not run them through a shell. This repo uses `["bun", "src/main.ts", "<command>"]`. Bun must be on `PATH`. On Windows, action and event commands resolve `bun.cmd`; pane commands must still be a real Windows argv command.

Runtime commands start with the plugin directory as their cwd. That directory is the linked checkout or the managed GitHub checkout. It is not the user's project. Read `focused_pane_cwd`, then `workspace_cwd`, from `HERDR_PLUGIN_CONTEXT_JSON` before running `gh` or anything else that should follow the workspace.

A plugin runs as the user. It inherits the environment and can call the full CLI. Herdr does not sandbox or review plugin code.

## Manifest entrypoints

Required top-level fields are `id`, `name`, `version`, and `min_herdr_version`. Herdr refuses to link or install a plugin whose minimum version is newer than the running binary. This plugin requires `0.7.0`.

Plugin ids may contain ASCII letters, digits, `.`, `:`, `_`, and `-`. Action, pane, and link-handler ids are local and must not contain dots. Herdr qualifies actions as `wayfinder.companion.open`.

| Block | When it runs | Used here |
| --- | --- | --- |
| `[[build]]` | `herdr plugin install` only, before registration. No plugin env or socket env. | `bun install --frozen-lockfile` |
| `[[startup]]` | Once after session restore, when the API socket is ready, and again on live handoff. Not on client attach, config reload, link, or enable. One-shot: do the work and exit. Failure does not stop the server. | No |
| `[[actions]]` | `herdr plugin action invoke`, a keybinding, or a link handler. | `status`, `open` |
| `[[events]]` | When an enabled plugin's `on` name matches an emitted event. Unknown names link with a warning. | No |
| `[[panes]]` | `herdr plugin pane open` or an action that calls it. | `board`, the issue popup |
| `[[link_handlers]]` | Ctrl-click on a terminal URL whose Rust regex matches. `action` must be an action in the same plugin. | No |

`plugin link` does not run `[[build]]`. Install dependencies yourself while developing. There is no `plugin update` in v1. Reinstall from GitHub to refresh a managed checkout. `plugin unlink` unregisters a local plugin and leaves the files. Install over a linked plugin is refused.

Linked and installed plugins are global for the user and available in every session. `herdr plugin link` and `herdr plugin install` work while no server is running.

Changing `herdr-plugin.toml` after an install preview aborts that install. A linked manifest is re-read from its path. `plugin list` keeps a broken manifest and reports `warnings`.

## What the running command receives

Herdr injects:

| Variable | Meaning |
| --- | --- |
| `HERDR_BIN_PATH` | Running Herdr binary. Call this instead of a bare `herdr`. |
| `HERDR_SOCKET_PATH` | Unix socket, or a Windows named pipe. Prefer the CLI. |
| `HERDR_ENV` | `1` inside Herdr-managed processes. |
| `HERDR_PLUGIN_ID` | `wayfinder.companion` |
| `HERDR_PLUGIN_ROOT` | Plugin directory. Do not store config or state here. |
| `HERDR_PLUGIN_CONFIG_DIR` | User-editable config. `herdr plugin config-dir wayfinder.companion` prints it. |
| `HERDR_PLUGIN_STATE_DIR` | Plugin-owned runtime state. |
| `HERDR_PLUGIN_CONTEXT_JSON` | Invocation context. |
| `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID` | Set when that id exists for the invocation. |
| `HERDR_PLUGIN_ACTION_ID` | Action commands. |
| `HERDR_PLUGIN_EVENT`, `HERDR_PLUGIN_EVENT_JSON` | Startup and event hooks. Startup uses `HERDR_PLUGIN_EVENT=startup`. |
| `HERDR_PLUGIN_ENTRYPOINT_ID` | Pane commands. |
| `HERDR_PLUGIN_CLICKED_URL`, `HERDR_PLUGIN_LINK_HANDLER_ID` | Link-handler actions. |

`src/runtime.ts` parses the context fields this plugin uses and keeps the rest on `raw`. A live `status` invocation included:

- `workspace_id`, `workspace_label`, `workspace_cwd`
- `tab_id`, `tab_label`
- `focused_pane_id`, `focused_pane_cwd`, `focused_pane_agent`, `focused_pane_status`
- `invocation_source` (`cli` when invoked from the CLI)
- `correlation_id`

The docs also describe selected text, worktree provenance, clicked URL, and link-handler fields when that invocation has them. Do not assume every field is present.

Action invoke returns as soon as the command starts. Read stdout from `herdr plugin log list --plugin wayfinder.companion`.

## What a plugin can do

Anything `herdr ...` can do. Grouped by the socket API, which the CLI wraps:

- **Session structure.** Create, list, focus, rename, move, and close workspaces, tabs, and panes. Split, swap, resize, and zoom panes. Export and apply a tab layout. Create, open, and remove Git worktrees as workspaces.
- **Agents.** List, read, prompt, wait, focus, rename, and start agents. `agent prompt` can wait in the same call. A `blocked` agent rejects the prompt. Status values are `idle`, `working`, `blocked`, `done`, and `unknown`.
- **Terminal I/O.** Read a pane (`visible`, `recent`, `recent-unwrapped`, `detection`). Send text, keys, or a submitted command (`pane run`). Wait for output.
- **Presentation.** Show a toast with `herdr notification show`. Report display-only pane or workspace metadata and `$token` sidebar values. Set a transient Agents-view filter with `agent.view.set` using source `plugin:wayfinder.companion`. Reapply it from a startup hook if it should survive a server restart. Report semantic agent state with `pane report-agent` only when this plugin should own that lifecycle.
- **Other plugins and panes.** Invoke an action or open a manifest pane. Focus or close a normal plugin pane. Close the active popup with `popup.close`.
- **Events.** Subscribe on the socket for a live stream, or declare a short-lived `[[events]]` hook. Hooks are not daemons.
- **Graphics.** `pane.graphics.*` can place images over a real pane when Kitty graphics are enabled. A popup is not a target for pane APIs.

Keybindings are user config, not manifest fields:

```toml
[[keys.command]]
key = "prefix+g"
type = "plugin_action"
command = "wayfinder.companion.open"
description = "open wayfinder companion"
```

Link handlers intercept Ctrl-click. The modifier is Control on every platform, including macOS. The pattern is a Rust regex. The handler runs one of this plugin's actions with `invocation_source = "link_click"`.

Marketplace listing is the GitHub topic `herdr-plugin` on a public repo whose default branch has a parseable `herdr-plugin.toml`. Install with `herdr plugin install owner/repo`.

## Panes

`placement` is `overlay` by default. `plugin pane open` can override it with `overlay`, `popup`, `split`, `tab`, or `zoomed`.

This plugin's `board` entrypoint is a `popup` at `80%` by `70%`. A popup is session-modal. It takes terminal input, including Escape, and closes when the process exits or `popup.close` is sent. It has no pane id, emits no pane events, and is outside pane, layout, persistence, and agent APIs. The process does not get `HERDR_PANE_ID`. The underlying tiled pane is still in `HERDR_PLUGIN_CONTEXT_JSON`. Opening a popup returns `ui_busy` while Settings, copy mode, or another modal is open.

`overlay`, `split`, `tab`, and `zoomed` panes are normal Herdr panes after they open. They can be moved, resized, and zoomed, and plugin ownership follows the pane.

The issue UI is an ordinary terminal program: alternate screen, raw mode, and `q` to exit. Herdr does not provide a native widget toolkit in plugin v1.

## Events a hook can name

Herdr checks `on` against known event names at link time. A typo links with a warning and then never runs. Documented lifecycle names:

- Workspace: `workspace.created`, `workspace.updated`, `workspace.renamed`, `workspace.moved`, `workspace.reordered`, `workspace.closed`, `workspace.focused`
- Tab: `tab.created`, `tab.closed`, `tab.focused`, `tab.renamed`, `tab.moved`
- Pane: `pane.created`, `pane.updated`, `pane.closed`, `pane.focused`, `pane.moved`, `pane.exited`, `pane.agent_detected`, `pane.output_matched`, `pane.agent_status_changed`, `pane.scroll_changed`
- Layout: `layout.updated`
- Worktree: `worktree.created`, `worktree.opened`, `worktree.removed`

`workspace.metadata_updated` is a socket subscription only. It does not invoke plugin hooks. Confirm new names with `herdr api schema` or the `warnings` field from `herdr plugin link`.

## Not in plugin v1

- A plugin SDK or a restricted command subset.
- Registering actions or pane commands at runtime. Declare them in the manifest.
- A native non-terminal UI. Panes are terminal programs. Graphics over a real pane are separate.
- Herdr-managed storage. Config and state directories are paths only. This plugin owns the files.
- A sandbox, review, or secret store.
- A `plugin update` command.
- A long-running supervised plugin process. Startup and event hooks should exit. A popup lives only while its command runs.
- Shell expansion in `command` arrays.

## How this repo uses the surface

`open` asks Herdr to launch the `board` pane. `ui` is that pane. It resolves the repo directory from the context, then runs `gh` there. `status` prints the context plus `herdr workspace list` and `herdr agent list`, which is the debug view of the same invocation.

`src/herdr.ts` is the CLI wrapper. `src/github/issues.ts` is the `gh` wrapper. Neither talks to the socket directly. Use the CLI unless a later feature needs a subscription, graphics, or a method the CLI does not expose.
