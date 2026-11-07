import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import PomodoroFlashcardsPlugin from "./main";

export class PomodoroFlashcardsSettingTab extends PluginSettingTab {
	private plugin: PomodoroFlashcardsPlugin;

	constructor(app: App, plugin: PomodoroFlashcardsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Pomodoro timer" });

		new Setting(containerEl)
			.setName("Focus session duration (minutes)")
			.setDesc("Duration of each Pomodoro work interval (default: 25)")
			.addText((text) =>
				text
					.setPlaceholder("25")
					.setValue(String(this.plugin.settings.workDuration))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0 && parsed <= 180) {
							this.plugin.settings.workDuration = parsed;
							await this.plugin.savePluginData();
							this.plugin.pomodoro.updateSettings(this.plugin.settings);
						}
					})
			);

		new Setting(containerEl)
			.setName("Short break duration (minutes)")
			.setDesc("Duration of short breaks between focus sessions (default: 5)")
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(String(this.plugin.settings.shortBreakDuration))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0 && parsed <= 60) {
							this.plugin.settings.shortBreakDuration = parsed;
							await this.plugin.savePluginData();
							this.plugin.pomodoro.updateSettings(this.plugin.settings);
						}
					})
			);

		new Setting(containerEl)
			.setName("Long break duration (minutes)")
			.setDesc("Duration of long breaks after a full cycle (default: 15)")
			.addText((text) =>
				text
					.setPlaceholder("15")
					.setValue(String(this.plugin.settings.longBreakDuration))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0 && parsed <= 120) {
							this.plugin.settings.longBreakDuration = parsed;
							await this.plugin.savePluginData();
							this.plugin.pomodoro.updateSettings(this.plugin.settings);
						}
					})
			);

		new Setting(containerEl)
			.setName("Long break interval")
			.setDesc("Number of focus sessions before triggering a long break")
			.addText((text) =>
				text
					.setPlaceholder("4")
					.setValue(String(this.plugin.settings.longBreakInterval))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) {
							this.plugin.settings.longBreakInterval = parsed;
							await this.plugin.savePluginData();
							this.plugin.pomodoro.updateSettings(this.plugin.settings);
						}
					})
			);

		new Setting(containerEl)
			.setName("Lock flashcards during breaks")
			.setDesc(
				"Automatically pause flashcard reviews with a rest screen when a break starts"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.lockCardsOnBreak)
					.onChange(async (value) => {
						this.plugin.settings.lockCardsOnBreak = value;
						await this.plugin.savePluginData();
						this.plugin.refreshStudyViews();
					})
			);

		new Setting(containerEl)
			.setName("Auto-start breaks")
			.setDesc(
				"Automatically start the break countdown when a focus session finishes"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStartBreaks)
					.onChange(async (value) => {
						this.plugin.settings.autoStartBreaks = value;
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Auto-start focus sessions")
			.setDesc(
				"Automatically start the next focus countdown when a break finishes"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStartWork)
					.onChange(async (value) => {
						this.plugin.settings.autoStartWork = value;
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Play sound on phase completion")
			.setDesc("Play a soft chime when a focus or break timer finishes")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.playSound)
					.onChange(async (value) => {
						this.plugin.settings.playSound = value;
						await this.plugin.savePluginData();
					})
			);

		containerEl.createEl("h2", { text: "Mobile experience" });

		new Setting(containerEl)
			.setName("Enable mobile haptic feedback")
			.setDesc("Vibrate gently on card flip, ratings, and timer completion")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableHaptics)
					.onChange(async (value) => {
						this.plugin.settings.enableHaptics = value;
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Compact timer on mobile")
			.setDesc(
				"Collapse the Pomodoro banner into a space-saving bar on mobile to maximize card viewing area"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.compactMobileTimer)
					.onChange(async (value) => {
						this.plugin.settings.compactMobileTimer = value;
						await this.plugin.savePluginData();
						this.plugin.refreshStudyViews();
					})
			);

		containerEl.createEl("h2", { text: "Flashcard syntax and storage" });

		new Setting(containerEl)
			.setName("Default flashcard note")
			.setDesc(
				"Default Markdown file where cards created from the modal are saved when no note is active"
			)
			.addText((text) =>
				text
					.setPlaceholder("Flashcards.md")
					.setValue(this.plugin.settings.defaultFlashcardNote)
					.onChange(async (value) => {
						this.plugin.settings.defaultFlashcardNote =
							value.trim() || "Flashcards.md";
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Default deck name")
			.setDesc("Deck assigned to flashcards without an explicit #deck/... tag")
			.addText((text) =>
				text
					.setPlaceholder("General")
					.setValue(this.plugin.settings.defaultDeck)
					.onChange(async (value) => {
						this.plugin.settings.defaultDeck = value.trim() || "General";
						await this.plugin.savePluginData();
					})
			);

		new Setting(containerEl)
			.setName("Single-line separator")
			.setDesc("Separator between Question and Answer on a single line")
			.addText((text) =>
				text
					.setPlaceholder("::")
					.setValue(this.plugin.settings.inlineSeparator)
					.onChange(async (value) => {
						if (value.trim()) {
							this.plugin.settings.inlineSeparator = value.trim();
							await this.plugin.savePluginData();
						}
					})
			);

		new Setting(containerEl)
			.setName("Bidirectional single-line separator")
			.setDesc(
				"Separator that generates both forward and reverse flashcards from one line"
			)
			.addText((text) =>
				text
					.setPlaceholder(":::")
					.setValue(this.plugin.settings.bidirectionalSeparator)
					.onChange(async (value) => {
						if (value.trim()) {
							this.plugin.settings.bidirectionalSeparator = value.trim();
							await this.plugin.savePluginData();
						}
					})
			);

		new Setting(containerEl)
			.setName("Multi-line separator")
			.setDesc(
				"Standalone line separating multi-line question and answer blocks"
			)
			.addText((text) =>
				text
					.setPlaceholder("?")
					.setValue(this.plugin.settings.multilineSeparator)
					.onChange(async (value) => {
						if (value.trim()) {
							this.plugin.settings.multilineSeparator = value.trim();
							await this.plugin.savePluginData();
						}
					})
			);

		containerEl.createEl("h2", { text: "Study statistics and maintenance" });

		const stats = this.plugin.stats;
		new Setting(containerEl)
			.setName("Lifetime study overview")
			.setDesc(
				`${stats.totalPomodoros} Pomodoros (${stats.totalFocusMinutes} mins) · ${stats.totalCardsReviewed} card reviews · ${stats.dailyStreak}-day streak`
			)
			.addButton((btn) =>
				btn.setButtonText("Rescan vault now").onClick(async () => {
					await this.plugin.scanVaultCards();
					this.plugin.refreshStudyViews();
					new Notice(`Scanned ${this.plugin.cards.length} flashcards.`);
				})
			);
	}
}
