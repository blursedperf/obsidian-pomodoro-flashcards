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
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pomo-fc-modal");

		contentEl.createEl("h2", { text: "Create flashcard" });

		// Target Note Path
		new Setting(contentEl)
			.setName("Target note")
			.setDesc("Markdown file where the flashcard will be appended")
			.addText((text) => {
				text
					.setPlaceholder("Flashcards.md")
					.setValue(this.targetPath)
					.onChange((val) => {
						this.targetPath = val.trim();
					});
			});

		// Deck Name
		const existingDecks = this.plugin.getDecks();
		let deckInputEl: HTMLInputElement | null = null;
		const deckSetting = new Setting(contentEl)
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
				});
		});

		// Question Field
		const qContainer = contentEl.createDiv({ cls: "pomo-fc-field-group" });
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

		// Answer Field
		const aContainer = contentEl.createDiv({ cls: "pomo-fc-field-group" });
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

		// Action Buttons
		const footer = contentEl.createDiv({ cls: "pomo-fc-modal-footer" });

		if (Platform.isMobile) {
			const cancelBtn = footer.createEl("button", {
				text: "Cancel",
				cls: "pomo-fc-modal-cancel-btn",
			});
			cancelBtn.addEventListener("click", () => {
				this.close();
			});
		}

		const addAnotherBtn = footer.createEl("button", {
			text: Platform.isMobile ? "Save & add another" : "Save and add another",
			cls: "pomo-fc-modal-secondary-btn",
		});
		addAnotherBtn.addEventListener("click", async () => {
			await this.saveCard(true, qTextarea, aTextarea);
		});

		const saveCloseBtn = footer.createEl("button", {
			text: "Save flashcard",
			cls: "mod-cta pomo-fc-modal-primary-btn",
		});
		saveCloseBtn.addEventListener("click", async () => {
			await this.saveCard(false, qTextarea, aTextarea);
		});

		// Focus question or answer input on open
		window.setTimeout(() => {
			if (this.questionText) {
				aTextarea.focus();
			} else {
				qTextarea.focus();
			}
		}, 50);
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

	onClose(): void {
		this.contentEl.empty();
	}
}
