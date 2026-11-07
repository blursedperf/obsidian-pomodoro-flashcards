import { App, MarkdownView, Modal, Notice, Platform, Setting, TFile } from "obsidian";
import PomodoroFlashcardsPlugin from "./main";
import { formatFlashcardMarkdown } from "./parser";
import { PomodoroTimer } from "./pomodoro";

export interface CreateCardModalOptions {
	initialQuestion?: string;
	initialAnswer?: string;
	initialDeck?: string;
	targetFilePath?: string;
	onCardCreated?: () => void;
}

export class CreateFlashcardModal extends Modal {
	private plugin: PomodoroFlashcardsPlugin;
	private questionText = "";
	private answerText = "";
	private deckName: string;
	private targetPath: string;
	private onCardCreated?: () => void;
	private resizeHandler: (() => void) | null = null;
	private observer: MutationObserver | null = null;
	private touchMoveHandler: ((e: TouchEvent) => void) | null = null;

	constructor(
		app: App,
		plugin: PomodoroFlashcardsPlugin,
		options: CreateCardModalOptions = {}
	) {
		super(app);
		this.plugin = plugin;
		this.questionText = options.initialQuestion ?? "";
		this.answerText = options.initialAnswer ?? "";
		this.deckName =
			options.initialDeck ?? this.plugin.settings.defaultDeck ?? "General";

		const activeFile = this.app.workspace.getActiveFile();
		this.targetPath =
			options.targetFilePath ??
			(activeFile?.extension === "md"
				? activeFile.path
				: this.plugin.settings.defaultFlashcardNote);
		this.onCardCreated = options.onCardCreated;
	}

