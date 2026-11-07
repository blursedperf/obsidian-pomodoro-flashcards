export type Rating = "again" | "hard" | "good" | "easy";

export type PomodoroPhase = "work" | "short-break" | "long-break";

export interface SRSMetadata {
	/** Interval in days (0 means learning/relearning within current session) */
	interval: number;
	/** Number of consecutive successful recalls */
	repetition: number;
	/** Easiness factor (minimum 1.3, default 2.5) */
	efactor: number;
	/** Timestamp (ms) when the card is next due */
	dueDate: number;
	/** Timestamp (ms) when the card was last reviewed */
	lastReviewed: number | null;
}

export interface Flashcard {
	/** Deterministic unique ID derived from file path and question text */
	id: string;
	/** Front of card (Markdown supported) */
	question: string;
	/** Back of card (Markdown supported) */
	answer: string;
	/** Deck name (derived from #deck/... tag, frontmatter, or default) */
	deck: string;
	/** Vault-relative path to the source Markdown note */
	sourcePath: string;
	/** 0-based start line in source note */
	lineStart: number;
	/** 0-based end line in source note */
	lineEnd: number;
	/** Spaced repetition scheduling metadata */
	srs: SRSMetadata;
}

export interface PomodoroState {
	phase: PomodoroPhase;
	remainingSeconds: number;
	totalSeconds: number;
	isRunning: boolean;
	completedPomodoros: number;
	cardsReviewedInSession: number;
}

export interface StudyStats {
	totalPomodoros: number;
	totalFocusMinutes: number;
	totalCardsReviewed: number;
	dailyStreak: number;
	lastStudyDate: string | null;
}

export interface PluginSettings {
	/** Work session duration in minutes */
	workDuration: number;
	/** Short break duration in minutes */
	shortBreakDuration: number;
	/** Long break duration in minutes */
	longBreakDuration: number;
	/** Number of work sessions before a long break */
	longBreakInterval: number;
	/** Automatically start break timer when work session ends */
	autoStartBreaks: boolean;
	/** Automatically start work timer when break ends */
	autoStartWork: boolean;
	/** Lock/pause flashcard deck during breaks to enforce rest */
	lockCardsOnBreak: boolean;
	/** Play an audio chime when a Pomodoro phase finishes */
	playSound: boolean;
	/** Default Markdown file where newly created flashcards are appended */
	defaultFlashcardNote: string;
	/** Default deck name when none is specified */
	defaultDeck: string;
	/** Separator for single-line flashcards (e.g., Question :: Answer) */
	inlineSeparator: string;
	/** Separator for bidirectional single-line flashcards (e.g., Term ::: Definition) */
	bidirectionalSeparator: string;
	/** Separator line for multi-line flashcards */
	multilineSeparator: string;
	/** Tag used to identify flashcard blocks or notes */
	flashcardTag: string;
}

export interface PluginData {
	settings: PluginSettings;
	cardMetadata: Record<string, SRSMetadata>;
	stats: StudyStats;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	workDuration: 25,
	shortBreakDuration: 5,
	longBreakDuration: 15,
	longBreakInterval: 4,
	autoStartBreaks: true,
	autoStartWork: false,
	lockCardsOnBreak: true,
	playSound: true,
	defaultFlashcardNote: "Flashcards.md",
	defaultDeck: "General",
	inlineSeparator: "::",
	bidirectionalSeparator: ":::",
	multilineSeparator: "?",
	flashcardTag: "#flashcard",
};

export const DEFAULT_STATS: StudyStats = {
	totalPomodoros: 0,
	totalFocusMinutes: 0,
	totalCardsReviewed: 0,
	dailyStreak: 0,
	lastStudyDate: null,
};
