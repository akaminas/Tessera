# Design

Tessera should feel instantly familiar to anyone who has used Trello: calm, uncluttered, and readable for people with red-green colour blindness. All tokens live in `src/styles/theme.css`, with the dark theme under `[data-theme="dark"]`. **Light is the default.** Dark is chosen from the account menu, or by following the system setting in Settings → Preferences.

This replaces the original brief's Vellum design system, at the product owner's request.

## Colour
- **Neutrals, accent and status** follow GitHub Primer's *Protanopia & Deuteranopia* light and dark themes:
  - The page is white (`#0d1117` in dark), with panels in Primer's subtle grey and hairlines in its border grey.
  - The interaction accent and primary buttons are GitHub blue.
  - Success is **blue**, attention is amber, and severe or critical is **orange**. Red and green never carry meaning on their own.
- **Status marks** (Done, Overdue, Blocked) always combine a colour with an icon *and* a word.
- **Labels** use Trello's pastel set: green, yellow, orange, red, purple, blue, sky, lime, pink and grey. Dark mode uses the deeper Trello variants with light text.
  - Text on labels meets 4.5:1 contrast.
  - Labels may be colour-only, as on Trello. The label manager encourages naming them, so the meaning does not depend on colour.
- **Boards** are Trello-shaped: light-grey list panels (`--t-list`) hold white cards (`--t-tile`) with a soft shadow. In dark mode, lists are near-black and cards one step lighter.
- **Board backgrounds:**
  - Eight self-hosted Unsplash photos, six gradients and two patterns, chosen in **Board menu → Name, description and background** or when creating a board.
  - New boards start on the *Lake* photo.
  - On photos and colours, the board bar is translucent black with white text, and "Add another list" is translucent white, as on Trello.
- **Projects page:** projects appear as tiles showing their first board's background, like Trello's workspace view.

## Typography
- Inter (variable, OFL, self-hosted) throughout, with character variants `cv11` and `ss01` for a cleaner *a* and *1*.
- 14 px body text. Headings are 600 weight with slightly tightened tracking; bold text is 600.
- Sentence case throughout. Tabular lining numerals in tables and numbers.

## Charts (`src/components/charts.tsx`)
- Each chart's title states its claim in a sentence, computed from the data.
- Muted unit line; horizontal hairline grid only; bottom axis only.
- Direct end labels instead of legends for four series or fewer.
- Series colours come from the theme families in slot order. Status meaning is never encoded in a series colour.

## Interaction
- **Density:** comfortable by default; compact on request.
- **Motion:** only short colour and transform transitions, removed entirely when the user or the OS asks.
- **Familiar to Trello users:**
  - Lists with "Add a task" at the foot and "Add another list" at the end. The whole list header drags.
  - A project opens on its board.
  - The board bar holds only the board switcher, one **Filter** button (keyword, members, dates and labels inside) and the board menu.
  - Cards show labels, title, members and a few badges. Priority appears only when high or urgent; status is not shown, because the list says it.
  - The back of a card has a summary row (members, labels, dates), then description, checklists, attachments and comments. **Add to card** and **Actions** sit on the right.
  - New boards get Trello's six colour-only starter labels.
- **Progressive disclosure:**
  - A task needs only a title.
  - Card sections appear once they hold something, or when chosen from "Add to card"; rarer ones sit under **More**.
  - List counts appear only when a filter hides tasks or a limit is set.
  - The connection indicator appears only when live updates stop.
  - Advanced project areas are modules a project can switch off.
- **Help:** *How to use Tessera* in the account menu walks through every area step by step.
- **Accessibility:**
  - Radix primitives.
  - A skip link and labelled regions.
  - Keyboard alternatives for dragging (dnd-kit keyboard sensor, the Move dialog, and `,` / `.` shortcuts).
  - Visible focus.
  - 4.5:1 text contrast.
  - A colour-blind-safe palette in both themes.
