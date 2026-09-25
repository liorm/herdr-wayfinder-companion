# Wayfinder Companion

Herdr plugin `wayfinder.companion`. It lists GitHub issues for the current workspace in a popup. The code is TypeScript run by Bun, with no compile step.

Read [docs/herdr-plugin.md](docs/herdr-plugin.md) before adding actions, panes, events, or Herdr CLI calls. It records what a Herdr plugin can do, what plugin v1 does not provide, and how this repo uses that surface.

## Layout

- `herdr-plugin.toml` declares the actions and the popup. Herdr runs `bun src/main.ts`.
- `src/main.ts` routes `status`, `open`, and `ui`.
- `src/runtime.ts` reads the Herdr environment and invocation context.
- `src/herdr.ts` calls the Herdr CLI through `HERDR_BIN_PATH`.
- `src/github/issues.ts` runs `gh` and parses its JSON.
- `src/ui/` draws the popup and handles keys.
- `test/fixtures/gh` is a fake `gh` used by the pane test.

## Checks

```sh
bun install
bun test
bun run typecheck
```

`herdr plugin link` does not run the manifest build. Install dependencies before linking.

## Working on the plugin

Run `gh` in the focused pane directory, then the workspace directory. Herdr starts the process with the plugin root as its cwd, so a bare `gh` call lists this repo.

Call Herdr with `HERDR_BIN_PATH`. Keep credentials out of the checkout. User config belongs in `HERDR_PLUGIN_CONFIG_DIR`.

The popup closes when the process exits. `q` must exit cleanly and restore the terminal.
