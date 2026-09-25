# Installation and configuration

## Install

```bash
omarchy plugin add git@github.com:wiluszdamian/omarchy-engine-watch.git --enable --yes
```

The shell loads the plugin right away and puts the icon on the right of the bar. No restart is needed.

To move the icon to another part of the bar:

```bash
omarchy bar move io.github.panelalpha.watch --section right
```

## Update

```bash
omarchy plugin update io.github.panelalpha.watch
```

The shell reloads the plugin when its files change. Your configuration stays.

## Connect to an engine

1. Create a token on the VPS:

   ```bash
   pae api:token:create watch
   ```

   This is a token for your own program. The assistant token from `pae connect` does not work on `/api`.

2. Click the icon in the bar. Until an engine is set, the panel opens straight to the connection form. Later you can return to it with the **Settings** button or the `e` key.
3. Enter the **Engine URL** and the **API token**, then click **Save**.

If the engine uses its own (self-signed) certificate, turn on **Trust the certificate**. When you edit an engine, leaving the token field empty keeps the current token.

An `http://` address works, but the panel warns you: the token then crosses the network unencrypted. Use `https://` wherever you can.

## Configuration file

Settings are stored in `~/.config/panelalpha-watch/config.json` (directory `0700`, file `0600`). You normally don't need to edit it, but you can. Changes are picked up automatically, with no restart.

### Several engines

Add them from the panel: click **+ Engine** (or press `E`), enter a name, the URL and a token for that engine, then **Save**. The new engine becomes the active one. To rename or re-point an engine, select it and open **Settings**. **Remove** in the same form deletes a saved connection (the engine itself is not touched). You need at least one engine.

Each engine needs its own API token from `pae api:token:create watch` on that server.

The same thing as a file:

```json
{
  "version": 1,
  "engines": [
    { "id": "home", "name": "Home", "url": "https://a.example:2011", "token": "…" },
    { "id": "vps", "name": "VPS", "url": "https://b.example:2011", "token": "…" }
  ]
}
```

Switch engines with the buttons under the usage bars, the middle mouse button on the icon, the `g` key, or `h` / `l` in the project list. Only the engine you are looking at is polled.

### Polling and notifications

Optional, in the same file:

```json
"poll": { "projectsSec": 20, "metricsSec": 30, "deploysSec": 8, "infoSec": 600 },
"notify": { "deployStarted": true, "deployFinished": true, "deployFailed": true, "projectStatus": true, "resources": true }
```

`"notify": false` turns off all notifications. `resources` covers the RAM and disk alerts.

The file must belong to you and must not be writable by anyone else, otherwise the plugin stops polling. If others can read it, the panel warns you and keeps working.

## Troubleshooting

| Symptom | What to do |
|---|---|
| The panel shows the connection form | The URL or token is missing. Enter them and save |
| "token" error or access denied | Create the token with `pae api:token:create`, not with `pae connect` |
| Certificate error | Turn on **Trust the certificate** |
| No change after updating the plugin | Run `omarchy restart shell` to reload everything |
| "Config file is not safe to read" | Run `chmod 600 ~/.config/panelalpha-watch/config.json` |
| "Engine is not reachable" | Check the URL and port, and that this machine can open it |
| "Assistant tokens are not available" | The API token may not manage them, or the engine is too old to offer them |
