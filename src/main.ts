import {
	Editor,
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
	WorkspaceLeaf,
	debounce,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	DEFAULT_STATS,
	Flashcard,
	PluginData,
	PluginSettings,
	PomodoroState,
	Rating,
	SRSMetadata,
	StudyStats,
} from "./types";
import { calculateSM2, countDueCards } from "./srs";
import { renamedPath } from "./history";
import { parseMarkdownCards } from "./parser";
import { carryOverEditedCards, remapRenamedCards } from "./history";
import { maxClozeNumber, nextClozeNumber } from "./cloze";
import { PomodoroTimer } from "./pomodoro";
import {
	FlashcardStudyView,
	VIEW_TYPE_POMODORO_FLASHCARDS,
} from "./study-view";
import { CreateFlashcardModal } from "./create-card-modal";
import { PomodoroFlashcardsSettingTab } from "./settings";

/** Whether a re-parse produced the same cards (same IDs, text and position) as before. */
function sameCards(a: Flashcard[] | undefined, b: Flashcard[]): boolean {
	const before = a ?? [];
	if (before.length !== b.length) return false;
	return before.every(
		(c, i) =>
			c.id === b[i].id &&
			c.answer === b[i].answer &&
			c.deck === b[i].deck &&
			c.lineStart === b[i].lineStart &&
			c.lineEnd === b[i].lineEnd
	);
}

export default class PomodoroFlashcardsPlugin extends Plugin {
	public settings: PluginSettings = { ...DEFAULT_SETTINGS };
	public cardMetadata: Record<string, SRSMetadata> = {};
	public stats: StudyStats = { ...DEFAULT_STATS };
	public cards: Flashcard[] = [];
	/** Parsed cards per note, so an edit only re-parses the note that changed. */
	private cardsByPath = new Map<string, Flashcard[]>();
	/** Notes waiting to be re-parsed after edits settle. */
	private pendingPaths = new Set<string>();
	/** Cached due count, valid until a card falls due or the cards change. */
	private dueCache: { count: number; validUntil: number } | null = null;
	public pomodoro!: PomodoroTimer;

	private statusBarEl: HTMLElement | null = null;
	private unsubscribeStatusBar: (() => void) | null = null;

	async onload(): Promise<void> {
		await this.loadPluginData();

		// Initialize Pomodoro Timer
		this.pomodoro = new PomodoroTimer(this.settings, (focusMinutes) => {
			this.stats.totalPomodoros += 1;
			this.stats.totalFocusMinutes += focusMinutes;
			this.updateDailyStreak();
			void this.savePluginData();
			new Notice(
				`🍅 Focus session complete! Time for a break (${this.stats.totalPomodoros} total).`
			);
		});

		// Register Study View
		this.registerView(
			VIEW_TYPE_POMODORO_FLASHCARDS,
			(leaf) => new FlashcardStudyView(leaf, this)
		);

		// Ribbon Icons (sentence case)
		this.addRibbonIcon(
			"timer",
			"Open Pomodoro flashcards study view",
			() => {
				void this.activateStudyView();
			}
		);

		this.addRibbonIcon("plus-with-circle", "Create new flashcard", () => {
			new CreateFlashcardModal(this.app, this, {
				onCardCreated: () => this.refreshStudyViews(),
			}).open();
		});

		// Status Bar Indicator (Desktop and Tablet)
		if (!Platform.isPhone) {
			this.statusBarEl = this.addStatusBarItem();
			this.statusBarEl.addClass("pomo-fc-statusbar");
			this.statusBarEl.setAttribute(
				"title",
				"Click to open Pomodoro Flashcards · Right-click to Start/Pause timer"
			);
			this.registerDomEvent(this.statusBarEl, "click", () => {
				void this.activateStudyView();
			});
			this.registerDomEvent(this.statusBarEl, "contextmenu", (evt) => {
				evt.preventDefault();
				this.pomodoro.toggle();
			});

			this.unsubscribeStatusBar = this.pomodoro.subscribe((state) => {
				this.updateStatusBar(state);
			});
		}

		// Register Commands (sentence case)
		this.addCommand({
			id: "open-study-view",
			name: "Open flashcard study and Pomodoro view",
			callback: () => {
				void this.activateStudyView();
			},
		});

		this.addCommand({
			id: "create-flashcard",
			name: "Create new flashcard",
			callback: () => {
				new CreateFlashcardModal(this.app, this, {
					onCardCreated: () => this.refreshStudyViews(),
				}).open();
			},
		});

		this.addCommand({
			id: "create-flashcard-from-selection",
			name: "Create flashcard from selected text",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selected = editor.getSelection().trim();
				let initialQuestion = selected;
				let initialAnswer = "";

				if (selected.includes(this.settings.inlineSeparator)) {
					const idx = selected.indexOf(this.settings.inlineSeparator);
					initialQuestion = selected.slice(0, idx).trim();
					initialAnswer = selected
						.slice(idx + this.settings.inlineSeparator.length)
						.trim();
				}

				new CreateFlashcardModal(this.app, this, {
					initialQuestion,
					initialAnswer,
					targetFilePath: view.file?.path,
					onCardCreated: () => this.refreshStudyViews(),
				}).open();
			},
		});

