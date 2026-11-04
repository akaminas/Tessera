# Tessera for Obsidian

Send the tasks in your notes to Tessera, create a Tessera project from a note, and tick the boxes in
your notes when the tasks are done in Tessera.

## Install

1. In Tessera open **Settings → Obsidian** and download `main.js`, `manifest.json` and `styles.css`.
2. Put them in a folder named `tessera` inside your vault's `.obsidian/plugins` folder.
3. In Obsidian: **Settings → Community plugins**, turn off restricted mode, enable **Tessera**.
4. In Tessera click **Create key**, copy the connection code (shown once) and paste it into
   Obsidian under **Settings → Tessera**.

## Commands (command palette, search "Tessera")

| Command | What it does |
|---|---|
| Send the tasks in this note to Tessera | Every open task (`- [ ] text`) is added to your chosen list. A `[↗](…)` link to the card is written on the line. Tasks already sent are updated, not duplicated. |
| Send the selected tasks (or this line) to Tessera | The same, for the selection or the current line. |
| Create a Tessera project from this note | New project (To do, Doing, Done) with the note's open tasks in To do. |
| Tick boxes in this note for tasks done in Tessera | Completed tasks are ticked in the note. |
| Choose where new tasks go in Tessera | Pick the project and list. |

Dates and priority are read the way the Tasks plugin writes them: `📅 2026-11-20` (due), `🛫` (start),
`🔺 ⏫ 🔼 🔽 ⏬` (priority), or `[due:: 2026-11-20]`. Finished (`[x]`) or dropped (`[-]`) tasks that were never
sent are skipped. Front matter and code blocks are ignored.

## How it works

The plugin calls four database functions (`obsidian_*`, see `supabase/migrations/…_integration_keys.sql`)
over HTTPS with your access key. The key identifies you; the functions run with your permissions, so the
plugin can do nothing you cannot do. Only a hash of the key is stored in Tessera. Delete the key in
Settings → Obsidian to disconnect.

The connection code is saved in the plugin's `data.json` inside your vault. If your vault is synced
somewhere you do not control, treat the code like a password and delete the key if in doubt.

## Develop

```
cd integrations/obsidian
npm install
npm run build        # builds main.js and copies the three files to public/obsidian-plugin
npm run typecheck
```

Unit tests (`src/*.test.ts`) run with the app's tests: `npm test` in the repository root.
