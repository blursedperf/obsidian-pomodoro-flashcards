import { Flashcard, SRSMetadata } from "./types";
import { generateCardId } from "./srs";

/**
 * Card IDs are derived from the note path and the question text, so renaming a note or editing a
 * question produces a new ID. These helpers carry review history over to the new IDs so it is
 * never silently reset.
 */

/** Map a path under a renamed file or folder to its new location, or null if it is unaffected. */
export function renamedPath(path: string, oldPath: string, newPath: string): string | null {
	if (path === oldPath) return newPath;
	if (path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length);
	return null;
}

/**
 * Move history for every card in a renamed note (or every note in a renamed folder) to the IDs the
 * cards will have at their new path. Updates `cards` in place. Returns true if anything moved.
 */
export function remapRenamedCards(
	cards: Flashcard[],
	metadata: Record<string, SRSMetadata>,
	oldPath: string,
	newPath: string
): boolean {
	let changed = false;
	for (const card of cards) {
		const target = renamedPath(card.sourcePath, oldPath, newPath);
		if (target === null) continue;
		const newId = generateCardId(target, card.question);
		const saved = metadata[card.id];
		if (saved && newId !== card.id && !metadata[newId]) {
			metadata[newId] = saved;
			delete metadata[card.id];
			changed = true;
		}
		card.id = newId;
		card.sourcePath = target;
	}
	return changed;
}

/**
 * After a note is re-parsed, give each new card that has no history the history of a card from the
 * previous parse of the same note that has disappeared (its question was edited). A disappeared card
 * matches when it had the same answer and started on the same line, then the same answer, then the
 * same line. Each disappeared card is used at most once. Updates `parsed` and `metadata` in place.
 * Returns true if anything moved.
 */
export function carryOverEditedCards(
	previous: Flashcard[],
	parsed: Flashcard[],
	metadata: Record<string, SRSMetadata>
): boolean {
	const currentIds = new Set(parsed.map((c) => c.id));
	const orphans = previous.filter((c) => !currentIds.has(c.id) && metadata[c.id]);
	if (orphans.length === 0) return false;

	const fresh = parsed.filter((c) => !metadata[c.id]);
	let changed = false;
	const passes: ((o: Flashcard, n: Flashcard) => boolean)[] = [
		(o, n) => o.answer === n.answer && o.lineStart === n.lineStart,
		(o, n) => o.answer === n.answer,
		(o, n) => o.lineStart === n.lineStart,
	];
	for (const same of passes) {
		for (const card of fresh) {
			if (metadata[card.id]) continue;
			const idx = orphans.findIndex((o) => same(o, card));
			if (idx === -1) continue;
			const [orphan] = orphans.splice(idx, 1);
			metadata[card.id] = metadata[orphan.id];
			delete metadata[orphan.id];
			card.srs = { ...metadata[card.id] };
			changed = true;
		}
	}
	return changed;
}
