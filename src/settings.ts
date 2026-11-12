import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	SettingDefinition,
	SettingDefinitionGroup,
	SettingDefinitionItem,
} from "obsidian";
import PomodoroFlashcardsPlugin from "./main";
import { PluginSettings } from "./types";

type SettingKey = keyof PluginSettings;

/** Settings that require the running Pomodoro timer to pick up new values. */
const POMODORO_KEYS = new Set<SettingKey>([
	"workDuration",
	"shortBreakDuration",
	"longBreakDuration",
	"longBreakInterval",
]);

/** Settings that change how open study views render. */
const VIEW_KEYS = new Set<SettingKey>(["lockCardsOnBreak", "compactMobileTimer"]);

/** Text settings that fall back to a default when cleared. */
const TEXT_FALLBACKS: Partial<Record<SettingKey, string>> = {
	defaultFlashcardNote: "Flashcards.md",
	defaultDeck: "General",
};

function rangeValidator(min: number, max: number) {
	return (value: number): string | void => {
		if (!Number.isInteger(value) || value < min || value > max) {
			return `Enter a whole number from ${min} to ${max}.`;
		}
	};
}

function nonEmpty(value: string): string | void {
	if (!value.trim()) return "Separator cannot be empty.";
}

export class PomodoroFlashcardsSettingTab extends PluginSettingTab {
	private plugin: PomodoroFlashcardsPlugin;

