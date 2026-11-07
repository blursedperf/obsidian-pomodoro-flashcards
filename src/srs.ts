import { Rating, SRSMetadata } from "./types";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_EFACTOR = 1.3;
const DEFAULT_EFACTOR = 2.5;

/**
 * Create default SM-2 metadata for a brand-new card.
 */
export function createDefaultSRSMetadata(now: number = Date.now()): SRSMetadata {
	return {
		interval: 0,
		repetition: 0,
		efactor: DEFAULT_EFACTOR,
		dueDate: now,
		lastReviewed: null,
	};
}

/**
 * Compute updated SM-2 metadata based on user rating:
 * - "again": reset repetitions to 0, interval = 0 (due in 10 minutes), reduce efactor by 0.2
 * - "hard": keep progress, smaller interval multiplier (1.2x), reduce efactor by 0.15
 * - "good": standard SM-2 progression (1d -> 6d -> interval * efactor)
 * - "easy": accelerated SM-2 progression (4d -> interval * efactor * 1.3), boost efactor by 0.15
 */
export function calculateSM2(
	current: SRSMetadata,
	rating: Rating,
	now: number = Date.now()
): SRSMetadata {
	let { interval, repetition, efactor } = current;

	if (rating === "again") {
		repetition = 0;
		interval = 0;
		efactor = Math.max(MIN_EFACTOR, Number((efactor - 0.2).toFixed(2)));
		return {
			interval,
			repetition,
			efactor,
			dueDate: now + 10 * MS_PER_MINUTE,
			lastReviewed: now,
		};
	}

	if (rating === "hard") {
		if (repetition === 0) {
			interval = 1;
		} else if (repetition === 1) {
			interval = 3;
		} else {
			interval = Math.max(interval + 1, Math.round(interval * 1.2));
		}
		repetition += 1;
		efactor = Math.max(MIN_EFACTOR, Number((efactor - 0.15).toFixed(2)));
	} else if (rating === "good") {
		if (repetition === 0) {
			interval = 1;
		} else if (repetition === 1) {
			interval = 6;
		} else {
			interval = Math.max(interval + 1, Math.round(interval * efactor));
		}
		repetition += 1;
		// Standard SM-2 grade 4 leaves efactor unchanged
		efactor = Math.max(MIN_EFACTOR, Number(efactor.toFixed(2)));
	} else if (rating === "easy") {
		if (repetition === 0) {
			interval = 4;
		} else if (repetition === 1) {
			interval = 10;
		} else {
			interval = Math.max(interval + 2, Math.round(interval * efactor * 1.3));
		}
		repetition += 1;
		efactor = Math.max(MIN_EFACTOR, Number((efactor + 0.15).toFixed(2)));
	}

	return {
		interval,
		repetition,
		efactor,
		dueDate: now + interval * MS_PER_DAY,
		lastReviewed: now,
	};
}

/**
 * Format an interval for display on rating buttons (e.g. "<10m", "1d", "2.5mo", "1.2y").
 */
export function formatInterval(
	current: SRSMetadata,
	rating: Rating
): string {
	if (rating === "again") {
		return "<10m";
	}
	const next = calculateSM2(current, rating, 0);
	const days = next.interval;
	if (days < 30) {
		return `${days}d`;
	}
	if (days < 365) {
		const months = Number((days / 30).toFixed(1));
		return `${months}mo`;
	}
	const years = Number((days / 365).toFixed(1));
	return `${years}y`;
}

/**
 * Return human-readable next interval labels for all four ratings.
 */
export function previewIntervals(
	current: SRSMetadata
): Record<Rating, string> {
	return {
		again: formatInterval(current, "again"),
		hard: formatInterval(current, "hard"),
		good: formatInterval(current, "good"),
		easy: formatInterval(current, "easy"),
	};
}

/**
 * Check whether a card is currently due for review.
 */
export function isCardDue(
	metadata: SRSMetadata,
	now: number = Date.now()
): boolean {
	return metadata.dueDate <= now;
}

/**
 * Generate a stable, deterministic hash ID from source path and question text.
 */
export function generateCardId(sourcePath: string, question: string): string {
	const normalized = `${sourcePath.trim()}::${question.trim().toLowerCase()}`;
	let hash = 2166136261;
	for (let i = 0; i < normalized.length; i++) {
		hash ^= normalized.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return `fc_${(hash >>> 0).toString(16)}`;
}