		this.addCommand({
			id: "wrap-selection-in-cloze",
			name: "Wrap selection in cloze deletion (new card)",
			editorCallback: (editor: Editor) => this.wrapSelectionInCloze(editor, false),
		});

		this.addCommand({
			id: "wrap-selection-in-cloze-same-card",
			name: "Wrap selection in cloze deletion (same card as the last cloze)",
			editorCallback: (editor: Editor) => this.wrapSelectionInCloze(editor, true),
		});

		this.addCommand({
			id: "toggle-pomodoro-timer",
			name: "Start or pause Pomodoro timer",
			callback: () => {
				this.pomodoro.toggle();
				const state = this.pomodoro.getState();
				new Notice(
					state.isRunning
						? `▶️ ${PomodoroTimer.getPhaseLabel(state.phase)} started (${PomodoroTimer.formatTime(state.remainingSeconds)})`
						: "⏸️ Pomodoro timer paused"
				);
			},
		});

		this.addCommand({
			id: "skip-pomodoro-phase",
			name: "Skip Pomodoro phase",
			callback: () => {
				this.pomodoro.skipPhase();
				const state = this.pomodoro.getState();
				new Notice(
					`⏭️ Switched to ${PomodoroTimer.getPhaseLabel(state.phase)}`
				);
			},
		});

		this.addCommand({
			id: "reset-pomodoro-timer",
			name: "Reset Pomodoro timer",
			callback: () => {
				this.pomodoro.reset();
				new Notice("🔄 Pomodoro timer reset");
			},
		});

		this.addCommand({
			id: "scan-vault-flashcards",
			name: "Scan vault for flashcards",
			callback: async () => {
				await this.scanVaultCards();
				this.refreshStudyViews();
				new Notice(
					`Scanned ${this.cards.length} flashcards across vault.`
				);
			},
		});

		// Settings Tab
		this.addSettingTab(new PomodoroFlashcardsSettingTab(this.app, this));

		// Scan vault once layout is ready, and watch for file edits
		this.app.workspace.onLayoutReady(async () => {
			await this.scanVaultCards();
			this.refreshStudyViews();
			this.updateStatusBar(this.pomodoro.getState());
		});

