import {
	Editor,
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	TFile,
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
import { calculateSM2, isCardDue } from "./srs";
import { parseMarkdownCards } from "./parser";
import { PomodoroTimer } from "./pomodoro";
import {
	FlashcardStudyView,
	VIEW_TYPE_POMODORO_FLASHCARDS,
} from "./study-view";
import { CreateFlashcardModal } from "./create-card-modal";
import { PomodoroFlashcardsSettingTab } from "./settings";

export default class PomodoroFlashcardsPlugin extends Plugin {
	public settings: PluginSettings = { ...DEFAULT_SETTINGS };
	public cardMetadata: Record<string, SRSMetadata> = {};
	public stats: StudyStats = { ...DEFAULT_STATS };
	public cards: Flashcard[] = [];
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

		const debouncedRescan = debounce(
			async () => {
				await this.scanVaultCards();
				this.refreshStudyViews();
				this.updateStatusBar(this.pomodoro.getState());
			},
			1000,
			true
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					debouncedRescan();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					debouncedRescan();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					debouncedRescan();
				}
			})
		);
	}

	onunload(): void {
		if (this.unsubscribeStatusBar) {
			this.unsubscribeStatusBar();
			this.unsubscribeStatusBar = null;
		}
		this.pomodoro?.destroy();
	}

	public async activateStudyView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
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

	public async scanVaultCards(): Promise<void> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const allCards: Flashcard[] = [];
		const now = Date.now();

		for (const file of markdownFiles) {
			try {
				const content = await this.app.vault.cachedRead(file);
				const parsed = parseMarkdownCards(
					content,
					file.path,
					this.settings,
					this.cardMetadata,
					now
				);
				if (parsed.length > 0) {
					allCards.push(...parsed);
				}
			} catch {
				// Skip unreadable files
			}
		}

		this.cards = allCards;
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
		const dueCount = this.cards.filter((c) => isCardDue(c.srs, now)).length;

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
