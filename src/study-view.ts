import {
	ItemView,
	MarkdownRenderer,
	Notice,
	Platform,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import PomodoroFlashcardsPlugin from "./main";
import { Flashcard, PomodoroPhase, PomodoroState, Rating } from "./types";
import { isCardDue, previewIntervals } from "./srs";
import { PomodoroTimer } from "./pomodoro";
import { CreateFlashcardModal } from "./create-card-modal";

export const VIEW_TYPE_POMODORO_FLASHCARDS = "pomodoro-flashcards-study-view";

export class FlashcardStudyView extends ItemView {
	private plugin: PomodoroFlashcardsPlugin;
	private unsubscribePomodoro: (() => void) | null = null;

	// Study state
	private selectedDeck = "ALL";
	private studyMode: "due" | "cram" = "due";
	private queue: Flashcard[] = [];
	private currentIndex = 0;
	private isAnswerShown = false;
	private breakOverride = false;

	// DOM references for fast timer updates without re-rendering the card
	private timerTimeEl: HTMLElement | null = null;
	private timerPhaseBadgeEl: HTMLElement | null = null;
	private timerRingCircleEl: SVGCircleElement | null = null;
	private timerToggleBtnEl: HTMLButtonElement | null = null;
	private timerDotsEl: HTMLElement | null = null;
	private sessionStatsEl: HTMLElement | null = null;
	private rootContainerEl: HTMLElement | null = null;
	private bannerEl: HTMLElement | null = null;
	private bannerToggleBtnEl: HTMLButtonElement | null = null;
	private isBannerExpanded = true;
	private cardStageEl: HTMLElement | null = null;
	private deckSelectEl: HTMLSelectElement | null = null;
	private phasePillEls: Map<PomodoroPhase, HTMLButtonElement> = new Map();

	private static readonly RING_RADIUS = 28;
	private static readonly RING_CIRCUMFERENCE =
		2 * Math.PI * FlashcardStudyView.RING_RADIUS;

	constructor(leaf: WorkspaceLeaf, plugin: PomodoroFlashcardsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_POMODORO_FLASHCARDS;
	}

	getDisplayText(): string {
		return "Pomodoro Flashcards";
	}

	getIcon(): string {
		return "timer";
	}

	async onOpen(): Promise<void> {
		this.buildLayout();
		this.rebuildQueue();
		this.renderCardStage();

		// Warm up Web Audio / iOS AudioContext on initial interaction
		this.registerDomEvent(
			this.contentEl,
			"touchstart",
			() => this.plugin.pomodoro.unlockAudio(),
			{ passive: true }
		);
		this.registerDomEvent(this.contentEl, "click", () =>
			this.plugin.pomodoro.unlockAudio()
		);

		this.unsubscribePomodoro = this.plugin.pomodoro.subscribe(
			(state, event) => {
				if (event === "phase-change") {
					this.breakOverride = false;
					this.updatePomodoroDOM(state);
					this.renderCardStage();
				} else {
					this.updatePomodoroDOM(state);
					// Update break countdown text if break screen is active
					if (this.isBreakLocked(state)) {
						const breakClock = this.cardStageEl?.querySelector(
							".pomo-fc-break-countdown"
						);
						if (breakClock) {
							breakClock.textContent = PomodoroTimer.formatTime(
								state.remainingSeconds
							);
						}
					}
				}
			}
		);

		this.registerDomEvent(window, "keydown", (evt: KeyboardEvent) =>
			this.handleKeyDown(evt)
		);
	}

	async onClose(): Promise<void> {
		if (this.unsubscribePomodoro) {
			this.unsubscribePomodoro();
			this.unsubscribePomodoro = null;
		}
		this.contentEl.empty();
	}

	public refreshFromVault(): void {
		this.populateDeckSelector();
		this.rebuildQueue();
		this.renderCardStage();
	}

	private buildLayout(): void {
		const { contentEl } = this;
		contentEl.empty();

		const root = contentEl.createDiv({ cls: "pomo-fc-view-root" });
		this.rootContainerEl = root;

		// 1. Integrated Pomodoro Header
		this.isBannerExpanded =
			!Platform.isMobile || !this.plugin.settings.compactMobileTimer;

		const pomoBanner = root.createDiv({ cls: "pomo-fc-banner" });
		this.bannerEl = pomoBanner;
		if (!this.isBannerExpanded) {
			pomoBanner.addClass("is-collapsed");
		}

		// Main Row: Left (ring, digits, phase badge) + Right controls (start/pause, skip, expand)
		const mainRow = pomoBanner.createDiv({ cls: "pomo-fc-banner-main-row" });

		const pomoLeft = mainRow.createDiv({ cls: "pomo-fc-banner-left" });
		const ringWrapper = pomoLeft.createDiv({ cls: "pomo-fc-ring-wrapper" });

		const svgNS = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(svgNS, "svg");
		svg.setAttribute("class", "pomo-fc-ring-svg");
		svg.setAttribute("viewBox", "0 0 68 68");

		const bgCircle = document.createElementNS(svgNS, "circle");
		bgCircle.setAttribute("class", "pomo-fc-ring-bg");
		bgCircle.setAttribute("cx", "34");
		bgCircle.setAttribute("cy", "34");
		bgCircle.setAttribute("r", String(FlashcardStudyView.RING_RADIUS));
		svg.appendChild(bgCircle);

		const fgCircle = document.createElementNS(svgNS, "circle");
		fgCircle.setAttribute("class", "pomo-fc-ring-fg");
		fgCircle.setAttribute("cx", "34");
		fgCircle.setAttribute("cy", "34");
		fgCircle.setAttribute("r", String(FlashcardStudyView.RING_RADIUS));
		fgCircle.setAttribute(
			"stroke-dasharray",
			String(FlashcardStudyView.RING_CIRCUMFERENCE)
		);
		fgCircle.setAttribute("stroke-dashoffset", "0");
		svg.appendChild(fgCircle);
		this.timerRingCircleEl = fgCircle;
		ringWrapper.appendChild(svg);

		const timeInfo = pomoLeft.createDiv({ cls: "pomo-fc-time-info" });
		const phaseRow = timeInfo.createDiv({ cls: "pomo-fc-phase-row" });
		this.timerPhaseBadgeEl = phaseRow.createSpan({
			cls: "pomo-fc-phase-badge",
			text: "Focus Session",
		});
		this.timerDotsEl = phaseRow.createSpan({ cls: "pomo-fc-dots" });

		this.timerTimeEl = timeInfo.createDiv({
			cls: "pomo-fc-clock-digits",
			text: "25:00",
		});

		// Right: Timer Controls
		const pomoControls = mainRow.createDiv({
			cls: "pomo-fc-banner-controls",
		});
		this.timerToggleBtnEl = pomoControls.createEl("button", {
			cls: "pomo-fc-btn pomo-fc-btn-primary",
			text: "Start",
		});
		this.timerToggleBtnEl.addEventListener("click", () => {
			this.plugin.pomodoro.toggle();
		});

		const skipBtn = pomoControls.createEl("button", {
			cls: "pomo-fc-btn",
			text: "Skip ⏭",
			attr: { title: "Skip to next Pomodoro phase", "aria-label": "Skip phase" },
		});
		skipBtn.addEventListener("click", () => {
			this.plugin.pomodoro.skipPhase();
		});

		this.bannerToggleBtnEl = pomoControls.createEl("button", {
			cls: "pomo-fc-btn pomo-fc-banner-toggle-btn",
			text: this.isBannerExpanded ? "▴" : "▾",
			attr: {
				title: "Toggle timer options and statistics",
				"aria-label": "Toggle timer options and statistics",
			},
		});
		this.bannerToggleBtnEl.addEventListener("click", () => {
			this.toggleBannerDetails();
		});

		// Expandable Section: Phase pills + Session stats
		const expandableSection = pomoBanner.createDiv({
			cls: "pomo-fc-banner-expandable",
		});

		const pomoCenter = expandableSection.createDiv({
			cls: "pomo-fc-banner-center",
		});
		const phasePills = pomoCenter.createDiv({ cls: "pomo-fc-phase-pills" });
		this.phasePillEls.clear();
		const phases: { id: PomodoroPhase; label: string }[] = [
			{ id: "work", label: "Focus" },
			{ id: "short-break", label: "Short Break" },
			{ id: "long-break", label: "Long Break" },
		];
		for (const p of phases) {
			const pill = phasePills.createEl("button", {
				cls: "pomo-fc-phase-pill",
				text: p.label,
			});
			pill.addEventListener("click", () => {
				this.plugin.pomodoro.setPhase(p.id, false);
			});
			this.phasePillEls.set(p.id, pill);
		}

		const resetBtn = phasePills.createEl("button", {
			cls: "pomo-fc-phase-pill pomo-fc-reset-pill",
			text: "↺ Reset",
			attr: { title: "Reset current phase timer" },
		});
		resetBtn.addEventListener("click", () => {
			this.plugin.pomodoro.reset();
		});

		this.sessionStatsEl = pomoCenter.createDiv({
			cls: "pomo-fc-session-stats",
		});

		// 2. Deck & Study Mode Toolbar
		const toolbar = root.createDiv({ cls: "pomo-fc-toolbar" });
		const filterGroup = toolbar.createDiv({
			cls: "pomo-fc-toolbar-group pomo-fc-filter-group",
		});

		if (!Platform.isMobile) {
			filterGroup.createSpan({
				cls: "pomo-fc-toolbar-label",
				text: "Deck:",
			});
		}
		this.deckSelectEl = filterGroup.createEl("select", {
			cls: "dropdown pomo-fc-deck-select",
			attr: { "aria-label": "Select deck" },
		});
		this.populateDeckSelector();
		this.deckSelectEl.addEventListener("change", () => {
			this.selectedDeck = this.deckSelectEl?.value || "ALL";
			this.rebuildQueue();
			this.renderCardStage();
		});

		const modeSelect = filterGroup.createEl("select", {
			cls: "dropdown pomo-fc-mode-select",
			attr: { "aria-label": "Select study mode" },
		});
		modeSelect.createEl("option", {
			value: "due",
			text: Platform.isMobile ? "Due cards" : "Due cards (spaced repetition)",
		});
		modeSelect.createEl("option", {
			value: "cram",
			text: Platform.isMobile ? "Cram all" : "Cram mode (all cards)",
		});
		modeSelect.value = this.studyMode;
		modeSelect.addEventListener("change", () => {
			this.studyMode = modeSelect.value as "due" | "cram";
			this.rebuildQueue();
			this.renderCardStage();
		});

		const actionsGroup = toolbar.createDiv({
			cls: "pomo-fc-toolbar-group pomo-fc-actions-group",
		});
		const newCardBtn = actionsGroup.createEl("button", {
			cls: "pomo-fc-btn pomo-fc-new-card-btn",
			text: Platform.isMobile ? "+ Card" : "+ New card",
			attr: { title: "Create new flashcard" },
		});
		newCardBtn.addEventListener("click", () => {
			new CreateFlashcardModal(this.app, this.plugin, {
				initialDeck:
					this.selectedDeck !== "ALL"
						? this.selectedDeck
						: this.plugin.settings.defaultDeck,
				onCardCreated: () => this.refreshFromVault(),
			}).open();
		});

		const rescanBtn = actionsGroup.createEl("button", {
			cls: "pomo-fc-btn pomo-fc-rescan-btn",
			text: Platform.isMobile ? "↻" : "↻ Rescan",
			attr: {
				title: "Rescan vault Markdown files for flashcards",
				"aria-label": "Rescan vault",
			},
		});
		rescanBtn.addEventListener("click", () => {
			void this.plugin.scanVaultCards().then(() => {
				this.refreshFromVault();
				new Notice(
					`Scanned ${this.plugin.cards.length} flashcards across vault.`
				);
			});
		});

		// 3. Card Stage Container
		this.cardStageEl = root.createDiv({ cls: "pomo-fc-stage" });

		// Initial Pomodoro DOM sync
		this.updatePomodoroDOM(this.plugin.pomodoro.getState());
	}

	private toggleBannerDetails(): void {
		this.isBannerExpanded = !this.isBannerExpanded;
		if (this.bannerEl) {
			this.bannerEl.toggleClass("is-collapsed", !this.isBannerExpanded);
		}
		if (this.bannerToggleBtnEl) {
			this.bannerToggleBtnEl.setText(this.isBannerExpanded ? "▴" : "▾");
			this.bannerToggleBtnEl.setAttribute(
				"aria-label",
				this.isBannerExpanded
					? "Collapse timer details"
					: "Expand timer details"
			);
		}
	}

	private populateDeckSelector(): void {
		if (!this.deckSelectEl) return;
		const previousValue = this.selectedDeck;
		this.deckSelectEl.empty();

		const allCards = this.plugin.cards;
		const now = Date.now();
		const totalDue = allCards.filter((c) => isCardDue(c.srs, now)).length;

		this.deckSelectEl.createEl("option", {
			value: "ALL",
			text: `All decks (${totalDue} due / ${allCards.length} total)`,
		});

		const decks = this.plugin.getDecks();
		for (const deck of decks) {
			const deckCards = allCards.filter((c) => c.deck === deck);
			const deckDue = deckCards.filter((c) => isCardDue(c.srs, now)).length;
			this.deckSelectEl.createEl("option", {
				value: deck,
				text: `${deck} (${deckDue} due / ${deckCards.length} total)`,
			});
		}

		if (
			previousValue === "ALL" ||
			decks.includes(previousValue)
		) {
			this.deckSelectEl.value = previousValue;
		} else {
			this.selectedDeck = "ALL";
			this.deckSelectEl.value = "ALL";
		}
	}

	private rebuildQueue(): void {
		const now = Date.now();
		let filtered = this.plugin.cards;

		if (this.selectedDeck !== "ALL") {
			filtered = filtered.filter((c) => c.deck === this.selectedDeck);
		}

		if (this.studyMode === "due") {
			filtered = filtered
				.filter((c) => isCardDue(c.srs, now))
				.sort((a, b) => a.srs.dueDate - b.srs.dueDate);
		} else {
			filtered = [...filtered];
		}

		this.queue = filtered;
		if (this.currentIndex >= this.queue.length) {
			this.currentIndex = 0;
		}
		this.isAnswerShown = false;
	}

	private isBreakLocked(state: PomodoroState): boolean {
		return (
			this.plugin.settings.lockCardsOnBreak &&
			state.phase !== "work" &&
			!this.breakOverride
		);
	}

	private updatePomodoroDOM(state: PomodoroState): void {
		if (this.rootContainerEl) {
			this.rootContainerEl.setAttribute("data-phase", state.phase);
		}

		if (this.timerTimeEl) {
			this.timerTimeEl.textContent = PomodoroTimer.formatTime(
				state.remainingSeconds
			);
		}

		if (this.timerPhaseBadgeEl) {
			this.timerPhaseBadgeEl.textContent = PomodoroTimer.getPhaseLabel(
				state.phase
			);
		}

		if (this.timerToggleBtnEl) {
			this.timerToggleBtnEl.textContent = state.isRunning ? "Pause" : "Start";
			this.timerToggleBtnEl.toggleClass("is-running", state.isRunning);
		}

		if (this.timerRingCircleEl) {
			const fraction =
				state.totalSeconds > 0
					? state.remainingSeconds / state.totalSeconds
					: 0;
			const offset =
				FlashcardStudyView.RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)));
			this.timerRingCircleEl.setAttribute(
				"stroke-dashoffset",
				offset.toFixed(2)
			);
		}

		if (this.timerDotsEl) {
			const target = Math.max(1, this.plugin.settings.longBreakInterval);
			const filled = state.completedPomodoros % target;
			const dots: string[] = [];
			for (let i = 0; i < target; i++) {
				dots.push(i < filled ? "●" : "○");
			}
			this.timerDotsEl.textContent = dots.join(" ");
			this.timerDotsEl.setAttribute(
				"title",
				`${state.completedPomodoros} Pomodoros completed this session`
			);
		}

		for (const [phase, btn] of this.phasePillEls.entries()) {
			btn.toggleClass("is-active", phase === state.phase);
		}

		if (this.sessionStatsEl) {
			this.sessionStatsEl.textContent = `Session: ${state.cardsReviewedInSession} cards reviewed · ${state.completedPomodoros} 🍅 completed · Streak: ${this.plugin.stats.dailyStreak}d`;
		}
	}

	private renderCardStage(): void {
		if (!this.cardStageEl) return;
		this.cardStageEl.empty();

		const pomoState = this.plugin.pomodoro.getState();

		// 1. Check if Break Mode lock is active
		if (this.isBreakLocked(pomoState)) {
			const breakCard = this.cardStageEl.createDiv({
				cls: "pomo-fc-card pomo-fc-break-card",
			});
			breakCard.createDiv({ cls: "pomo-fc-break-icon", text: "☕" });
			breakCard.createEl("h2", {
				text:
					pomoState.phase === "long-break"
						? "Long break — recharge your mind"
						: "Short break — step back and rest",
			});
			breakCard.createEl("p", {
				cls: "pomo-fc-break-desc",
				text: "Spaced repetition works best when your brain has time to consolidate memories between focus intervals.",
			});
			breakCard.createDiv({
				cls: "pomo-fc-break-countdown",
				text: PomodoroTimer.formatTime(pomoState.remainingSeconds),
			});

			const btnRow = breakCard.createDiv({ cls: "pomo-fc-empty-actions" });
			const startWorkBtn = btnRow.createEl("button", {
				cls: "pomo-fc-btn pomo-fc-btn-primary",
				text: "Start focus session now",
			});
			startWorkBtn.addEventListener("click", () => {
				this.plugin.pomodoro.setPhase("work", true);
			});

			const overrideBtn = btnRow.createEl("button", {
				cls: "pomo-fc-btn",
				text: "Study during break anyway",
			});
			overrideBtn.addEventListener("click", () => {
				this.breakOverride = true;
				this.renderCardStage();
			});
			return;
		}

		// 2. Check if queue is empty
		if (this.queue.length === 0) {
			const emptyCard = this.cardStageEl.createDiv({
				cls: "pomo-fc-card pomo-fc-empty-card",
			});
			const totalInScope =
				this.selectedDeck === "ALL"
					? this.plugin.cards.length
					: this.plugin.cards.filter((c) => c.deck === this.selectedDeck)
							.length;

			if (totalInScope === 0) {
				emptyCard.createDiv({ cls: "pomo-fc-empty-icon", text: "🗂️" });
				emptyCard.createEl("h3", { text: "No flashcards found" });
				emptyCard.createEl("p", {
					text: "Create flashcards using Question :: Answer syntax in any note, or click below to add your first card.",
				});
			} else {
				emptyCard.createDiv({ cls: "pomo-fc-empty-icon", text: "🎉" });
				emptyCard.createEl("h3", {
					text: "All caught up!",
				});
				emptyCard.createEl("p", {
					text: `You have reviewed all due cards in ${
						this.selectedDeck === "ALL" ? "all decks" : this.selectedDeck
					}.`,
				});
			}

			const emptyActions = emptyCard.createDiv({
				cls: "pomo-fc-empty-actions",
			});
			if (totalInScope > 0 && this.studyMode === "due") {
				const cramBtn = emptyActions.createEl("button", {
					cls: "pomo-fc-btn pomo-fc-btn-primary",
					text: `Cram all cards (${totalInScope})`,
				});
				cramBtn.addEventListener("click", () => {
					this.studyMode = "cram";
					const modeSelect = this.rootContainerEl?.querySelector(
						".pomo-fc-mode-select"
					) as HTMLSelectElement | null;
					if (modeSelect) modeSelect.value = "cram";
					this.rebuildQueue();
					this.renderCardStage();
				});
			}

			const createBtn = emptyActions.createEl("button", {
				cls: "pomo-fc-btn",
				text: "+ Create flashcard",
			});
			createBtn.addEventListener("click", () => {
				new CreateFlashcardModal(this.app, this.plugin, {
					initialDeck:
						this.selectedDeck !== "ALL"
							? this.selectedDeck
							: this.plugin.settings.defaultDeck,
					onCardCreated: () => this.refreshFromVault(),
				}).open();
			});
			return;
		}

		// 3. Render the active Flashcard
		const card = this.queue[this.currentIndex];
		const cardEl = this.cardStageEl.createDiv({ cls: "pomo-fc-card" });

		// Card Header: Deck badge, Queue position, SRS metadata, Source Note link
		const cardHeader = cardEl.createDiv({ cls: "pomo-fc-card-header" });
		const headerLeft = cardHeader.createDiv({ cls: "pomo-fc-card-meta-left" });
		headerLeft.createSpan({
			cls: "pomo-fc-deck-badge",
			text: card.deck,
		});
		headerLeft.createSpan({
			cls: "pomo-fc-queue-pos",
			text: `Card ${this.currentIndex + 1} of ${this.queue.length}`,
		});

		const headerRight = cardHeader.createDiv({
			cls: "pomo-fc-card-meta-right",
		});
		headerRight.createSpan({
			cls: "pomo-fc-srs-pill",
			text: `Rep: ${card.srs.repetition} · Ease: ${card.srs.efactor.toFixed(
				2
			)}`,
		});

		// Display shortened note name on mobile to prevent header wrapping
		const baseFileName = card.sourcePath.split("/").pop() || card.sourcePath;
		const displaySource = Platform.isMobile
			? `${baseFileName}:${card.lineStart + 1}`
			: `${card.sourcePath}:${card.lineStart + 1}`;
		const sourceBtn = headerRight.createEl("button", {
			cls: "pomo-fc-source-link",
			text: displaySource,
			attr: {
				title: `Open ${card.sourcePath} (line ${card.lineStart + 1})`,
			},
		});
		sourceBtn.addEventListener("click", () => {
			void this.openCardSource(card);
		});

		// Scrollable Card Body (contains question and answer)
		const cardBodyEl = cardEl.createDiv({ cls: "pomo-fc-card-body" });

		// Question Section
		const questionSection = cardBodyEl.createDiv({
			cls: "pomo-fc-card-section pomo-fc-question-section",
		});
		questionSection.createDiv({
			cls: "pomo-fc-side-label",
			text: "QUESTION",
		});
		const questionContent = questionSection.createDiv({
			cls: "pomo-fc-markdown-body",
		});
		void MarkdownRenderer.render(
			this.app,
			card.question,
			questionContent,
			card.sourcePath,
			this
		);

		if (!this.isAnswerShown) {
			// Allow tapping question to reveal answer
			questionSection.addClass("is-tappable");
			questionSection.addEventListener("click", (evt) => {
				const target = evt.target as HTMLElement | null;
				if (target && target.closest("a, button, select, input, textarea")) {
					return;
				}
				if (this.plugin.settings.enableHaptics) {
					PomodoroTimer.triggerHaptic(10);
				}
				this.revealAnswer();
			});

			// Show Answer Button
			const revealFooter = cardEl.createDiv({ cls: "pomo-fc-card-footer" });
			const showAnswerBtn = revealFooter.createEl("button", {
				cls: "pomo-fc-btn pomo-fc-btn-primary pomo-fc-show-answer-btn",
				text: Platform.isMobile
					? "Show answer (tap)"
					: "Show answer (space)",
			});
			showAnswerBtn.addEventListener("click", () => {
				if (this.plugin.settings.enableHaptics) {
					PomodoroTimer.triggerHaptic(10);
				}
				this.revealAnswer();
			});
		} else {
			// Answer Section
			const answerSection = cardBodyEl.createDiv({
				cls: "pomo-fc-card-section pomo-fc-answer-section",
			});
			answerSection.createDiv({
				cls: "pomo-fc-side-label",
				text: "ANSWER",
			});
			const answerContent = answerSection.createDiv({
				cls: "pomo-fc-markdown-body",
			});
			void MarkdownRenderer.render(
				this.app,
				card.answer,
				answerContent,
				card.sourcePath,
				this
			);

			// Rating Footer
			const ratingFooter = cardEl.createDiv({
				cls: "pomo-fc-card-footer pomo-fc-rating-footer",
			});

			const ratingGrid = ratingFooter.createDiv({
				cls: "pomo-fc-rating-grid",
			});
			const intervals = previewIntervals(card.srs);
			const ratings: {
				id: Rating;
				label: string;
				key: string;
				cls: string;
			}[] = [
				{
					id: "again",
					label: "Again",
					key: "1",
					cls: "pomo-fc-rate-again",
				},
				{ id: "hard", label: "Hard", key: "2", cls: "pomo-fc-rate-hard" },
				{ id: "good", label: "Good", key: "3", cls: "pomo-fc-rate-good" },
				{ id: "easy", label: "Easy", key: "4", cls: "pomo-fc-rate-easy" },
			];

			for (const r of ratings) {
				const btn = ratingGrid.createEl("button", {
					cls: `pomo-fc-rate-btn ${r.cls}`,
				});
				btn.createSpan({
					cls: "pomo-fc-rate-interval",
					text: intervals[r.id],
				});
				const bottomRow = btn.createDiv({ cls: "pomo-fc-rate-label-row" });
				bottomRow.createSpan({ cls: "pomo-fc-rate-label", text: r.label });
				if (!Platform.isMobile) {
					bottomRow.createSpan({ cls: "pomo-fc-rate-key", text: `[${r.key}]` });
				}

				btn.addEventListener("click", () => {
					void this.submitRating(card, r.id);
				});
			}
		}
	}

	private revealAnswer(): void {
		if (this.isAnswerShown || this.queue.length === 0) return;
		this.isAnswerShown = true;
		this.renderCardStage();
	}

	private async submitRating(card: Flashcard, rating: Rating): Promise<void> {
		if (this.plugin.settings.enableHaptics) {
			switch (rating) {
				case "again":
					PomodoroTimer.triggerHaptic([15, 45, 15]);
					break;
				case "hard":
					PomodoroTimer.triggerHaptic(25);
					break;
				case "good":
					PomodoroTimer.triggerHaptic(15);
					break;
				case "easy":
					PomodoroTimer.triggerHaptic([15, 30, 20]);
					break;
			}
		}

		await this.plugin.rateCard(card.id, rating);
		this.plugin.pomodoro.recordCardReview();

		this.populateDeckSelector();

		if (this.studyMode === "due") {
			this.rebuildQueue();
		} else {
			// In cram mode, advance to next card in list
			this.currentIndex =
				(this.currentIndex + 1) % Math.max(1, this.queue.length);
			this.isAnswerShown = false;
		}
		this.renderCardStage();
	}

	private async openCardSource(card: Flashcard): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.sourcePath);
		if (!(file instanceof TFile)) {
			new Notice(`Could not find file: ${card.sourcePath}`);
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file, {
			eState: { line: card.lineStart },
		});
	}

	private handleKeyDown(evt: KeyboardEvent): void {
		// Only handle shortcuts when this study view is active and user isn't typing in an input/textarea
		if (this.app.workspace.getActiveViewOfType(FlashcardStudyView) !== this) {
			return;
		}
		const target = evt.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable)
		) {
			return;
		}

		if (this.isBreakLocked(this.plugin.pomodoro.getState())) {
			return;
		}

		if (this.queue.length === 0) return;
		const currentCard = this.queue[this.currentIndex];

		if (!this.isAnswerShown) {
			if (evt.code === "Space" || evt.code === "Enter") {
				evt.preventDefault();
				this.revealAnswer();
			}
		} else {
			if (evt.key === "1") {
				evt.preventDefault();
				void this.submitRating(currentCard, "again");
			} else if (evt.key === "2") {
				evt.preventDefault();
				void this.submitRating(currentCard, "hard");
			} else if (evt.key === "3" || evt.code === "Space") {
				evt.preventDefault();
				void this.submitRating(currentCard, "good");
			} else if (evt.key === "4") {
				evt.preventDefault();
				void this.submitRating(currentCard, "easy");
			}
		}
	}
}