		// Re-parse only the notes that changed, once edits settle. Every changed path is kept, so
		// several notes changing together (sync, link updates after a rename) are all picked up.
		const queue = (path: string) => {
			this.pendingPaths.add(path);
			this.flushPending();
		};

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") queue(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") queue(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				const isNote = file instanceof TFile && file.extension === "md";
				if (!isNote && !(file instanceof TFolder)) return;
				if (remapRenamedCards(this.cards, this.cardMetadata, oldPath, file.path)) {
					void this.savePluginData();
				}
				// Move indexed notes (one note, or every note under a folder) to their new paths
				for (const [path, cards] of [...this.cardsByPath]) {
					const target = renamedPath(path, oldPath, file.path);
					if (target === null) continue;
					this.cardsByPath.delete(path);
					this.cardsByPath.set(target, cards);
					if (this.pendingPaths.delete(path)) this.pendingPaths.add(target);
				}
				if (isNote) queue(file.path);
				this.cardsChanged();
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				this.pendingPaths.delete(file.path);
				if (this.cardsByPath.delete(file.path)) {
					this.cardsChanged();
					this.refreshStudyViews();
				}
			})
		);
	}

	onunload(): void {
		this.flushPending.cancel();
		this.requestFullRescan.cancel();
		if (this.unsubscribeStatusBar) {
			this.unsubscribeStatusBar();
			this.unsubscribeStatusBar = null;
		}
		this.pomodoro?.destroy();
	}

	/**
	 * Wrap the selection in {{cN::...}}. A new card takes the next unused number in the paragraph;
	 * "same card" reuses the highest number so the deletions are hidden together. With no selection,
	 * inserts an empty cloze and puts the cursor inside it.
	 */
	private wrapSelectionInCloze(editor: Editor, sameCard: boolean): void {
		const from = editor.getCursor("from");
		let first = from.line;
		let last = from.line;
		while (first > 0 && editor.getLine(first - 1).trim() !== "") first--;
		while (last < editor.lastLine() && editor.getLine(last + 1).trim() !== "") last++;
		const paragraph = editor.getRange({ line: first, ch: 0 }, { line: last, ch: editor.getLine(last).length });

		const n = sameCard ? Math.max(1, maxClozeNumber(paragraph)) : nextClozeNumber(paragraph);
		const opening = `{{c${n}::`;
		const selection = editor.getSelection();
		editor.replaceSelection(`${opening}${selection}}}`);
		if (!selection) {
			editor.setCursor({ line: from.line, ch: from.ch + opening.length });
		}
	}

	public async activateStudyView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_POMODORO_FLASHCARDS);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			// Always create a new tab so user notes are preserved on mobile & desktop
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_POMODORO_FLASHCARDS,
				active: true,
			});
		}

		workspace.setActiveLeaf(leaf, { focus: true });
		await workspace.revealLeaf(leaf);
	}

	private flushPending = debounce(
		async () => {
			await this.reindexPendingFiles();
		},
		1000,
		true
	);

	/** Re-parse the whole vault once settings stop changing (text settings change per keystroke). */
	public requestFullRescan = debounce(
		async () => {
			await this.scanVaultCards();
			this.refreshStudyViews();
		},
		800,
		true
	);

	/** Parse every note in the vault (on load, on request, and when parsing settings change). */
	public async scanVaultCards(): Promise<void> {
		const now = Date.now();
		const next = new Map<string, Flashcard[]>();
		let historyMoved = false;
		this.pendingPaths.clear();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const result = await this.parseFile(file, now);
			if (!result) continue;
			if (result.historyMoved) historyMoved = true;
			if (result.cards.length > 0) next.set(file.path, result.cards);
		}

		this.cardsByPath = next;
		this.cardsChanged();
		if (historyMoved) {
			await this.savePluginData();
		}
	}

	/** Re-parse the notes queued by vault events, then refresh views if anything changed. */
	private async reindexPendingFiles(): Promise<void> {
		const paths = [...this.pendingPaths];
		this.pendingPaths.clear();
		const now = Date.now();
		let changed = false;
		let historyMoved = false;

		for (const path of paths) {
			const file = this.app.vault.getFileByPath(path);
			const result = file ? await this.parseFile(file, now) : null;
			if (!result) {
				changed = this.cardsByPath.delete(path) || changed;
				continue;
			}
			if (result.historyMoved) historyMoved = true;
			// Keep the existing card objects when nothing changed, so views and ratings keep
			// pointing at the cards in the index.
			if (!result.historyMoved && sameCards(this.cardsByPath.get(path), result.cards)) continue;
			if (result.cards.length > 0) this.cardsByPath.set(path, result.cards);
			else this.cardsByPath.delete(path);
			changed = true;
		}

		if (historyMoved) await this.savePluginData();
		if (changed) {
			this.cardsChanged();
			this.refreshStudyViews();
		}
	}

	/** Read and parse one note, carrying review history over from its previous parse. */
	private async parseFile(
		file: TFile,
		now: number
	): Promise<{ cards: Flashcard[]; historyMoved: boolean } | null> {
		try {
			const content = await this.app.vault.cachedRead(file);
			const cards = parseMarkdownCards(content, file.path, this.settings, this.cardMetadata, now);
			const previous = this.cardsByPath.get(file.path);
			const historyMoved = previous ? carryOverEditedCards(previous, cards, this.cardMetadata) : false;
			return { cards, historyMoved };
		} catch {
			return null; // unreadable file
		}
	}

	/** Rebuild the flat card list after the per-note index changed. */
	private cardsChanged(): void {
		this.cards = [...this.cardsByPath.values()].flat();
		this.dueCache = null;
		this.updateStatusBar(this.pomodoro.getState());
	}

	public getDecks(): string[] {
		const deckSet = new Set<string>();
		deckSet.add(this.settings.defaultDeck || "General");
		for (const card of this.cards) {
			if (card.deck) {
				deckSet.add(card.deck);
			}
		}
		return Array.from(deckSet).sort((a, b) => a.localeCompare(b));
	}

	public async rateCard(cardId: string, rating: Rating): Promise<void> {
		const card = this.cards.find((c) => c.id === cardId);
		if (!card) return;

		const updatedSRS = calculateSM2(card.srs, rating, Date.now());
		card.srs = updatedSRS;
		this.cardMetadata[cardId] = updatedSRS;
		this.dueCache = null;

		this.stats.totalCardsReviewed += 1;
		this.updateDailyStreak();

		await this.savePluginData();
		this.updateStatusBar(this.pomodoro.getState());
	}

	public refreshStudyViews(): void {
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_POMODORO_FLASHCARDS
		);
		for (const leaf of leaves) {
			if (leaf.view instanceof FlashcardStudyView) {
				leaf.view.refreshFromVault();
			}
		}
	}

	private updateDailyStreak(): void {
		const today = new Date().toISOString().slice(0, 10);
		if (this.stats.lastStudyDate === today) {
			return;
		}
		if (this.stats.lastStudyDate) {
			const last = new Date(this.stats.lastStudyDate + "T00:00:00Z");
			const curr = new Date(today + "T00:00:00Z");
			const diffDays = Math.round(
				(curr.getTime() - last.getTime()) / (24 * 60 * 60 * 1000)
			);
			if (diffDays === 1) {
				this.stats.dailyStreak += 1;
			} else if (diffDays > 1) {
				this.stats.dailyStreak = 1;
			}
		} else {
			this.stats.dailyStreak = 1;
		}
		this.stats.lastStudyDate = today;
	}

	private updateStatusBar(state: PomodoroState): void {
		if (!this.statusBarEl) return;
		const icon =
			state.phase === "work"
				? state.isRunning
					? "🍅"
					: "⏸️"
				: "☕";
		const timeStr = PomodoroTimer.formatTime(state.remainingSeconds);
		const now = Date.now();
		if (!this.dueCache || now >= this.dueCache.validUntil) {
			const { count, nextChangeAt } = countDueCards(this.cards, now);
			this.dueCache = { count, validUntil: nextChangeAt };
		}
		const dueCount = this.dueCache.count;

		this.statusBarEl.textContent = `${icon} ${timeStr} · 🗂️ ${dueCount} due`;
		this.statusBarEl.toggleClass("is-running", state.isRunning);
		this.statusBarEl.toggleClass("is-break", state.phase !== "work");
	}

	public async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings);
		this.cardMetadata = raw?.cardMetadata ?? {};
		this.stats = Object.assign({}, DEFAULT_STATS, raw?.stats);
	}

	public async savePluginData(): Promise<void> {
		const payload: PluginData = {
			settings: this.settings,
			cardMetadata: this.cardMetadata,
			stats: this.stats,
		};
		await this.saveData(payload);
	}
}