	onOpen(): void {
		this.containerEl.addClass("pomo-fc-modal-container");
		this.modalEl.addClass("pomo-fc-modal-dialog");

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pomo-fc-modal");

		// 1. Pinned Modal Header Bar (remains visible even with mobile keyboard up)
		const headerBar = contentEl.createDiv({ cls: "pomo-fc-modal-header" });
		let headerSaveBtn: HTMLButtonElement | null = null;

		if (Platform.isMobile) {
			const headerCancelBtn = headerBar.createEl("button", {
				text: "Cancel",
				cls: "pomo-fc-header-cancel-btn",
				attr: { type: "button", title: "Cancel and close" },
			});
			headerCancelBtn.addEventListener("click", () => {
				this.close();
			});

			headerBar.createEl("h3", {
				text: "Create flashcard",
				cls: "pomo-fc-modal-title",
			});

			headerSaveBtn = headerBar.createEl("button", {
				text: "Save",
				cls: "mod-cta pomo-fc-header-save-btn",
				attr: { type: "button", title: "Save flashcard" },
			});

			const closeBtn = this.modalEl.querySelector<HTMLElement>(".modal-close-button");
			if (closeBtn) {
				closeBtn.style.display = "none";
			}
		} else {
			headerBar.createEl("h3", {
				text: "Create flashcard",
				cls: "pomo-fc-modal-title",
			});
		}

		// 2. Scrollable Form Body with dedicated keyboard scroll clearance
		const scrollBody = contentEl.createDiv({
			cls: "pomo-fc-modal-scroll-body",
		});

		// 3. Collapsible Target Note & Deck Meta Box
		const metaBox = scrollBody.createDiv({
			cls: "pomo-fc-modal-meta-box",
		});
		let isMetaExpanded = !Platform.isMobile;
		if (!isMetaExpanded) {
			metaBox.addClass("is-collapsed");
		}

		const getTargetFileName = () =>
			this.targetPath.split("/").pop() || this.targetPath;

		const metaToggleBtn = metaBox.createEl("button", {
			cls: "pomo-fc-modal-meta-toggle",
			attr: { type: "button", title: "Toggle deck and target file options" },
		});
		const metaSummary = metaToggleBtn.createSpan({
			cls: "pomo-fc-modal-meta-summary",
			text: `📁 Deck: ${this.deckName} · 📄 ${getTargetFileName()}`,
		});
		const metaChevron = metaToggleBtn.createSpan({
			cls: "pomo-fc-modal-meta-chevron",
			text: isMetaExpanded ? "▴" : "▾",
		});

		metaToggleBtn.addEventListener("click", () => {
			isMetaExpanded = !isMetaExpanded;
			metaBox.toggleClass("is-collapsed", !isMetaExpanded);
			metaChevron.setText(isMetaExpanded ? "▴" : "▾");
			if (Platform.isMobile) {
				window.setTimeout(() => {
					this.updateMobileLayout();
				}, 60);
			}
		});

		const metaDrawer = metaBox.createDiv({
			cls: "pomo-fc-modal-meta-drawer",
		});

		// Target Note Path Setting
		new Setting(metaDrawer)
			.setName("Target note")
			.setDesc("Markdown file where the flashcard will be appended")
			.addText((text) => {
				text
					.setPlaceholder("Flashcards.md")
					.setValue(this.targetPath)
					.onChange((val) => {
						this.targetPath = val.trim();
						metaSummary.setText(
							`📁 Deck: ${this.deckName} · 📄 ${getTargetFileName()}`
						);
					});
			});

		// Deck Name Setting
		const existingDecks = this.plugin.getDecks();
		let deckInputEl: HTMLInputElement | null = null;
		const deckSetting = new Setting(metaDrawer)
			.setName("Deck")
			.setDesc("Choose an existing deck or type a new deck name");

		if (existingDecks.length > 0) {
			deckSetting.addDropdown((dropdown) => {
				for (const deck of existingDecks) {
					dropdown.addOption(deck, deck);
				}
				if (existingDecks.includes(this.deckName)) {
					dropdown.setValue(this.deckName);
				}
				dropdown.onChange((val) => {
					this.deckName = val;
					if (deckInputEl) {
						deckInputEl.value = val;
					}
					metaSummary.setText(
						`📁 Deck: ${this.deckName} · 📄 ${getTargetFileName()}`
					);
				});
			});
		}

		deckSetting.addText((text) => {
			deckInputEl = text.inputEl;
			text
				.setPlaceholder("General")
				.setValue(this.deckName)
				.onChange((val) => {
					this.deckName = val.trim() || this.plugin.settings.defaultDeck;
					metaSummary.setText(
						`📁 Deck: ${this.deckName} · 📄 ${getTargetFileName()}`
					);
				});
		});

		// 4. Question Field
		const qContainer = scrollBody.createDiv({ cls: "pomo-fc-field-group" });
		qContainer.createEl("label", {
			text: "Question (front)",
			cls: "pomo-fc-field-label",
		});
		const qTextarea = qContainer.createEl("textarea", {
			cls: "pomo-fc-textarea",
			attr: {
				rows: "3",
				placeholder:
					"Enter the prompt or question (Markdown & LaTeX supported)...",
			},
		});
		qTextarea.value = this.questionText;
		qTextarea.addEventListener("input", () => {
			this.questionText = qTextarea.value;
		});

		// 5. Answer Field
		const aContainer = scrollBody.createDiv({ cls: "pomo-fc-field-group" });
		aContainer.createEl("label", {
			text: "Answer (back)",
			cls: "pomo-fc-field-label",
		});
		const aTextarea = aContainer.createEl("textarea", {
			cls: "pomo-fc-textarea",
			attr: {
				rows: "4",
				placeholder:
					"Enter the answer (Ctrl/Cmd + Enter to save and add another)...",
			},
		});
		aTextarea.value = this.answerText;
		aTextarea.addEventListener("input", () => {
			this.answerText = aTextarea.value;
		});

		// Keyboard shortcut: Ctrl/Cmd+Enter saves & adds another
		const handleKeyDown = async (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				await this.saveCard(true, qTextarea, aTextarea);
			}
		};
		qTextarea.addEventListener("keydown", handleKeyDown);
		aTextarea.addEventListener("keydown", handleKeyDown);

		// Wire mobile header quick-save
		if (headerSaveBtn) {
			headerSaveBtn.addEventListener("click", async () => {
				await this.saveCard(false, qTextarea, aTextarea);
			});
		}

		// 6. Action Buttons in Scroll Body
		const footer = scrollBody.createDiv({ cls: "pomo-fc-modal-footer" });

		const saveCloseBtn = footer.createEl("button", {
			text: "Save flashcard",
			cls: "mod-cta pomo-fc-modal-primary-btn",
		});
		saveCloseBtn.addEventListener("click", async () => {
			await this.saveCard(false, qTextarea, aTextarea);
		});

		const addAnotherBtn = footer.createEl("button", {
			text: Platform.isMobile ? "Save & add another" : "Save and add another",
			cls: "pomo-fc-modal-secondary-btn",
		});
		addAnotherBtn.addEventListener("click", async () => {
			await this.saveCard(true, qTextarea, aTextarea);
		});

