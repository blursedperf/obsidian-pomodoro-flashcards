import { Flashcard, PluginSettings, SRSMetadata } from "./types";
import { createDefaultSRSMetadata, generateCardId } from "./srs";
import { buildClozeCards, CLOZE_TAG_REGEX, hasClozes } from "./cloze";
import {
	CaseField,
	CaseRecord,
	bareTag,
	buildCaseCards,
	caseFieldFor,
	cleanCaseName,
	collectCaseFields,
	frontmatterHasTag,
	hasTag,
	parseBracketFields,
	parseFrontmatter,
	parseLineField,
} from "./cases";

export interface RawParsedCard {
	question: string;
	answer: string;
	deck: string;
	lineStart: number;
	lineEnd: number;
	clozeGroup?: string;
	caseCard?: string;
}

/** A Markdown ATX heading (`# Title` … `###### Title`), as opposed to a line that starts with a `#tag`. */
const HEADING_REGEX = /^#{1,6}(?:\s|$)/;

export function isHeadingLine(trimmed: string): boolean {
	return HEADING_REGEX.test(trimmed);
}

/**
 * Find card separators in a line. A separator only counts when it stands on its own, with whitespace
 * on both sides (`Question :: Answer`), and sits outside `[...]`, `(...)`, `{...}` and inline code. This keeps
 * inline fields (`held:: appeal allowed`, `[court:: HL]`) and other `::` text from becoming cards.
 * Returns the indexes of every standalone occurrence.
 */
export function findSeparators(text: string, sep: string): number[] {
	const found: number[] = [];
	if (!sep) return found;
	let depth = 0;
	let inCode = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "`") {
			inCode = !inCode;
			continue;
		}
		if (inCode) continue;
		if (ch === "[" || ch === "(" || ch === "{") {
			depth++;
			continue;
		}
		if ((ch === "]" || ch === ")" || ch === "}") && depth > 0) {
			depth--;
			continue;
		}
		if (depth > 0 || !text.startsWith(sep, i)) continue;
		const before = text[i - 1];
		const after = text[i + sep.length];
		if (before !== undefined && /\s/.test(before) && after !== undefined && /\s/.test(after)) {
			found.push(i);
			i += sep.length - 1;
		}
	}
	return found;
}

/**
 * Extract deck name from YAML frontmatter or inline tags if present.
 */
function extractFileDeck(lines: string[], defaultDeck: string): {
	deck: string;
	contentStartLine: number;
	highlightClozes: boolean;
} {
	let deck = defaultDeck;
	let contentStartLine = 0;
	let highlightClozes = false;

	if (lines.length > 0 && lines[0].trim() === "---") {
		for (let i = 1; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed === "---" || trimmed === "...") {
				contentStartLine = i + 1;
				break;
			}
			const deckMatch = trimmed.match(/^deck\s*:\s*["']?([^"'\n]+)["']?$/i);
			if (deckMatch) {
				deck = deckMatch[1].trim();
			}
			if (/^cloze\s*:\s*["']?true["']?$/i.test(trimmed)) {
				highlightClozes = true;
			}
		}
	}

	return { deck, contentStartLine, highlightClozes };
}

/**
 * Extract `#deck/Name` or `#flashcard/Name` tag from a string, returning the cleaned text and optional deck override.
 */
function extractInlineDeckAndCleanTags(
	text: string,
	flashcardTag: string
): { cleaned: string; deckOverride: string | null } {
	let deckOverride: string | null = null;
	let cleaned = text;

	const deckTagRegex = /#(?:deck|flashcards?)\/([A-Za-z0-9_\-/]+)/g;
	let match: RegExpExecArray | null;
	while ((match = deckTagRegex.exec(text)) !== null) {
		deckOverride = match[1];
	}

	cleaned = cleaned.replace(deckTagRegex, "");
	if (flashcardTag) {
		const escapedTag = flashcardTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		cleaned = cleaned.replace(new RegExp(`${escapedTag}\\b`, "gi"), "");
	}

	return {
		cleaned: cleaned.trim(),
		deckOverride,
	};
}

/**
 * Parse flashcards from a Markdown document string.
 * Pure function (does not depend on Obsidian runtime), making it easy to test and fast to run.
 */
