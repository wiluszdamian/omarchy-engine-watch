# Usage

## The bar icon

| Button | Action |
|---|---|
| Left | Opens and closes the panel |
| Right | Opens the engine in the browser |
| Middle | Switches engine (when you have several) |

A dimmed icon means the engine is not answering or not configured. A red dot on the icon means a project failed, an orange dot means one is deploying. Hovering shows a short summary.

## The panel

At the top: the engine address, its version and web server, and bars for CPU, RAM and disk. A bar turns amber at 75% and red at 90%. Under them are the **Assistants**, **Update** (update the engine) and **Settings** buttons. Below is **+ Engine**, and with several engines, one button per engine to switch between them.

Then the project list. The colour of the dot is the state: green is running, orange is deploying, yellow is partial, red is failed, grey is stopped or suspended.

Select a project (Enter or click) to see its buttons and details: repository, domains, deploy phases, containers and databases.

### Project actions

| Action | Asks for confirmation |
|---|---|
| Redeploy | yes |
| Cancel (stops a running deploy) | yes |
| Restart, Start | no |
| Stop | yes |
| Suspend | yes |
| Unsuspend, Open | no |
| Delete | yes, removes files, containers and databases |
| Logs, App log, Check | no (they open a view, go back with **Back**) |

Restart, Stop, Start, logs and Check apply to projects with containers. A classic account (Apache/PHP) can be suspended or rebuilt, without the Docker buttons.

A redeploy lasts until the deploy finishes (up to 15 minutes). Meanwhile the row shows the status and the deploy log reports `running`.

### Assistant tokens (MCP)

**Assistants** (or `a`) lists the tokens your AI assistants use to talk to this engine over MCP: name, when it was created and last used, and whether it is revoked.

- **New token** (or `n`): type a name and press Enter. The engine shows the token once. The panel shows it with the command that connects the assistant you pick (Claude Code, Codex, Gemini CLI, Grok Build, OpenCode, VS Code, Windsurf, OpenClaw, Hermes, or a JSON config for Cursor, Pi and others). **Copy command** (or `c`) and **Copy token** (or `y`) put it on the clipboard. **Done** clears it from the panel.
- **Revoke** (`v`) stops a token from working and keeps it in the list. **Delete** (`D`) removes it. Both ask first.

**Activity** (or `i`) shows the latest calls assistants made through this engine: the tool, which token, when, and the reason when a call failed.

An assistant token speaks MCP only and cannot call the REST API. Tokens made here have no expiry; use `pae mcp:token:create --expires` on the server if you want one that expires. The engine address in the command is the URL you entered in Settings, plus `/mcp`. If the engine uses its own certificate, the assistant machine must trust it: see the note `pae mcp:connect` prints.

The clipboard holds the token until something else replaces it. If your API token is not allowed to manage assistant tokens, the panel says so.

In the Assistants view, `j` / `k` select a token, `h` / `l` pick the assistant for a new token's command, and Enter creates a token (or copies the command when a new token is shown).

### Updating the engine

**Update** starts an update on the server after you confirm. While the engine restarts, the panel can lose the connection for a moment. The result appears under the bars (`Updated 2.0.1 → 2.0.2`).

## Keyboard shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Move through the list (in a log: scroll) |
| Enter | Opens the project's buttons, then runs the selected one |
| `h` / `l` | Choose a button, or switch engine when the buttons are closed |
| `d` | Redeploy |
| `t` | Restart |
| `s` | Stop or start |
| `o` | Open the project's site |
| `L` | Deploy log |
| `D` | Delete the project |
| `Delete` | Cancel a running deploy |
| `/` | Filter projects or log lines |
| `r` | Refresh (in a log, fetches it again) |
| `e` | Settings |
| `E` | Add an engine |
| `a` | Assistant tokens |
| `g` | Next engine |
| `n`, `y`, `c`, `v`, `i` | In Assistants: new token, copy token, copy command, revoke, activity |
| Esc | Go back one step, and finally close the panel |

## Notifications

Omarchy shows a notification when a deploy starts, finishes, fails or is cancelled, when an account moves between `active` and `suspended`, and when the server's RAM or disk reaches 90% (critical at 95%). A resource alert fires once, and again only after the value has dropped below 80%. CPU is not alerted on: the engine reports it as a share since boot, which says nothing about the load now. The first poll after startup does not replay history. To turn them off, see [configuration](installation.md#polling-and-notifications).

## From the terminal

Typing the command is the confirmation, so nothing asks.

```bash
omarchy-shell io.github.panelalpha.watch status
omarchy-shell io.github.panelalpha.watch refresh
omarchy-shell io.github.panelalpha.watch update
omarchy-shell io.github.panelalpha.watch rebuild shop
omarchy-shell io.github.panelalpha.watch restart shop
omarchy-shell io.github.panelalpha.watch stop shop
omarchy-shell io.github.panelalpha.watch start shop
omarchy-shell io.github.panelalpha.watch cancel shop
omarchy-shell io.github.panelalpha.watch suspend shop
omarchy-shell io.github.panelalpha.watch unsuspend shop
omarchy-shell io.github.panelalpha.watch remove shop
omarchy-shell io.github.panelalpha.watch engines
omarchy-shell io.github.panelalpha.watch engine vps
omarchy-shell io.github.panelalpha.watch open
omarchy-shell io.github.panelalpha.watch close
```

`shop` is the project's username. `update` starts an engine update. `status` does not include the token.
