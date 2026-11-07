# Pomodoro Flashcards

An Obsidian plugin that combines **Markdown-based Spaced Repetition (SM-2) flashcards** with an **integrated Pomodoro focus timer**. Study smarter with focused intervals, automatic rest reminders, and spaced recall scheduling directly inside your vault.

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

- **Flexible deck organization**: Organize cards into decks using frontmatter (`deck: Biology`), heading tags (`## Genetics #deck/Genetics`), or inline tags (`#deck/Algorithms`).

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

### 4. Mobile Gestures & Ergonomics
- **Touch swipe gestures**: Swipe right for Good, swipe left for Again, and tap or swipe up to reveal the answer.
- **Visual swipe feedback**: Dynamic, real-time directional rating badges respond as you drag with physics-based spring return.
- **Tactile haptics**: Subtle vibrations on card flips, swipe thresholds, SM-2 ratings, and timer transitions.
- **Space-saving compact timer**: Collapsible timer bar on mobile devices to preserve maximum vertical space for reading flashcards.
- **Safe-area & virtual keyboard aware**: 16px inputs prevent unwanted iOS auto-zooming, scrollable modal forms, and 44px+ touch targets throughout.

---

## Privacy & Security

- **100% Local & Offline**: This plugin makes **zero network calls**. It does not contact external servers or load remote assets.
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
