import assert from "node:assert/strict";
import {
	calculateSM2,
	createDefaultSRSMetadata,
	isCardDue,
	previewIntervals,
} from "../src/srs.ts";
import {
	formatFlashcardMarkdown,
	parseMarkdownCards,
} from "../src/parser.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";

const now = 1_700_000_000_000;

// 1. Test SM-2 Spaced Repetition Scheduling
{
	let meta = createDefaultSRSMetadata(now);
	assert.equal(isCardDue(meta, now), true);

	const previews = previewIntervals(meta);
	assert.equal(previews.again, "<10m");
	assert.equal(previews.hard, "1d");
	assert.equal(previews.good, "1d");
	assert.equal(previews.easy, "4d");

	// First "good" review -> 1 day interval, repetition 1
	meta = calculateSM2(meta, "good", now);
	assert.equal(meta.interval, 1);
	assert.equal(meta.repetition, 1);
	assert.equal(meta.efactor, 2.5);
	assert.equal(isCardDue(meta, now), false);

	// Second "good" review -> 6 days interval, repetition 2
	meta = calculateSM2(meta, "good", now);
	assert.equal(meta.interval, 6);
	assert.equal(meta.repetition, 2);

	// Third "easy" review -> boosted interval and efactor
	meta = calculateSM2(meta, "easy", now);
	assert.equal(meta.repetition, 3);
	assert.equal(meta.efactor, 2.65);
	assert.ok(meta.interval > 6);

	// "again" resets repetition and schedules in 10 minutes
	meta = calculateSM2(meta, "again", now);
	assert.equal(meta.repetition, 0);
	assert.equal(meta.interval, 0);
	assert.equal(meta.dueDate, now + 10 * 60 * 1000);
}

// 2. Test Markdown Flashcard Parser
{
	const sampleNote = `---
deck: Computer-Science
---

# Algorithms

- Time complexity of binary search :: $O(\\log n)$
- FIFO data structure ::: Queue #deck/Data-Structures

Q: What is memoization?
A: Caching the results of expensive function calls.

How does a hash table resolve collisions? #flashcard
?
Via **chaining** (linked lists) or **open addressing** (probing).

\`\`\`ts
// Code blocks with :: should be ignored!
const pair = "a :: b";
\`\`\`
`;

	const cards = parseMarkdownCards(
		sampleNote,
		"CS/Notes.md",
		DEFAULT_SETTINGS,
		{},
		now
	);

	// Expect 5 cards:
	// 1 single-line + 2 from bidirectional ::: + 1 Q/A block + 1 multi-line ? block
	assert.equal(cards.length, 5);

	assert.equal(cards[0].question, "Time complexity of binary search");
	assert.equal(cards[0].answer, "$O(\\log n)$");
	assert.equal(cards[0].deck, "Computer-Science");

	assert.equal(cards[1].question, "FIFO data structure");
	assert.equal(cards[1].answer, "Queue");
	assert.equal(cards[1].deck, "Data-Structures");

	assert.equal(cards[2].question, "Queue");
	assert.equal(cards[2].answer, "FIFO data structure");
	assert.equal(cards[2].deck, "Data-Structures");

	assert.equal(cards[3].question, "What is memoization?");
	assert.equal(
		cards[3].answer,
		"Caching the results of expensive function calls."
	);

	assert.equal(
		cards[4].question,
		"How does a hash table resolve collisions?"
	);
	assert.equal(
		cards[4].answer,
		"Via **chaining** (linked lists) or **open addressing** (probing)."
	);
}

// 3. Test Markdown Formatter
{
	const single = formatFlashcardMarkdown(
		"Capital of Japan",
		"Tokyo",
		"Geography",
		DEFAULT_SETTINGS
	);
	assert.equal(single, "\nCapital of Japan :: Tokyo #deck/Geography");

	const multi = formatFlashcardMarkdown(
		"Line 1\nLine 2",
		"Answer Line",
		"General",
		DEFAULT_SETTINGS
	);
	assert.equal(multi, "\nLine 1\nLine 2\n?\nAnswer Line\n");
}

// 4. Test Mobile Settings & Pomodoro Haptic Safety
{
	assert.equal(DEFAULT_SETTINGS.enableHaptics, true);
	assert.equal(DEFAULT_SETTINGS.compactMobileTimer, true);
}

console.log("All SRS & Parser tests passed!");