export function parseMarkdownCards(
	content: string,
	sourcePath: string,
	settings: PluginSettings,
	savedMetadata: Record<string, SRSMetadata>,
	now: number = Date.now()
): Flashcard[] {
	const lines = content.split(/\r?\n/);
	const { deck: fileDeck, contentStartLine, highlightClozes: noteHighlightClozes } = extractFileDeck(
		lines,
		settings.defaultDeck
	);

	let currentDeck = fileDeck;
	let inCodeFence = false;
	const rawCards: RawParsedCard[] = [];

	const inlineSep = settings.inlineSeparator || "::";
	const bidiSep = settings.bidirectionalSeparator || ":::";
	const multiSep = settings.multilineSeparator || "?";
	const flashcardTag = settings.flashcardTag || "#flashcard";
	const isStandaloneDeckLine = (t: string) =>
		(t.startsWith("#deck/") || t.startsWith("#flashcard/")) &&
		extractInlineDeckAndCleanTags(t, flashcardTag).cleaned === "";
	const isFence = (t: string) => t.startsWith("```") || t.startsWith("~~~");
	// Case cards: a case note is tagged in its properties or has a line that is just the case tag
	const caseTag = settings.caseTag || "#case-law";
	const isCaseTagLine = (t: string) => t.toLowerCase() === "#" + bareTag(caseTag);
	const frontmatter = settings.caseCards ? parseFrontmatter(lines).data : {};
	const isCaseNote =
		settings.caseCards &&
		(frontmatterHasTag(frontmatter, caseTag) ||
			lines.slice(contentStartLine).some((l) => isCaseTagLine(l.trim())));
	const noteFileName = (sourcePath.split("/").pop() ?? sourcePath).replace(/\.md$/i, "");
	const noteCase: CaseRecord = { name: "", fields: {}, lines: {}, defaultLine: 0 };
	let lastHeading = "";
	const pushCaseCards = (record: CaseRecord, deck: string) => {
		for (const card of buildCaseCards(record, settings.reverseCaseCards)) {
			rawCards.push({
				question: card.question,
				answer: card.answer,
				deck,
				lineStart: card.line,
				lineEnd: card.line,
				caseCard: card.kind,
			});
		}
	};

	/** Lines that make a paragraph a basic card, which takes precedence over clozes. */
	const isBasicCardLine = (t: string) =>
		/^[QA]:\s+/i.test(t) ||
		t === multiSep ||
		findSeparators(t, bidiSep).length > 0 ||
		findSeparators(t, inlineSep).length > 0;

	let i = contentStartLine;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();

		// Track fenced code blocks so we don't accidentally parse code as flashcards
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			inCodeFence = !inCodeFence;
			i++;
			continue;
		}
		if (inCodeFence) {
			i++;
			continue;
		}

		// Track deck overrides on headings (e.g. "## Cellular Biology #deck/Biology").
		// Lines that merely start with a tag ("#torts Duty :: ...") are not headings.
		if (isHeadingLine(trimmed)) {
			const { deckOverride } = extractInlineDeckAndCleanTags(
				trimmed,
				flashcardTag
			);
			if (deckOverride) {
				currentDeck = deckOverride;
			}
			lastHeading = cleanCaseName(trimmed.replace(/^#{1,6}\s*/, ""));
			i++;
			continue;
		}

		// Standalone deck tag line
		if (trimmed.startsWith("#deck/") || trimmed.startsWith("#flashcard/")) {
			const { deckOverride } = extractInlineDeckAndCleanTags(
				trimmed,
				flashcardTag
			);
			if (deckOverride) {
				currentDeck = deckOverride;
				i++;
				continue;
			}
		}

		// 0. Cloze paragraph: consecutive non-blank lines with {{c1::...}} or ==highlight== deletions
		const prevTrimmed = i > contentStartLine ? lines[i - 1].trim() : "";
		const atParagraphStart =
			i === contentStartLine ||
			prevTrimmed === "" ||
			isHeadingLine(prevTrimmed) ||
			isFence(prevTrimmed) ||
			isStandaloneDeckLine(prevTrimmed);
		if (atParagraphStart) {
			let end = i;
			while (
				end < lines.length &&
				lines[end].trim() !== "" &&
				!isHeadingLine(lines[end].trim()) &&
				!isFence(lines[end].trim())
			) {
				end++;
			}
			const paraLines = lines.slice(i, end);
			const paraText = paraLines.join("\n");
			const useHighlights =
				settings.highlightClozes || noteHighlightClozes || CLOZE_TAG_REGEX.test(paraText);
			if (
				hasClozes(paraText, useHighlights) &&
				!paraLines.some((l) => isBasicCardLine(l.trim())) &&
				(end >= lines.length || lines[end].trim() !== multiSep)
			) {
				const { cleaned, deckOverride } = extractInlineDeckAndCleanTags(paraText, flashcardTag);
				const text = cleaned.replace(new RegExp(CLOZE_TAG_REGEX.source, "gi"), "$1").trim();
				for (const cloze of buildClozeCards(text, useHighlights)) {
					rawCards.push({
						question: cloze.question,
						answer: cloze.answer,
						deck: deckOverride || currentDeck,
						lineStart: i,
						lineEnd: end - 1,
						clozeGroup: cloze.group,
					});
				}
				i = end;
				continue;
			}
		}

		// Case cards from a case line: "Name #case-law [court:: HL] [year:: 1932] [ratio:: ...]"
		if (settings.caseCards && hasTag(trimmed, caseTag)) {
			const { fields: raw, rest } = parseBracketFields(trimmed);
			const record: CaseRecord = { name: "", fields: {}, lines: {}, defaultLine: i };
			collectCaseFields(raw, record.fields);
			const hasContent = Object.keys(record.fields).some((f) => f !== "name");
			if (hasContent) {
				const { deckOverride } = extractInlineDeckAndCleanTags(trimmed, flashcardTag);
				record.name = cleanCaseName(rest) || record.fields.name || lastHeading || noteFileName;
				pushCaseCards(record, deckOverride || currentDeck);
				i++;
				continue;
			}
			if (isCaseTagLine(trimmed)) {
				i++;
				continue;
			}
		}

		// Case note fields: "Ratio:: ..." lines (the :: directly after the key)
		if (isCaseNote) {
			const lineField = parseLineField(trimmed);
			const field: CaseField | null = lineField ? caseFieldFor(lineField.key) : null;
			if (lineField && field) {
				if (lineField.value && !noteCase.fields[field]) {
					noteCase.fields[field] = lineField.value;
					noteCase.lines[field] = i;
				}
				i++;
				continue;
			}
		}

		// 1. Check Q: / A: block format
		if (/^Q:\s+/i.test(trimmed)) {
			const qStart = i;
			const qLines: string[] = [trimmed.replace(/^Q:\s+/i, "")];
			i++;
			while (
				i < lines.length &&
				lines[i].trim() !== "" &&
				!/^A:\s+/i.test(lines[i].trim())
			) {
				qLines.push(lines[i]);
				i++;
			}
			if (i < lines.length && /^A:\s+/i.test(lines[i].trim())) {
				const aLines: string[] = [lines[i].trim().replace(/^A:\s+/i, "")];
				i++;
				while (
					i < lines.length &&
					lines[i].trim() !== "" &&
					!/^Q:\s+/i.test(lines[i].trim()) &&
					!isHeadingLine(lines[i].trim())
				) {
					aLines.push(lines[i]);
					i++;
				}
				const rawQ = qLines.join("\n").trim();
				const rawA = aLines.join("\n").trim();
				const { cleaned: cleanQ, deckOverride: qDeck } =
					extractInlineDeckAndCleanTags(rawQ, flashcardTag);
				const { cleaned: cleanA, deckOverride: aDeck } =
					extractInlineDeckAndCleanTags(rawA, flashcardTag);

				if (cleanQ && cleanA) {
					rawCards.push({
						question: cleanQ,
						answer: cleanA,
						deck: aDeck || qDeck || currentDeck,
						lineStart: qStart,
						lineEnd: i - 1,
					});
				}
				continue;
			}
			continue;
		}

		// 2. Check bidirectional single-line separator (:::)
		const bidiAt = findSeparators(trimmed, bidiSep);
		if (bidiAt.length === 1) {
			const rawLeft = trimmed.slice(0, bidiAt[0]).replace(/^[-*+]\s+/, "").trim();
			const rawRight = trimmed.slice(bidiAt[0] + bidiSep.length).trim();
			const { cleaned: leftClean, deckOverride: d1 } =
				extractInlineDeckAndCleanTags(rawLeft, flashcardTag);
			const { cleaned: rightClean, deckOverride: d2 } =
				extractInlineDeckAndCleanTags(rawRight, flashcardTag);
			const cardDeck = d2 || d1 || currentDeck;

			if (leftClean && rightClean) {
				rawCards.push({
					question: leftClean,
					answer: rightClean,
					deck: cardDeck,
					lineStart: i,
					lineEnd: i,
				});
				rawCards.push({
					question: rightClean,
					answer: leftClean,
					deck: cardDeck,
					lineStart: i,
					lineEnd: i,
				});
				i++;
				continue;
			}
		}

		// 3. Check standard single-line separator (::)
		const inlineAt = findSeparators(trimmed, inlineSep);
		if (inlineAt.length > 0) {
			const sepIndex = inlineAt[0];
			const rawQ = trimmed.slice(0, sepIndex).replace(/^[-*+]\s+/, "").trim();
			const rawA = trimmed.slice(sepIndex + inlineSep.length).trim();
			const { cleaned: cleanQ, deckOverride: d1 } =
				extractInlineDeckAndCleanTags(rawQ, flashcardTag);
			const { cleaned: cleanA, deckOverride: d2 } =
				extractInlineDeckAndCleanTags(rawA, flashcardTag);

			if (cleanQ && cleanA) {
				rawCards.push({
					question: cleanQ,
					answer: cleanA,
					deck: d2 || d1 || currentDeck,
					lineStart: i,
					lineEnd: i,
				});
				i++;
				continue;
			}
		}

		// 4. Check multi-line flashcard separated by a standalone `?` (or configured multilineSeparator) line
		if (trimmed === multiSep && i > contentStartLine) {
			// Walk backwards to find the question block (up to previous blank line or heading)
			let qStart = i - 1;
			while (
				qStart > contentStartLine &&
				lines[qStart - 1].trim() !== "" &&
				!isHeadingLine(lines[qStart - 1].trim())
			) {
				qStart--;
			}
			const qLines = lines.slice(qStart, i);
			const rawQ = qLines.join("\n").trim();

			// Walk forwards to collect the answer block (up to next blank line or heading)
			let aEnd = i + 1;
			const aLines: string[] = [];
			let answerInFence = false;
			while (aEnd < lines.length) {
				const aTrimmed = lines[aEnd].trim();
				if (aTrimmed.startsWith("```") || aTrimmed.startsWith("~~~")) {
					answerInFence = !answerInFence;
				}
				if (!answerInFence && aTrimmed === "") {
					break;
				}
				aLines.push(lines[aEnd]);
				aEnd++;
			}

			const rawA = aLines.join("\n").trim();
			const { cleaned: cleanQ, deckOverride: d1 } =
				extractInlineDeckAndCleanTags(rawQ, flashcardTag);
			const { cleaned: cleanA, deckOverride: d2 } =
				extractInlineDeckAndCleanTags(rawA, flashcardTag);

			if (cleanQ && cleanA) {
				rawCards.push({
					question: cleanQ,
					answer: cleanA,
					deck: d2 || d1 || currentDeck,
					lineStart: qStart,
					lineEnd: aEnd - 1,
				});
				i = aEnd;
				continue;
			}
		}

		i++;
	}

	if (isCaseNote) {
		collectCaseFields(frontmatter, noteCase.fields);
		noteCase.name = cleanCaseName(noteCase.fields.name ?? "") || noteFileName;
		pushCaseCards(noteCase, fileDeck);
	}

	// Convert raw parsed cards into Flashcard objects with SRS metadata
	return rawCards.map((raw) => {
		const id = generateCardId(sourcePath, raw.question);
		const existingSRS = savedMetadata[id];
		return {
			id,
			question: raw.question,
			answer: raw.answer,
			deck: raw.deck || settings.defaultDeck,
			sourcePath,
			lineStart: raw.lineStart,
			lineEnd: raw.lineEnd,
			srs: existingSRS ? { ...existingSRS } : createDefaultSRSMetadata(now),
			...(raw.clozeGroup ? { clozeGroup: raw.clozeGroup } : {}),
			...(raw.caseCard ? { caseCard: raw.caseCard } : {}),
		};
	});
}

/**
 * Format a flashcard as Markdown text to append to a note.
 */
export function formatFlashcardMarkdown(
	question: string,
	answer: string,
	deck: string,
	settings: PluginSettings
): string {
	const cleanQ = question.trim();
	const cleanA = answer.trim();
	const sanitizedDeck = deck.trim().replace(/\s+/g, "-");
	const deckTag =
		sanitizedDeck && sanitizedDeck !== settings.defaultDeck
			? ` #deck/${sanitizedDeck}`
			: "";

	const isMultiline = cleanQ.includes("\n") || cleanA.includes("\n");
	if (isMultiline) {
		return `\n${cleanQ}${deckTag}\n${settings.multilineSeparator}\n${cleanA}\n`;
	}
	return `\n${cleanQ} ${settings.inlineSeparator} ${cleanA}${deckTag}`;
}
