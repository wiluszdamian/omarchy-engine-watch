# API and security

The plugin calls only routes that PanelAlpha Engine already serves under `/api`, with an `Authorization: Bearer <token>` header.

## Reads

| What you see | Route |
|---|---|
| Version, web server, latest update | `GET /system/info` |
| CPU, RAM, disk | `GET /metrics/current` |
| Projects, domains, account status, strategy, branch | `GET /projects/all?with_domain_names=1` |
| Deploy status, phase, error and log | `GET /projects/{user}/deploy-log` |
| Containers | `GET /projects/{user}/containers` |
| Databases (name and size, never the password) | `GET /projects/{user}/mysql/databases` |
| Container log | `GET /projects/{user}/containers/{service}/logs?lines=200` |
| Whether the app answers | `GET /projects/{user}/app/health` |
| Assistant tokens (name, dates, revoked; never the secret) | `GET /mcp-tokens` |
| What assistants did | `GET /mcp-activity-logs` |

CPU from `/metrics/current` is the share since the machine started (from `/proc/stat`), not the instantaneous load. RAM and disk are current.

## Actions

| Button | Route |
|---|---|
| Update (engine) | `PUT /system/update` |
| Redeploy | `POST /projects/{user}/rebuild` |
| Cancel | `POST /projects/{user}/deploy-cancel` |
| Restart / Stop / Start | `POST /projects/{user}/containers/action` (`restart`, `stop`, `up`) |
| Suspend / Unsuspend | `PUT /projects/{user}/suspend` and `unsuspend` |
| Delete | `DELETE /projects/{user}` |
| New assistant token | `POST /mcp-tokens` (body: the name) |
| Revoke assistant token | `PUT /mcp-tokens/{id}/revoke` |
| Delete assistant token | `DELETE /mcp-tokens/{id}` |

## Security

- The plugin does not create projects, edit environment variables, or fetch database passwords or git tokens. It does not open SSH.
- Only one engine is polled at a time: the one you are looking at. Answers that arrive after you switch engines are dropped.
- The token goes to `curl -K -` on standard input, not in the process arguments.
- The configuration file is `0600` and its directory `0700`. It is written through a temporary file and renamed into place.
- Any process on this account, and any plugin loaded into the same shell, can see the token. The trust boundary is your machine.
- Destructive actions (Redeploy, Stop, Cancel, Suspend, Delete, Update, revoking or deleting an assistant token, removing an engine) ask for confirmation in the panel.
- A new assistant token is returned by the engine once. The plugin keeps it in memory only while the panel shows it, never writes it to disk or the log, and drops it when you press Done, leave the view or close the panel. Copying it puts it on the clipboard.