		if (Platform.isMobile) {
			const cancelBtn = footer.createEl("button", {
				text: "Cancel",
				cls: "pomo-fc-modal-cancel-btn",
			});
			cancelBtn.addEventListener("click", () => {
				this.close();
			});
		}

		// 7. Auto-scroll on focus helpers so active field is never obscured by keyboard
		const ensureVisibleOnFocus = (el: HTMLElement) => {
			el.addEventListener("focus", () => {
				if (!Platform.isMobile) return;
				this.updateMobileLayout();
				this.scrollToElement(scrollBody, el);
				window.setTimeout(() => {
					this.updateMobileLayout();
					this.scrollToElement(scrollBody, el);
				}, 120);
				window.setTimeout(() => {
					this.updateMobileLayout();
					this.scrollToElement(scrollBody, el);
				}, 320);
			});
		};
		ensureVisibleOnFocus(qTextarea);
		ensureVisibleOnFocus(aTextarea);
		if (deckInputEl) ensureVisibleOnFocus(deckInputEl);

		// 8. Mobile layout and keyboard height tracking
		if (Platform.isMobile) {
			this.updateMobileLayout();

			this.resizeHandler = () => {
				this.updateMobileLayout();
			};
			window.addEventListener("resize", this.resizeHandler);
			if (typeof window !== "undefined" && window.visualViewport) {
				window.visualViewport.addEventListener("resize", this.resizeHandler);
			}

			// Watch for --keyboard-height changes set on documentElement or body by Obsidian/Capacitor
			if (
				typeof MutationObserver !== "undefined" &&
				typeof document !== "undefined"
			) {
				this.observer = new MutationObserver(() => {
					this.updateMobileLayout();
				});
				if (document.documentElement) {
					this.observer.observe(document.documentElement, {
						attributes: true,
						attributeFilter: ["style", "class"],
					});
				}
				if (document.body) {
					this.observer.observe(document.body, {
						attributes: true,
						attributeFilter: ["style", "class"],
					});
				}
			}

			// Prevent page-level rubber-band dragging when touching outside scrollBody
			this.touchMoveHandler = (e: TouchEvent) => {
				if (!scrollBody.contains(e.target as Node)) {
					e.preventDefault();
				}
			};
			this.containerEl.addEventListener("touchmove", this.touchMoveHandler, {
				passive: false,
			});
		}

