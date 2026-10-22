# Workflow Canvas desktop

The Electron app uses the same React UI, HTTP/WebSocket server and MCP tools as
the web installation. No Node.js or Docker installation is needed to run a
packaged desktop app.

## Build and verify

Use Node.js 22 or newer in an isolated development environment:

```sh
npm ci
npm run typecheck
npm run test:unit
npm run test:desktop
npm run build:desktop
npm run test:desktop:smoke
npm run desktop:make
```

On Linux, the Electron smoke test needs a display (the task Space provides one).
Install Playwright's Chromium with `npx playwright install chromium` for the
phone-browser portion. The smoke test starts an isolated app data directory,
checks settings, native Save, live desktop/phone edits, background lifetime, and
persistence after quit. It never uses the installed app's data.

`desktop:make` produces a DMG and ZIP on macOS, or a Squirrel Setup.exe and ZIP on
Windows. `desktop:package -- --platform=win32 --arch=x64` can produce a portable
Windows application from another OS, but does not prove Windows execution.
The Desktop installers workflow builds on native macOS and Windows runners and
uploads artifacts. It does not publish releases. Run it manually on the feature
branch, or use a `desktop-v*` tag.

Signing is optional for development builds. Distribution builds should provide
`APPLE_SIGN_IDENTITY`, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID` for notarization. Windows builds accept
`WINDOWS_CERTIFICATE_FILE` and `WINDOWS_CERTIFICATE_PASSWORD`. Keep credentials
in the runner's secret store. Unsigned packages are development artifacts; do not
disable operating-system security to distribute them.

## Settings

- **General:** appearance, keep running when the window closes, open at login,
  local port, and data folder. Port changes apply after restart.
- **Phone access:** checks Tailscale and creates a private HTTPS Serve route.
  Both devices need Tailscale access. Existing routes and public Funnel routes
  are never replaced. The app verifies the endpoint before reporting success.
- **AI connections:** current HTTP MCP endpoint and setup commands.
- **Skills & plugin:** read/install the bundled skill for Codex, Claude Code or
  Cursor, or export a plugin whose stdio command launches the installed app.
  Existing customized skills are preserved.

There is no app login: anyone permitted by your tailnet policy to reach the
service can edit documents and call MCP tools. Keep access limited to the people
and devices intended to use it. Closing to the tray keeps phone and AI access
alive. Quitting, disconnecting Tailscale, or sleeping the serving computer makes
the remote link unavailable.

## MCP plugin

The app listens on loopback port 8790 by default. HTTP clients use
`http://127.0.0.1:8790/mcp`. The exported plugin runs its bundled MCP entry point
with the app executable in Electron's Node mode (`ELECTRON_RUN_AS_NODE=1`). This
provides stdio on both Windows and macOS without installing Node separately. It
starts the desktop app if needed and proxies tools to the same server. The existing macOS shell launcher prefers an installed desktop app,
then retains its Docker fallback. For Windows, export the desktop plugin so no
Bash or Docker command is required.

`WFC_PORT` and `WFC_URL` can override the local connection for integrations.
`WFC_DESKTOP_EXECUTABLE` selects an explicit app for the shell launcher.
`WFC_USER_DATA` and `WFC_DATA_DIR` are intended for isolated test installations.

## Data and lifecycle

Documents remain JSON files in the Electron user-data directory's `canvas`
subdirectory; desktop preferences are in `desktop-settings.json` alongside it.
Use **Open data folder** to find the exact location. Existing Docker data is not
silently moved or overwritten. Import existing drawings with Open or retain the
web installation until a deliberate migration is performed.

Native Save attaches a chosen .excalidraw file to the server's autosaver, so
changes from the desktop, phone, and MCP are written to the same file. Quitting
flushes pending document and attached-file writes.

To uninstall, open **Settings → General → Uninstall Workflow Canvas**. Windows
**Installed apps → Workflow Canvas → Uninstall** opens the same flow after the
app has been launched once. The standard installer handles a never-launched app.

Choose **Keep canvases** to save and verify a backup in a new folder you select,
or **Delete canvases** to remove the internal canvas data and unchanged external
`.excalidraw` files the app created. Existing files you opened or overwrote remain
yours. Canceling or failing the backup leaves the running app available.

The uninstaller removes the application, data/settings/cache folders, login entry,
owned skill/plugin files, and only Tailscale routes that this installation created
and that still point at its recorded server. It preserves pre-existing skills,
other Tailscale services, modified or newly added integration files, and explicit
canvas backups. It never uninstalls Tailscale itself or searches your disk for
untracked files. Ownership is recorded in `ownership.json` alongside preferences;
old untracked installations cannot safely claim existing integrations.

A temporary OS helper finishes removal after the app exits, verifies those paths
are gone, then deletes itself. A cleanup failure leaves its diagnostic in the
reported temporary folder instead of claiming success. Manual deletion of the
Mac app bypasses this flow, so use **Uninstall Workflow Canvas** for full cleanup.
