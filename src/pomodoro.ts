import { PluginSettings, PomodoroPhase, PomodoroState } from "./types";

export type PomodoroListener = (
	state: PomodoroState,
	event: "tick" | "phase-change" | "state-change"
) => void;

export class PomodoroTimer {
	private state: PomodoroState;
	private settings: PluginSettings;
	private intervalId: number | null = null;
	private targetEndTimeMs: number | null = null;
	private audioCtx: AudioContext | null = null;
	private listeners: Set<PomodoroListener> = new Set();
	private onWorkSessionComplete?: (focusMinutes: number) => void;
	private boundVisibilityHandler: () => void;

	constructor(
		settings: PluginSettings,
		onWorkSessionComplete?: (focusMinutes: number) => void
	) {
		this.settings = settings;
		this.onWorkSessionComplete = onWorkSessionComplete;
		const initialSeconds = this.getDurationSeconds("work");
		this.state = {
			phase: "work",
			remainingSeconds: initialSeconds,
			totalSeconds: initialSeconds,
			isRunning: false,
			completedPomodoros: 0,
			cardsReviewedInSession: 0,
		};

		// Keep timer accurate when returning from background or screen lock on iOS / iPadOS
		this.boundVisibilityHandler = () => {
			if (document.visibilityState === "visible" && this.state.isRunning) {
				this.tick();
			}
		};
		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", this.boundVisibilityHandler);
		}
	}

	public subscribe(listener: PomodoroListener): () => void {
		this.listeners.add(listener);
		listener(this.getState(), "state-change");
		return () => {
			this.listeners.delete(listener);
		};
	}

	public getState(): PomodoroState {
		return { ...this.state };
	}

	public updateSettings(newSettings: PluginSettings): void {
		const oldDuration = this.getDurationSeconds(this.state.phase);
		this.settings = newSettings;
		const newDuration = this.getDurationSeconds(this.state.phase);

		if (!this.state.isRunning && this.state.remainingSeconds === oldDuration) {
			this.state.totalSeconds = newDuration;
			this.state.remainingSeconds = newDuration;
			this.emit("state-change");
		}
	}

	public start(): void {
		if (this.state.isRunning) return;
		this.unlockAudio();
		this.state.isRunning = true;
		this.targetEndTimeMs = Date.now() + this.state.remainingSeconds * 1000;
		this.intervalId = window.setInterval(() => this.tick(), 500);
		this.emit("state-change");
	}

	public pause(): void {
		if (!this.state.isRunning) return;
		if (this.targetEndTimeMs !== null) {
			this.state.remainingSeconds = Math.max(
				0,
				Math.ceil((this.targetEndTimeMs - Date.now()) / 1000)
			);
		}
		this.state.isRunning = false;
		this.targetEndTimeMs = null;
		this.clearTimer();
		this.emit("state-change");
	}

	public toggle(): void {
		if (this.state.isRunning) {
			this.pause();
		} else {
			this.start();
		}
	}

	public reset(): void {
		this.pause();
		const total = this.getDurationSeconds(this.state.phase);
		this.state.totalSeconds = total;
		this.state.remainingSeconds = total;
		if (this.state.phase === "work") {
			this.state.cardsReviewedInSession = 0;
		}
		this.emit("state-change");
	}

	public setPhase(phase: PomodoroPhase, autoStart = false): void {
		this.pause();
		const total = this.getDurationSeconds(phase);
		this.state.phase = phase;
		this.state.totalSeconds = total;
		this.state.remainingSeconds = total;
		if (phase === "work") {
			this.state.cardsReviewedInSession = 0;
		}
		this.emit("phase-change");
		if (autoStart) {
			this.start();
		}
	}

	public skipPhase(): void {
		this.advancePhase(false);
	}

	public recordCardReview(): void {
		this.state.cardsReviewedInSession += 1;
		this.emit("state-change");
	}

	public destroy(): void {
		this.clearTimer();
		if (typeof document !== "undefined") {
			document.removeEventListener(
				"visibilitychange",
				this.boundVisibilityHandler
			);
		}
		if (this.audioCtx) {
			void this.audioCtx.close().catch(() => {});
			this.audioCtx = null;
		}
		this.listeners.clear();
	}

	public static formatTime(seconds: number): string {
		const clamped = Math.max(0, Math.floor(seconds));
		const mins = Math.floor(clamped / 60);
		const secs = clamped % 60;
		return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
	}

	public static getPhaseLabel(phase: PomodoroPhase): string {
		switch (phase) {
			case "work":
				return "Focus Session";
			case "short-break":
				return "Short Break";
			case "long-break":
				return "Long Break";
		}
	}

	private tick(): void {
		if (!this.state.isRunning || this.targetEndTimeMs === null) return;

		const remaining = Math.max(
			0,
			Math.ceil((this.targetEndTimeMs - Date.now()) / 1000)
		);

		if (remaining > 0) {
			if (remaining !== this.state.remainingSeconds) {
				this.state.remainingSeconds = remaining;
				this.emit("tick");
			}
		} else {
			this.state.remainingSeconds = 0;
			this.advancePhase(true);
		}
	}

	private advancePhase(naturalCompletion: boolean): void {
		this.state.isRunning = false;
		this.targetEndTimeMs = null;
		this.clearTimer();

		if (naturalCompletion) {
			if (this.settings.playSound) {
				this.playChime(this.state.phase === "work" ? "break" : "work");
			}
			if (this.settings.enableHaptics) {
				PomodoroTimer.triggerHaptic([120, 80, 120, 80, 250]);
			}
		}

		if (this.state.phase === "work") {
			if (naturalCompletion) {
				this.state.completedPomodoros += 1;
				this.onWorkSessionComplete?.(this.settings.workDuration);
			}
			const isLongBreak =
				this.state.completedPomodoros > 0 &&
				this.state.completedPomodoros % this.settings.longBreakInterval === 0;
			const nextPhase: PomodoroPhase = isLongBreak
				? "long-break"
				: "short-break";
			this.setPhase(
				nextPhase,
				naturalCompletion && this.settings.autoStartBreaks
			);
		} else {
			this.setPhase("work", naturalCompletion && this.settings.autoStartWork);
		}
	}

	private getDurationSeconds(phase: PomodoroPhase): number {
		switch (phase) {
			case "work":
				return Math.max(1, this.settings.workDuration) * 60;
			case "short-break":
				return Math.max(1, this.settings.shortBreakDuration) * 60;
			case "long-break":
				return Math.max(1, this.settings.longBreakDuration) * 60;
		}
	}

	private clearTimer(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private emit(event: "tick" | "phase-change" | "state-change"): void {
		const snapshot = this.getState();
		for (const listener of this.listeners) {
			listener(snapshot, event);
		}
	}

	/**
	 * Unlock and initialize shared WebKit/Android AudioContext during any user touch gesture.
	 * Plays a silent 1-sample buffer to warm up mobile Web Audio without sound.
	 */
	public unlockAudio(): void {
		if (!this.settings.playSound) return;
		try {
			const AudioCtx =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext })
					.webkitAudioContext;
			if (!AudioCtx) return;
			if (!this.audioCtx) {
				this.audioCtx = new AudioCtx();
			}
			if (this.audioCtx.state === "suspended") {
				void this.audioCtx.resume();
			}
			// Warm up mobile audio hardware with a silent buffer
			if (this.audioCtx.state === "running") {
				const buffer = this.audioCtx.createBuffer(1, 1, 22050);
				const source = this.audioCtx.createBufferSource();
				source.buffer = buffer;
				source.connect(this.audioCtx.destination);
				source.start(0);
			}
		} catch {
			// Ignore audio initialization errors if blocked by platform
		}
	}

	/**
	 * Safe mobile haptic feedback helper using navigator.vibrate.
	 */
	public static triggerHaptic(pattern: number | number[]): void {
		try {
			if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
				navigator.vibrate(pattern);
			}
		} catch {
			// Ignore vibration errors on unsupported platforms
		}
	}

	/**
	 * Synthesize a soft bell chime using Web Audio API (compatible with iOS/iPadOS WKWebView).
	 */
	private playChime(type: "work" | "break"): void {
		try {
			const AudioCtx =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext })
					.webkitAudioContext;
			if (!AudioCtx) return;

			if (!this.audioCtx) {
				this.audioCtx = new AudioCtx();
			}
			const ctx = this.audioCtx;
			if (ctx.state === "suspended") {
				void ctx.resume();
			}

			const notes =
				type === "break"
					? [523.25, 659.25, 783.99]
					: [783.99, 659.25, 1046.5];

			notes.forEach((freq, idx) => {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = "sine";
				osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.14);

				gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.14);
				gain.gain.exponentialRampToValueAtTime(
					0.18,
					ctx.currentTime + idx * 0.14 + 0.03
				);
				gain.gain.exponentialRampToValueAtTime(
					0.0001,
					ctx.currentTime + idx * 0.14 + 0.55
				);

				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.start(ctx.currentTime + idx * 0.14);
				osc.stop(ctx.currentTime + idx * 0.14 + 0.6);
			});
		} catch {
			// Ignore audio errors if blocked by environment
		}
	}
}
