# Tiro for Obsidian

Bring your [Tiro](https://tiro.ooo) meeting notes into your vault. Sync summaries and transcripts as Markdown, search your notes, and insert links to them.

**Requirements:** a Tiro account. Tiro is a paid service, and the plugin reads your notes from Tiro's servers (see [Privacy and network use](#privacy-and-network-use)).

## Setup

1. Install the plugin and enable it under **Settings → Community plugins**.
2. Open the plugin options and select **Sign in** under **Tiro account**. Your browser opens the Tiro sign-in page; when you approve, it returns to Obsidian.
3. Optional: instead of signing in, create an API key at <https://tiro.ooo/platform/me/api-keys> and paste it into **API key (optional)**. A key takes priority over the sign-in.

### Desktop and mobile

Signing in works on the desktop app only. The plugin listens on `127.0.0.1` (ports 27193 to 27196) for the browser's one-time redirect, which mobile apps can't do. On mobile, use an API key or sign in on a desktop.

The sign-in tokens are stored in this plugin's data file (`data.json`), like the API key. If you sync your vault's `.obsidian` folder between devices, the sign-in goes with it, so a phone can use a sign-in made on a desktop. If you don't want that, don't sync the plugin's data, or sign out when you're done.

## Commands

| Command | What it does |
| --- | --- |
| **Open panel** | Opens the Tiro side panel with the sync status and your recent notes. Also available from the ribbon. |
| **Toggle panel** | Opens or closes the side panel. |
| **Sync notes** | Saves your recent Tiro notes as Markdown files. Also available from the side panel. |
| **Search notes** | Searches Tiro (empty search shows recent notes). Picking a result saves or refreshes that note and opens it. |
| **Insert note link** | Inserts `[Title](tiro-web-link)` at the cursor. |

No hotkeys are set by default. Assign your own under **Settings → Hotkeys**.

## What a synced note looks like

```markdown
---
tiro_guid: note-abc123
title: Weekly Team Meeting
created: 2026-03-05T10:30:00Z
updated: 2026-03-05T11:45:00Z
source_type: live-voice
duration: 1:00:05
participants:
  - Alice Kim
tiro_url: https://tiro.ooo/n/abc123
---
%% tiro:start %%
## Summary
…
## Transcript
…
%% tiro:end %%
```

- The plugin only rewrites the text between `%% tiro:start %%` and `%% tiro:end %%` and the `tiro_*` fields it owns. Anything you write outside that block is kept when the note syncs again.
- Notes are matched by `tiro_guid`, so you can rename or move the files freely.
- A note is skipped when its `updated` value matches Tiro. Picking a note from **Search notes** always refreshes it.
- The transcript is added only when **Include transcript** is on. Locked paragraphs are skipped.
- A sync looks at your 100 most recent notes.

## Options

- **Tiro account**: sign in or out. Shows the signed-in account when Tiro provides one.
- **API key (optional)**: a Tiro key used instead of the sign-in. It is stored in this vault's plugin data and sent only to Tiro.
- **Sync folder**: where notes are saved. Default `Tiro`.
- **Include transcript**: off by default.
- **File name format**: default `YYYY-MM-DD title`. Characters that files can't contain are replaced.
- **Sync on startup**: off by default.
- **Auto sync interval**: minutes between automatic syncs; `0` turns it off.

The interface is available in English, Korean and Japanese and follows the app language.

## Privacy and network use

- The plugin talks to Tiro (`https://api.tiro.ooo` for sign-in and `https://mcp.tiro.ooo` to read your notes) with your sign-in token or API key. It does not send vault content anywhere.
- During sign-in the plugin starts a short-lived web server on `127.0.0.1` that accepts one request from your browser and then stops. It is not reachable from other computers. Sign-in asks only for read access to your notes and summaries.
- There is no telemetry.

## Manual installation

Copy `main.js`, `manifest.json` and `styles.css` from a release into `<your vault>/.obsidian/plugins/tiro/`, then enable the plugin.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type check and production build
npm test        # unit tests
npm run lint
```

## License

MIT
