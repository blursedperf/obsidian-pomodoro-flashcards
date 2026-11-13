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
import { carryOverEditedCards, remapRenamedCards } from "../src/history.ts";
import { generateCardId } from "../src/srs.ts";
import { buildClozeCards, findClozes, nextClozeNumber } from "../src/cloze.ts";

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

// 5. Lines that start with a tag are cards, not headings
{
	const cards = parseMarkdownCards(
		[
			"#torts Elements of negligence :: duty, breach, causation, damage",
			"#flashcard Donoghue v Stevenson :: neighbour principle",
			"## Causation #deck/Torts",
			"But-for test :: would the harm have occurred without the breach?",
		].join("\n"),
		"Law/Torts.md",
		DEFAULT_SETTINGS,
		{},
		now
	);
	assert.deepEqual(
		cards.map((c) => [c.question, c.answer, c.deck]),
		[
			["#torts Elements of negligence", "duty, breach, causation, damage", "General"],
			["Donoghue v Stevenson", "neighbour principle", "General"],
			["But-for test", "would the harm have occurred without the breach?", "Torts"],
		]
	);
}

// 6. Inline fields and bracketed `::` never become cards
{
	const cards = parseMarkdownCards(
		[
			"held:: appeal allowed",
			"- Ratio:: the neighbour principle",
			"Donoghue v Stevenson #case-law [court:: HL] [year:: 1932] [ratio:: neighbour principle]",
			"(court:: HCA) and `a :: b` in code",
			"Mabo v Queensland (No 2) (1992) 175 CLR 1 ::: rejected terra nullius",
			"Ratio :: the neighbour principle [court:: HL]",
		].join("\n"),
		"Cases/Torts.md",
		DEFAULT_SETTINGS,
		{},
		now
	);
	assert.deepEqual(
		cards.map((c) => [c.question, c.answer]),
		[
			["Mabo v Queensland (No 2) (1992) 175 CLR 1", "rejected terra nullius"],
			["rejected terra nullius", "Mabo v Queensland (No 2) (1992) 175 CLR 1"],
			["Ratio", "the neighbour principle [court:: HL]"],
		]
	);
}

// 7. Review history survives renaming a note or folder
{
	const md = "Duty of care :: neighbour principle\nBreach :: standard of care";
	const reviewed = calculateSM2(createDefaultSRSMetadata(now), "good", now);
	const metadata = { [generateCardId("Torts.md", "Duty of care")]: reviewed };
	const cards = parseMarkdownCards(md, "Torts.md", DEFAULT_SETTINGS, metadata, now);

	assert.equal(remapRenamedCards(cards, metadata, "Torts.md", "Law/Torts.md"), true);
	assert.equal(cards[0].sourcePath, "Law/Torts.md");
	assert.equal(remapRenamedCards(cards, metadata, "Law", "Year 1/Law"), true);
	const reparsed = parseMarkdownCards(md, "Year 1/Law/Torts.md", DEFAULT_SETTINGS, metadata, now);
	assert.deepEqual(reparsed[0].srs, reviewed);
	assert.equal(reparsed[1].srs.repetition, 0);
	assert.equal(Object.keys(metadata).length, 1);
	assert.equal(remapRenamedCards(reparsed, metadata, "Other.md", "Elsewhere.md"), false);
}

// 8. Review history survives editing a question
{
	const before = "Duty of care :: neighbour principle\nBreach :: standard of care\nTerm ::: Definition";
	const meta = (n: number) => ({ ...calculateSM2(createDefaultSRSMetadata(now), "good", now), efactor: n });
	const metadata: Record<string, ReturnType<typeof meta>> = {};
	const previous = parseMarkdownCards(before, "T.md", DEFAULT_SETTINGS, {}, now);
	previous.forEach((c, i) => (metadata[c.id] = meta(2 + i / 10)));

	// Edit the first question, swap the first two lines, and edit the bidirectional term
	const after = "Breach :: standard of care\nDuty of care (Donoghue) :: neighbour principle\nTerm edited ::: Definition";
	const parsed = parseMarkdownCards(after, "T.md", DEFAULT_SETTINGS, metadata, now);
	assert.equal(carryOverEditedCards(previous, parsed, metadata), true);
	assert.deepEqual(
		parsed.map((c) => c.srs.efactor),
		[2.1, 2, 2.2, 2.3]
	);
	assert.equal(Object.keys(metadata).length, 4);
	assert.equal(carryOverEditedCards(parsed, parsed, metadata), false);
}

