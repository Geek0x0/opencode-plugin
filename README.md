# opencode-llm-stats-sidebar

OpenCode TUI sidebar plugin for LLM request statistics.

This follows the same packaging pattern as `opencode-agents-sidebar`:

- `package.json` contains `"oc-plugin": ["tui"]`
- `exports["."]` points to the server plugin
- `exports["./tui"]` points to the TUI sidebar plugin
- the TUI plugin registers `sidebar_content` through `api.slots.register`

## What It Shows

The sidebar panel displays:

- request count
- active sessions
- errors
- input tokens
- output tokens
- total tokens
- total cost, if OpenCode/provider events expose cost
- top model
- recent requests

The server plugin writes state to:

```text
.opencode/llm-request-stats.json
```

The TUI plugin polls and watches that file, then renders it in the right sidebar.

## Requirements

- OpenCode `>= 1.14.49`
- `@opencode-ai/plugin >= 1.4.0`
- TUI runtime with `@opentui/solid` and `solid-js`

These are the same kinds of requirements used by `opencode-agents-sidebar`.

## Install

Use OpenCode's package/plugin installer. This is required for the TUI sidebar entry to load:

```bash
opencode plugin "file:/absolute/path/to/opencode-llm-stats-sidebar" --global --force
```

Example:

```bash
opencode plugin "file:/workspace/opencode-llm-stats-sidebar" --global --force
```

Then restart OpenCode in your project.

## Do Not Install This Way For Sidebar

This will only load ordinary server hooks and will not load the TUI sidebar:

```bash
cp dist/index.js .opencode/plugins/
```

For real sidebar display, install the package with `opencode plugin "file:..."`.

## Optional Command

The package still provides a server tool named:

```text
llm_request_stats
```

If you also copy `.opencode/commands/llm-stats.md` into your project or global config, you can type:

```text
/llm-stats
```

This is only a fallback display path. The main display is the sidebar.

## Reset Stats

Close OpenCode, then remove:

```bash
rm .opencode/llm-request-stats.json
```

Restart OpenCode and the counter starts from zero.

## Files

```text
dist/index.js      server plugin: listens to events and writes stats
dist/tui.js        TUI plugin: registers sidebar_content and renders stats
package.json       OpenCode plugin package metadata
.opencode/commands/llm-stats.md  optional fallback command
```

## Troubleshooting

If the sidebar does not appear:

1. Confirm you installed with `opencode plugin "file:/absolute/path" --global --force`.
2. Restart OpenCode after installing.
3. Confirm OpenCode is at least `v1.14.49`.
4. Check logs under `~/.local/share/opencode/log/`.
5. Confirm `.opencode/llm-request-stats.json` appears after one LLM request.

