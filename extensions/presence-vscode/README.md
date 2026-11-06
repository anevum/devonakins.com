# DevonAkins Presence

An optional, paused-by-default VS Code companion for the owner's personal site.
It does not inspect or send document text, names, paths, repository information,
window titles, prompts or clipboard data. Only the existence of a focused text
edit, a deliberately selected public project and an observation timestamp are sent.
Edits made through editor commands can also produce an activity event; this is
editor-observed activity, not proof of human keystrokes or productivity.

## Install and pair

1. Install the `.vsix` from the verified PR's `presence-vscode` CI artifact using
   **Extensions → Install from VSIX**. No Marketplace publication is needed.
2. Visit your protected website `/owner/presence/` on your phone or computer.
   Create a pairing code. Paste it only into **Devon Presence: Pair Editor** in
   VS Code's command palette. It expires after five minutes and is one-use.
3. Select a public project or **No public project**. Enable paired editor activity
   in the private website controls, then run **Devon Presence: Resume Sharing**.
4. Focused edits can now produce an expiring heartbeat at most once per minute.
   Merely leaving VS Code open does not count. Pairing lasts 24 hours; restart
   always returns the companion to paused.

The token is kept in VS Code SecretStorage; only the selected public slug is
stored in ordinary global state. The token can update only the minimal editor
signal; it cannot alter owner preferences, playlists, account credentials or GPT
observations. Untrusted workspaces cannot activate the extension.

**Pause Sharing** stops local collection and attempts to clear the public editor
signal. If disconnected, that signal expires within two minutes. **Forget Pairing**
also removes the local token. Use **Disconnect editor** in the private website
controls to revoke the server credential. **Stop all broadcasting** hides all
signals and invalidates the editor pairing, including delayed requests.

This companion requires a running VS Code session for new observed edits. Remote
development from an iPhone uses the separate owner-declared session controls.
Neither route requires a laptop to remain running for Spotify account playback.

## Development and verification

Package using the official VSCE tool pinned by repository CI. Alternatively load
this directory with VS Code's `--extensionDevelopmentPath` development option.
The Node suite tests the request boundary against real SQLite and exercises this
module with simulated VS Code events and SecretStorage. A real desktop extension
host, owner pairing and signed-in account are separate acceptance checks.
