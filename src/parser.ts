import { Flashcard, PluginSettings, SRSMetadata } from "./types";
import { createDefaultSRSMetadata, generateCardId } from "./srs";

export interface RawParsedCard {
	question: string;
	answer: string;
	deck: string;
	lineStart: number;
	lineEnd: number;
}

/**
 * Extract deck name from YAML frontmatter or inline tags if present.
 */
function extractFileDeck(lines: string[], defaultDeck: string): {
	deck: string;
	contentStartLine: number;
} {
	let deck = defaultDeck;
	let contentStartLine = 0;

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
		}
	}

	return { deck, contentStartLine };
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
	const { deck: fileDeck, contentStartLine } = extractFileDeck(
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

		// Track deck overrides on headings (e.g. "## Cellular Biology #deck/Biology")
		if (trimmed.startsWith("#")) {
			const { deckOverride } = extractInlineDeckAndCleanTags(
				trimmed,
				flashcardTag
			);
			if (deckOverride) {
				currentDeck = deckOverride;
			}
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
					!lines[i].trim().startsWith("#")
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
		if (bidiSep && trimmed.includes(bidiSep)) {
			const parts = trimmed.split(bidiSep);
			if (parts.length === 2) {
				const rawLeft = parts[0].replace(/^[-*+]\s+/, "").trim();
				const rawRight = parts[1].trim();
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
		}

		// 3. Check standard single-line separator (::)
		if (inlineSep && trimmed.includes(inlineSep)) {
			const sepIndex = trimmed.indexOf(inlineSep);
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
				!lines[qStart - 1].trim().startsWith("#")
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
