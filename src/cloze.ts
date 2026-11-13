/**
 * Cloze deletions.
 *
 *   {{c1::duty}}, {{c1::breach}} and {{c2::damage}}   Anki style: deletions sharing a number are
 *                                                     hidden together on one card
 *   {{c1::Donoghue v Stevenson::case}}                optional hint shown in the blank
 *   ==duty==                                          highlight: one card per highlight, only when
 *                                                     highlight clozes are enabled for the note
 *
 * A paragraph (consecutive non-blank lines) with deletions becomes one card per group. The question
 * shows the paragraph with that group blanked and every other deletion revealed; the answer shows
 * the paragraph with the group's text marked.
 */

export interface ClozeDeletion {
	/** Offset of the deletion's opening marker in the paragraph. */
	start: number;
	/** Offset just after the deletion's closing marker. */
	end: number;
	/** Hidden text (Markdown). */
	text: string;
	/** Optional hint shown in the blank. */
	hint: string | null;
	/** Card group: "c1", "c2", ... for Anki clozes, "h1", "h2", ... for highlights. */
	group: string;
}

export interface ClozeCard {
	group: string;
	question: string;
	answer: string;
}

const ANKI_CLOZE_REGEX = /\{\{c(\d+)::([\s\S]+?)(?:::([^{}]*?))?\}\}/g;
const HIGHLIGHT_REGEX = /==([^=\n]+)==/g;
const INLINE_CODE_REGEX = /`[^`\n]*`/g;
/** `#cloze` tag that turns highlight clozes on for one paragraph. */
export const CLOZE_TAG_REGEX = /(^|\s)#cloze(?![\w/-])/i;

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rangesOf(regex: RegExp, text: string): [number, number][] {
	const ranges: [number, number][] = [];
	for (const m of text.matchAll(regex)) {
		const start = m.index ?? 0;
		ranges.push([start, start + m[0].length]);
	}
	return ranges;
}

const overlaps = (ranges: [number, number][], start: number, end: number) =>
	ranges.some(([a, b]) => start < b && end > a);

/** Find the deletions in a paragraph, in document order, ignoring anything inside inline code. */
export function findClozes(text: string, includeHighlights: boolean): ClozeDeletion[] {
	const code = rangesOf(INLINE_CODE_REGEX, text);
	const found: ClozeDeletion[] = [];

	for (const m of text.matchAll(ANKI_CLOZE_REGEX)) {
		const start = m.index ?? 0;
		const end = start + m[0].length;
		if (overlaps(code, start, end) || !m[2].trim()) continue;
		const hint = m[3]?.trim() || null;
		found.push({ start, end, text: m[2].trim(), hint, group: `c${Number(m[1])}` });
	}

	if (includeHighlights) {
		const taken = found.map((d): [number, number] => [d.start, d.end]);
		let n = 0;
		for (const m of text.matchAll(HIGHLIGHT_REGEX)) {
			const start = m.index ?? 0;
			const end = start + m[0].length;
			if (overlaps(code, start, end) || overlaps(taken, start, end) || !m[1].trim()) continue;
			found.push({ start, end, text: m[1].trim(), hint: null, group: `h${++n}` });
		}
	}

	return found.sort((a, b) => a.start - b.start);
}

/** Whether a paragraph contains any deletion. */
export function hasClozes(text: string, includeHighlights: boolean): boolean {
	return findClozes(text, includeHighlights).length > 0;
}

function render(text: string, deletions: ClozeDeletion[], show: (d: ClozeDeletion) => string): string {
	let out = "";
	let pos = 0;
	for (const d of deletions) {
		out += text.slice(pos, d.start) + show(d);
		pos = d.end;
	}
	return out + text.slice(pos);
}

/** Build one card per deletion group, in order of each group's first appearance. */
export function buildClozeCards(text: string, includeHighlights: boolean): ClozeCard[] {
	const deletions = findClozes(text, includeHighlights);
	const groups: string[] = [];
	for (const d of deletions) {
		if (!groups.includes(d.group)) groups.push(d.group);
	}

	return groups.map((group) => ({
		group,
		question: render(text, deletions, (d) =>
			d.group === group
				? `<span class="pomo-fc-cloze-blank">[${d.hint ? escapeHtml(d.hint) : "…"}]</span>`
				: d.text
		).trim(),
		answer: render(text, deletions, (d) =>
			d.group === group ? `<span class="pomo-fc-cloze-answer">${d.text}</span>` : d.text
		).trim(),
	}));
}

/** The next unused Anki cloze number in a paragraph ({{c1::…}} and {{c3::…}} give 4). */
export function nextClozeNumber(text: string): number {
	return maxClozeNumber(text) + 1;
}

/** The highest Anki cloze number in a paragraph, or 0 if there is none. */
export function maxClozeNumber(text: string): number {
	let max = 0;
	for (const m of text.matchAll(ANKI_CLOZE_REGEX)) max = Math.max(max, Number(m[1]));
	return max;
}