		// Focus question or answer input on open
		window.setTimeout(() => {
			if (this.questionText) {
				aTextarea.focus();
			} else {
				qTextarea.focus();
			}
			if (Platform.isMobile) {
				this.updateMobileLayout();
				const target = this.questionText ? aTextarea : qTextarea;
				this.scrollToElement(scrollBody, target);
			}
		}, 80);
	}

	private getKeyboardHeight(): number {
		if (!Platform.isMobile) return 0;

		// 1. Check Obsidian's CSS variable --keyboard-height (set by Capacitor Keyboard plugin)
		if (typeof document !== "undefined") {
			const docVal = getComputedStyle(document.documentElement)
				.getPropertyValue("--keyboard-height")
				.trim();
			const bodyVal = getComputedStyle(document.body)
				.getPropertyValue("--keyboard-height")
				.trim();
			const rawVal = docVal || bodyVal;
			if (rawVal) {
				const parsed = parseFloat(rawVal);
				if (!isNaN(parsed) && parsed > 0) {
					return parsed;
				}
			}
		}

		// 2. Check visualViewport diff vs window.innerHeight (for Android or engines that resize visualViewport)
		if (typeof window !== "undefined" && window.visualViewport) {
			const diff = window.innerHeight - window.visualViewport.height;
			if (diff > 80) {
				return diff;
			}
		}

		return 0;
	}

	private updateMobileLayout(): void {
		if (!Platform.isMobile) return;

		const kbHeight = this.getKeyboardHeight();

		// Keep root page scrolled to 0 so WebKit never pans the window
		if (typeof window !== "undefined") {
			if (window.scrollY !== 0 || window.scrollX !== 0) {
				window.scrollTo(0, 0);
			}
		}
		if (typeof document !== "undefined" && document.body) {
			if (document.body.scrollTop !== 0) {
				document.body.scrollTop = 0;
			}
		}

		if (this.containerEl) {
			if (kbHeight > 0) {
				this.containerEl.style.bottom = `${kbHeight}px`;
				this.containerEl.style.height = `calc(100vh - ${kbHeight}px)`;
				this.containerEl.style.maxHeight = `calc(100vh - ${kbHeight}px)`;
			} else {
				this.containerEl.style.bottom = "0px";
				this.containerEl.style.height = "100vh";
				this.containerEl.style.maxHeight = "100vh";
			}
		}

		if (this.modalEl) {
			this.modalEl.style.transform = "none";
			this.modalEl.style.height = "100%";
			this.modalEl.style.maxHeight = "100%";
		}
	}

	private scrollToElement(
		scrollContainer: HTMLElement,
		targetEl: HTMLElement
	): void {
		if (!scrollContainer || !targetEl) return;

		const containerRect = scrollContainer.getBoundingClientRect();
		const targetRect = targetEl.getBoundingClientRect();

		const relativeOffset = targetRect.top - containerRect.top;
		const currentScroll = scrollContainer.scrollTop;

		const targetScrollTop = currentScroll + relativeOffset - 12;

		scrollContainer.scrollTo({
			top: Math.max(0, targetScrollTop),
			behavior: "smooth",
		});
	}

	onClose(): void {
		if (this.resizeHandler) {
			if (typeof window !== "undefined" && window.visualViewport) {
				window.visualViewport.removeEventListener(
					"resize",
					this.resizeHandler
				);
			}
			window.removeEventListener("resize", this.resizeHandler);
			this.resizeHandler = null;
		}

		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}

		if (this.touchMoveHandler && this.containerEl) {
			this.containerEl.removeEventListener("touchmove", this.touchMoveHandler);
			this.touchMoveHandler = null;
		}

		this.contentEl.empty();
	}

	private async saveCard(
		keepOpen: boolean,
		qTextarea: HTMLTextAreaElement,
		aTextarea: HTMLTextAreaElement
	): Promise<void> {
		if (!this.questionText.trim() || !this.answerText.trim()) {
			new Notice("Please enter both a question and an answer.");
			return;
		}

		let filePath =
			this.targetPath || this.plugin.settings.defaultFlashcardNote;
		if (!filePath.endsWith(".md")) {
			filePath += ".md";
		}

		const formattedBlock = formatFlashcardMarkdown(
			this.questionText,
			this.answerText,
			this.deckName,
			this.plugin.settings
		);

		try {
			// If target file is currently active in editor, use Editor API to preserve cursor/scroll state
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file?.path === filePath) {
				const editor = activeView.editor;
				const lastLine = editor.lineCount();
				const content = editor.getValue();
				const needsLeadingNewline = content.length > 0 && !content.endsWith("\n");
				const insertion = (needsLeadingNewline ? "\n" : "") + formattedBlock.trimStart() + "\n";
				editor.replaceRange(insertion, { line: lastLine, ch: 0 });
			} else {
				const existing = this.app.vault.getAbstractFileByPath(filePath);
				if (existing instanceof TFile) {
					// Use atomic Vault.process to prevent file modification race conditions
					await this.app.vault.process(existing, (data) => {
						const trimmed = data.endsWith("\n") ? data : `${data}\n`;
						return trimmed + formattedBlock.trimStart() + "\n";
					});
				} else {
					// Ensure all nested parent folders exist recursively
					const parts = filePath.split("/");
					if (parts.length > 1) {
						let currentFolder = "";
						for (const part of parts.slice(0, -1)) {
							currentFolder = currentFolder
								? `${currentFolder}/${part}`
								: part;
							if (!this.app.vault.getAbstractFileByPath(currentFolder)) {
								await this.app.vault.createFolder(currentFolder);
							}
						}
					}
					const header = `# Flashcards\n\n`;
					await this.app.vault.create(
						filePath,
						header + formattedBlock.trimStart() + "\n"
					);
				}
			}

			await this.plugin.scanVaultCards();
			this.onCardCreated?.();
			if (this.plugin.settings.enableHaptics) {
				PomodoroTimer.triggerHaptic(15);
			}
			new Notice(`Flashcard saved to ${filePath}`);

			if (keepOpen) {
				this.questionText = "";
				this.answerText = "";
				qTextarea.value = "";
				aTextarea.value = "";
				qTextarea.focus();
			} else {
				this.close();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Failed to save flashcard: ${message}`);
		}
	}
}