	constructor(app: App, plugin: PomodoroFlashcardsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declarative settings (Obsidian 1.13+): rendered by Obsidian and indexed
	 * for settings search. `display()` renders the same definitions on older
	 * versions.
	 */
	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		const numberControl = (
			key: SettingKey,
			placeholder: string,
			min: number,
			max: number
		) => ({
			type: "number" as const,
			key,
			placeholder,
			min,
			max,
			step: 1,
			validate: rangeValidator(min, max),
		});

		return [
			{
				type: "group",
				heading: "Pomodoro timer",
				items: [
					{
						name: "Focus session duration (minutes)",
						desc: "Duration of each Pomodoro work interval (default: 25)",
						control: numberControl("workDuration", "25", 1, 180),
					},
					{
						name: "Short break duration (minutes)",
						desc: "Duration of short breaks between focus sessions (default: 5)",
						control: numberControl("shortBreakDuration", "5", 1, 60),
					},
					{
						name: "Long break duration (minutes)",
						desc: "Duration of long breaks after a full cycle (default: 15)",
						control: numberControl("longBreakDuration", "15", 1, 120),
					},
					{
						name: "Long break interval",
						desc: "Number of focus sessions before triggering a long break",
						control: numberControl("longBreakInterval", "4", 1, 12),
					},
					{
						name: "Lock flashcards during breaks",
						desc: "Automatically pause flashcard reviews with a rest screen when a break starts",
						control: { type: "toggle", key: "lockCardsOnBreak" },
					},
					{
						name: "Auto-start breaks",
						desc: "Automatically start the break countdown when a focus session finishes",
						control: { type: "toggle", key: "autoStartBreaks" },
					},
					{
						name: "Auto-start focus sessions",
						desc: "Automatically start the next focus countdown when a break finishes",
						control: { type: "toggle", key: "autoStartWork" },
					},
					{
						name: "Play sound on phase completion",
						desc: "Play a soft chime when a focus or break timer finishes",
						aliases: ["chime", "audio"],
						control: { type: "toggle", key: "playSound" },
					},
				],
			},
			{
				type: "group",
				heading: "Mobile experience",
				items: [
					{
						name: "Enable mobile haptic feedback",
						desc: "Vibrate gently on card flip, ratings, and timer completion",
						aliases: ["vibrate", "vibration"],
						control: { type: "toggle", key: "enableHaptics" },
					},
					{
						name: "Compact timer on mobile",
						desc: "Collapse the Pomodoro banner into a space-saving bar on mobile to maximize card viewing area",
						control: { type: "toggle", key: "compactMobileTimer" },
					},
				],
			},
			{
				type: "group",
				heading: "Flashcard syntax and storage",
				items: [
					{
						name: "Default flashcard note",
						desc: "Default Markdown file where cards created from the modal are saved when no note is active",
						control: {
							type: "text",
							key: "defaultFlashcardNote",
							placeholder: "Flashcards.md",
						},
					},
					{
						name: "Default deck name",
						desc: "Deck assigned to flashcards without an explicit #deck/... tag",
						control: { type: "text", key: "defaultDeck", placeholder: "General" },
					},
					{
						name: "Single-line separator",
						desc: "Separator between Question and Answer on a single line",
						control: {
							type: "text",
							key: "inlineSeparator",
							placeholder: "::",
							validate: nonEmpty,
						},
					},
					{
						name: "Bidirectional single-line separator",
						desc: "Separator that generates both forward and reverse flashcards from one line",
						control: {
							type: "text",
							key: "bidirectionalSeparator",
							placeholder: ":::",
							validate: nonEmpty,
						},
					},
					{
						name: "Multi-line separator",
						desc: "Standalone line separating multi-line question and answer blocks",
						control: {
							type: "text",
							key: "multilineSeparator",
							placeholder: "?",
							validate: nonEmpty,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Study statistics and maintenance",
				items: [
					{
						name: "Lifetime study overview",
						aliases: ["rescan", "statistics", "streak"],
						render: (setting) => this.renderStatsRow(setting),
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as SettingKey];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const k = key as SettingKey;
		let next = value;
		if (typeof next === "string") {
			next = next.trim() || TEXT_FALLBACKS[k] || next;
		}
		(this.plugin.settings as unknown as Record<string, unknown>)[k] = next;
		await this.plugin.savePluginData();

		if (POMODORO_KEYS.has(k)) {
			this.plugin.pomodoro.updateSettings(this.plugin.settings);
		}
		if (VIEW_KEYS.has(k)) {
			this.plugin.refreshStudyViews();
		}
	}

	/**
	 * Fallback for Obsidian < 1.13.0, which doesn't render
	 * `getSettingDefinitions()`. Renders the same definitions imperatively.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		for (const item of this.getSettingDefinitions()) {
			if ("type" in item && item.type === "group") {
				this.renderGroupFallback(containerEl, item);
			}
		}
	}

	private renderGroupFallback(
		containerEl: HTMLElement,
		group: SettingDefinitionGroup<SettingKey>
	): void {
		if (group.heading) {
			new Setting(containerEl).setName(group.heading).setHeading();
		}
		for (const def of group.items ?? []) {
			if ("type" in def) continue; // nested pages aren't used here
			this.renderDefinitionFallback(containerEl, def);
		}
	}

	private renderDefinitionFallback(
		containerEl: HTMLElement,
		def: SettingDefinition<SettingKey>
	): void {
		const setting = new Setting(containerEl).setName(def.name);
		if (def.desc) setting.setDesc(def.desc);

		if (def.render) {
			// Our render callbacks only use the Setting row; SettingGroup is 1.13+.
			def.render(setting, undefined as never);
			return;
		}
		const control = def.control;
		if (!control) return;

		switch (control.type) {
			case "toggle":
				setting.addToggle((toggle) =>
					toggle
						.setValue(Boolean(this.getControlValue(control.key)))
						.onChange((value) => this.setControlValue(control.key, value))
				);
				break;
			case "number":
				setting.addText((text) => {
					text.inputEl.type = "number";
					text
						.setPlaceholder(control.placeholder ?? "")
						.setValue(this.textValue(control.key))
						.onChange(async (raw) => {
							const value = Number(raw);
							if (raw.trim() === "" || control.validate?.(value)) return;
							await this.setControlValue(control.key, value);
						});
				});
				break;
			case "text":
				setting.addText((text) =>
					text
						.setPlaceholder(control.placeholder ?? "")
						.setValue(this.textValue(control.key))
						.onChange(async (value) => {
							if (control.validate?.(value)) return;
							await this.setControlValue(control.key, value);
						})
				);
				break;
		}
	}

	private textValue(key: SettingKey): string {
		const value = this.plugin.settings[key];
		return typeof value === "string" || typeof value === "number" ? String(value) : "";
	}

	private statsSummary(): string {
		const stats = this.plugin.stats;
		return `${stats.totalPomodoros} Pomodoros (${stats.totalFocusMinutes} mins) · ${stats.totalCardsReviewed} card reviews · ${stats.dailyStreak}-day streak`;
	}

	private renderStatsRow(setting: Setting): void {
		setting.setDesc(this.statsSummary()).addButton((btn) =>
			btn.setButtonText("Rescan vault now").onClick(async () => {
				await this.plugin.scanVaultCards();
				this.plugin.refreshStudyViews();
				setting.setDesc(this.statsSummary());
				new Notice(`Scanned ${this.plugin.cards.length} flashcards.`);
			})
		);
	}
}
