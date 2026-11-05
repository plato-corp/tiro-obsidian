![Tiro for Obsidian — capture, sync, and connect meeting notes](assets/overview.png)

[English](https://github.com/plato-corp/tiro-obsidian#readme) · [한국어](https://github.com/plato-corp/tiro-obsidian/blob/main/docs/README.ko.md) · [日本語](https://github.com/plato-corp/tiro-obsidian/blob/main/docs/README.ja.md)

# Meeting notes, ready for your vault
Bring your [Tiro](https://tiro.ooo) meeting summaries and transcripts into Obsidian as Markdown. Find a past conversation, save it beside your own notes, and keep writing around it.

## What you can do
- **Sync meeting notes.** Save summaries and, optionally, transcripts into a folder you choose.
- **Find and connect ideas.** Search your Tiro notes from the side panel, open them in your vault, or insert a link into the note you are writing.
- **Keep your own writing.** Re-syncing updates the managed Tiro block. Text you add outside it stays in place, and synced notes can be renamed or moved.
- **Request desktop recordings.** Start live or offline recording in Tiro, then finish a live note to create its document or finish an offline recording to upload it.

The illustration above explains the workflow; it is not an app screenshot.

## Get started
1. Install **Tiro** from Community plugins and enable it.
2. Open its settings and choose **Sign in** on desktop. On mobile, enter a Tiro API key instead.
3. Choose a sync folder (default: `Tiro`). Enable **Include transcript** if you want the full conversation as well as the summary.
4. Open the Tiro side panel and choose **Sync now**, or use **Search notes** to save a particular note.

Create an API key at [Tiro API keys](https://tiro.ooo/platform/me/api-keys). On desktop, an API key can also be used instead of signing in. The interface follows Obsidian's language and supports English, Korean, and Japanese.

## Before you use it
**A Tiro account and internet connection are required.** Available features and usage limits depend on your Tiro plan. The plugin is free; Tiro service plans are separate.

Search and sync work on desktop and mobile. Recording controls require the **Tiro desktop app 4.12.1 or later**, installed and signed in. They send a request to that app; check Tiro to confirm recording, document creation, or upload. The desktop app's account may differ from the plugin's account.

## Privacy and credentials
- The plugin reads notes from Tiro. **It does not upload your vault contents** and includes no telemetry.
- Sign-in uses `https://api.tiro.ooo`; note access uses `https://mcp.tiro.ooo`. Desktop sign-in briefly opens a callback listener on `127.0.0.1` that is not reachable from other computers.
- API keys and OAuth tokens stay **in memory for the current plugin session**. They are not written to `data.json` or synced to other devices. Sign in or enter your key again after an app restart or plugin reload.
- Upgrading removes credentials stored by older versions from the active settings file. Existing backups or version history are not erased.

## How sync works
A sync checks your 100 most recent notes. Notes are matched by `tiro_guid`, so moving or renaming a synced file does not break the match. The plugin updates its managed block and owned metadata; writing outside that block is preserved. Unchanged notes are skipped. Selecting a note in **Search notes** refreshes that note. Transcripts are optional, and locked paragraphs are skipped.

## More help
See the [full reference](docs/reference.md) for settings, commands, manual installation, managed-block format, and development. Report a problem or request a feature in [GitHub Issues](https://github.com/plato-corp/tiro-obsidian/issues). Include your OS, Obsidian/plugin versions, and steps to reproduce; do not include credentials or private meeting content.

Made by [The Plato](https://tiro.ooo). Licensed under [MIT](LICENSE).
