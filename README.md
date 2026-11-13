# Pomodoro Flashcards

An Obsidian plugin that combines **Markdown-based Spaced Repetition (SM-2) flashcards** with an **integrated Pomodoro focus timer**. Study smarter with focused intervals, automatic rest reminders, and spaced recall scheduling directly inside your vault.

## Why this suite exists

I created this suite of Obsidian plugins and the DoomEsque theme so that I can be 100 percent certain there are no network calls or traffic: everything runs 100 percent offline, so I can use Obsidian for my notes in open-book law exams.

- Nothing in the suite makes a network request. Every test run checks the source, built bundle and styles with `scripts/offline-audit.mjs`, which fails on any network API (`fetch`, `XMLHttpRequest`, WebSocket, `requestUrl`, ...).
- Obsidian itself has separate online features. For a fully offline setup, also turn off automatic updates, Sync and Publish, and don't browse community plugins during the exam.

The suite:

- [DoomEsque](https://github.com/blursedperf/obsidian-theme-doomesque) (theme)
- [DoomEsque Settings](https://github.com/blursedperf/obsidian-doomesque-settings)
- [Filetypes](https://github.com/blursedperf/obsidian-filetypes-plugin)
- [Inline Autocomplete](https://github.com/blursedperf/obsidian-inline-autocomplete)
- [Inline Schema Expander](https://github.com/blursedperf/obsidian-inline-schema-expander)
- [Links in New Tabs](https://github.com/blursedperf/obsidian-links-in-new-tabs)
- **Pomodoro Flashcards**
- [Whole-Tree Search](https://github.com/blursedperf/obsidian-whole-tree-search)

---

## Features

### 1. Markdown-First Flashcard Syntax
Write flashcards naturally in any note without disrupting your writing flow:

- **Single-line cards**:
  ```markdown
  Question :: Answer
  ```

- **Bidirectional cards** (generates both forward and reverse flashcards):
  ```markdown
  Mitochondria ::: Powerhouse of the cell
  ```

  Separators need a space on both sides and must sit outside `[...]`, `(...)` and inline code, so inline fields such as `held:: appeal allowed` or `[court:: HL]` are never turned into cards. A line may start with a tag (`#torts Duty of care :: ...`).

- **Multi-line cards** (`?` separator):
  ```markdown
  What is the time complexity of binary search?
  ?
  $O(\log n)$ because the search space is halved at each comparison.
  ```

- **Q/A block cards**:
  ```markdown
  Q: What is memoization?
  A: An optimization technique that stores the results of expensive function calls.
  ```

- **Cloze deletions** (fill in the blank). Every deletion number in a paragraph becomes one card; deletions sharing a number are hidden together, and the rest of the paragraph stays visible as context:
  ```markdown
  Negligence requires {{c1::a duty of care}}, {{c2::breach}} and {{c3::damage::what kind of harm?}}.
  ```
  The text after a second `::` is a hint shown in the blank. Highlights can be clozes too (one card per `==highlight==`): turn on **Highlights are cloze deletions**, add `cloze: true` to a note's properties, or tag a paragraph `#cloze`. Use **Wrap selection in cloze deletion** to wrap selected text in the next free number, or **(same card as the last cloze)** to add it to the latest card.

- **Automatic case cards** for studying law. Describe a case on one line (the format Inline Schema Expander writes):
  ```markdown
  Donoghue v Stevenson #case-law [court:: HL] [year:: 1932] [ratio:: A manufacturer owes a duty of care to the consumer]
  ```
  or in a case note tagged `case-law` in its properties, with fields in its properties or on `Field:: value` lines (`Ratio:: ...`, `- **Held**:: ...`). Recognised fields are `ratio` (or `principle`, `rule`), `held` (`holding`, `decision`, `outcome`), `issue`, `facts`, `court`, `year`, `citation` and `case`/`name`. Each filled-in field becomes a card (*What is the ratio of Donoghue v Stevenson?*, *What was held in...?*, *Which court decided...?*), and ratio and facts are also reversed (*Which case established this principle?*). The case name is the text on the line, then the `case` field, then the heading above the line, then the note's name. Empty fields are skipped, so a freshly expanded template makes no cards until you fill it in. Change the tag or turn off reverse cards under **Case cards** in settings.

- **Flexible deck organization**: Organize cards into decks using frontmatter (`deck: Biology`), heading tags (`## Genetics #deck/Genetics`), or inline tags (`#deck/Algorithms`).

- **History that follows your notes**: Review history is kept when you rename or move a note or folder, and when you edit a card's question.

- **Quick-create modal**: Capture cards on the fly via the command palette, ribbon button, or selected note text (**Create flashcard from selected text**).

### 2. SM-2 Spaced Repetition Scheduling
Optimize recall with the proven SuperMemo-2 spaced repetition algorithm:
- Grade recall after each card: **Again (`1`)**, **Hard (`2`)**, **Good (`3` / `Space`)**, or **Easy (`4`)**.
- Live interval previews displayed directly on each rating button (`<10m`, `1d`, `6d`, `10d`).
- Seamlessly toggle between **Due cards (spaced repetition)** and **Cram mode (all cards)**.

### 3. Integrated Pomodoro Focus Experience
- **Embedded circular timer**: SVG countdown ring right in the flashcard view.
- **Break mode rest screen**: Enforces genuine cognitive recovery by pausing card reviews during short and long breaks (with an optional override button if you prefer to continue).
- **Status bar indicator** (desktop & tablet): Real-time countdown and due card count (`🍅 25:00 · 🗂️ 12 due`). Left-click opens the study view; right-click toggles timer start/pause.
- **Synthesized audio chimes**: Pure Web Audio API chimes signal phase transitions with zero external audio downloads or network access.

### 4. Mobile Ergonomics
- **Tappable card stage**: Tap the card or the large primary action button to reveal the answer with zero sidebar gesture interference.
- **Tactile haptics**: Subtle vibrations on card flips, SM-2 ratings, and timer transitions.
- **Space-saving compact timer**: Collapsible timer bar on mobile devices to preserve maximum vertical space for reading flashcards.
- **Safe-area & virtual keyboard aware**: 16px inputs prevent unwanted iOS auto-zooming, scrollable modal forms, and 44px+ touch targets throughout.

---

## Privacy & Security

- **100% Local & Offline**: This plugin makes **zero network calls**. It does not contact external servers or load remote assets.
- **Offline audit**: Every test run checks the source, built bundle and styles with `scripts/offline-audit.mjs`, which fails on any network API (`fetch`, `XMLHttpRequest`, WebSocket, `requestUrl`, workers, dynamic `import()`, ...), dynamic code (`eval`, `new Function`), raw HTML injection, or remote CSS (`@import`, non-`data:` `url()`).
- **Remote content is never loaded**: Before a card is rendered, remote images (`![](https://...)`), raw HTML that loads resources (`<img>`, `<iframe>`, `<video>`, ...) and embeds of other notes are neutralised, so studying a card never makes a network request. Embeds of local images, audio, video and PDFs still show.
- **Zero Telemetry**: No usage metrics, tracking pixels, crash analytics, or user identifiers.
- **Vault-Confined Storage**: All flashcards live directly in your Markdown notes. Review intervals and statistics are stored locally in your vault's `.obsidian/plugins/pomodoro-flashcards/data.json`.
- **Safe DOM Rendering**: Follows Obsidian security best practices with no `eval()` or unsanitized `innerHTML`. Card contents are rendered securely through Obsidian's native `MarkdownRenderer`.

---

## Installation

### Community Plugins (Recommended)
1. Open Obsidian **Settings** → **Community plugins**.
2. Ensure **Restricted mode** is turned off.
3. Click **Browse** and search for **Pomodoro Flashcards**.
4. Click **Install**, then **Enable**.

### Manual Installation
1. Download `manifest.json`, `main.js`, and `styles.css` from the latest [GitHub Release](https://github.com/blursedperf/obsidian-pomodoro-flashcards/releases).
2. Create a folder named `pomodoro-flashcards` inside your vault's `.obsidian/plugins/` directory.
3. Copy `manifest.json`, `main.js`, and `styles.css` into that folder.
4. Reload Obsidian and enable **Pomodoro Flashcards** under **Settings** → **Community plugins**.

---

## Development

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Build production bundle
npm run build
```

---

## License

[MIT](LICENSE) © 2026 blursedperf