// 9. Cloze deletions: groups, hints, and rendering
{
	const B = (t: string) => `<span class="pomo-fc-cloze-blank">[${t}]</span>`;
	const A = (t: string) => `<span class="pomo-fc-cloze-answer">${t}</span>`;
	const cards = buildClozeCards(
		"Negligence needs {{c1::duty}}, {{c1::breach}} and {{c2::damage::harm?}}.",
		false
	);
	assert.deepEqual(cards, [
		{
			group: "c1",
			question: `Negligence needs ${B("…")}, ${B("…")} and damage.`,
			answer: `Negligence needs ${A("duty")}, ${A("breach")} and damage.`,
		},
		{
			group: "c2",
			question: `Negligence needs duty, breach and ${B("harm?")}.`,
			answer: `Negligence needs duty, breach and ${A("damage")}.`,
		},
	]);

	// Highlights only when enabled; one card each; never inside inline code or an Anki cloze
	const text = "The ==neighbour principle== from {{c1::==Donoghue==}} and `==code==`";
	assert.deepEqual(findClozes(text, false).map((d) => d.group), ["c1"]);
	assert.deepEqual(findClozes(text, true).map((d) => [d.group, d.text]), [
		["h1", "neighbour principle"],
		["c1", "==Donoghue=="],
	]);
	assert.equal(buildClozeCards("No <b>{{c1::x::<i>}}</b>", false)[0].question.includes("[&lt;i&gt;]"), true);

	assert.equal(nextClozeNumber("{{c1::a}} {{c3::b}}"), 4);
	assert.equal(
		parseMarkdownCards("Needs {{c1::duty :: the first element}}", "a.md", DEFAULT_SETTINGS, {}, now)[0].clozeGroup,
		"c1"
	);
	assert.equal(nextClozeNumber("no clozes"), 1);
}

// 10. Cloze paragraphs in notes
{
	const md = [
		"---",
		"deck: Torts",
		"---",
		"## Negligence",
		"The elements are:",
		"- {{c1::duty of care}}",
		"- {{c2::breach}} #deck/Elements",
		"",
		"Highlights ==ignored== here.",
		"",
		"#cloze s 5B: a person is not negligent unless the risk was ==foreseeable==",
		"and ==not insignificant==.",
		"",
		"Ratio :: {{c1::neighbour}} principle",
		"",
		"```",
		"{{c1::in code}}",
		"```",
	].join("\n");
	const cards = parseMarkdownCards(md, "Law/Torts.md", DEFAULT_SETTINGS, {}, now);
	assert.deepEqual(
		cards.map((c) => [c.clozeGroup ?? null, c.deck, c.lineStart, c.lineEnd]),
		[
			["c1", "Elements", 4, 6],
			["c2", "Elements", 4, 6],
			["h1", "Torts", 10, 11],
			["h2", "Torts", 10, 11],
			[null, "Torts", 13, 13],
		]
	);
	assert.ok(cards[0].question.startsWith("The elements are:\n- <span"));
	assert.ok(!cards[2].question.includes("#cloze"));
	assert.ok(cards[2].question.startsWith("s 5B: a person"));
	assert.equal(cards[4].answer, "{{c1::neighbour}} principle");
	assert.notEqual(cards[0].id, cards[1].id);

	// The setting and the note property turn highlights on everywhere
	const hl = "Highlights ==on== here.";
	assert.equal(parseMarkdownCards(hl, "a.md", DEFAULT_SETTINGS, {}, now).length, 0);
	assert.equal(parseMarkdownCards(hl, "a.md", { ...DEFAULT_SETTINGS, highlightClozes: true }, {}, now).length, 1);
	assert.equal(parseMarkdownCards("---\ncloze: true\n---\n" + hl, "a.md", DEFAULT_SETTINGS, {}, now).length, 1);

	// A multi-line ? card whose question contains a cloze stays a ? card
	const multi = parseMarkdownCards("What does {{c1::s 5B}} require?\n?\nForeseeable risk", "a.md", DEFAULT_SETTINGS, {}, now);
	assert.equal(multi.length, 1);
	assert.equal(multi[0].clozeGroup, undefined);
}

// 11. Cloze history survives editing the paragraph
{
	const before = "Elements: {{c1::duty}}, {{c2::breach}}";
	const previous = parseMarkdownCards(before, "T.md", DEFAULT_SETTINGS, {}, now);
	const metadata: Record<string, ReturnType<typeof calculateSM2>> = {};
	previous.forEach((c, i) => (metadata[c.id] = { ...calculateSM2(createDefaultSRSMetadata(now), "good", now), efactor: 2 + i / 10 }));
	const parsed = parseMarkdownCards("The elements: {{c1::duty of care}}, {{c2::breach}}", "T.md", DEFAULT_SETTINGS, metadata, now);
	assert.equal(carryOverEditedCards(previous, parsed, metadata), true);
	assert.deepEqual(parsed.map((c) => c.srs.efactor), [2, 2.1]);
}

console.log("All SRS & Parser tests passed!");
