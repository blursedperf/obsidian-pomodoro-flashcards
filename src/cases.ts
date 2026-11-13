/**
 * Automatic case cards.
 *
 * A case is described either on one line, as Inline Schema Expander writes it:
 *
 *   Donoghue v Stevenson #case-law [court:: HL] [year:: 1932] [ratio:: neighbour principle]
 *
 * or by a whole case note: a note tagged `case-law` in its properties (or with a line that is just
 * `#case-law`), whose fields come from its properties and from Dataview-style `Ratio:: ...` lines.
 * The case name is the text on the line, else the `case`/`name` field, else the nearest heading
 * (inline cases only), else the note's file name.
 *
 * Each filled-in field becomes a card: ratio, held, issue and facts are asked about the case; court,
 * year and citation become one "where and when" card; and (optionally) ratio and facts are reversed
 * to ask which case it was.
 */

export type CaseField = "name" | "citation" | "court" | "year" | "facts" | "issue" | "held" | "ratio";

export interface CaseRecord {
	name: string;
	fields: Partial<Record<CaseField, string>>;
	/** 0-based line each field came from (the case line for inline cases). */
	lines: Partial<Record<CaseField, number>>;
	/** Line used for cards whose field line is unknown (frontmatter fields). */
	defaultLine: number;
}

export interface CaseCard {
	/** Card kind, stable across edits: "ratio", "ratio-reverse", "details", ... */
	kind: string;
	question: string;
	answer: string;
	line: number;
}

const FIELD_ALIASES: Record<string, CaseField> = {
	case: "name",
	"case name": "name",
	name: "name",
	citation: "citation",
	cite: "citation",
	court: "court",
	year: "year",
	facts: "facts",
	"material facts": "facts",
	issue: "issue",
	issues: "issue",
	held: "held",
	holding: "held",
	decision: "held",
	outcome: "held",
	ratio: "ratio",
	"ratio decidendi": "ratio",
	principle: "ratio",
	rule: "ratio",
};

/** Map a field name ("Ratio decidendi", "material_facts") to a case field, or null. */
export function caseFieldFor(key: string): CaseField | null {
	const normalised = key.trim().toLowerCase().replace(/[\s_-]+/g, " ");
	return FIELD_ALIASES[normalised] ?? null;
}

/** `#case-law` -> `case-law` */
export function bareTag(tag: string): string {
	return tag.trim().replace(/^#/, "").toLowerCase();
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether `line` contains the tag as a whole tag (not `#case-law-notes`). */
export function hasTag(line: string, tag: string): boolean {
	const bare = bareTag(tag);
	if (!bare) return false;
	return new RegExp(`(^|\\s)#${escapeRegex(bare)}(?![\\w/-])`, "i").test(line);
}

const BRACKET_FIELD_REGEX = /[[(]\s*([A-Za-z][\w -]*?)\s*::\s*([^\])]*?)\s*[\])]/g;

/** Read `[key:: value]` and `(key:: value)` fields from a line, and the line with them removed. */
export function parseBracketFields(line: string): { fields: Record<string, string>; rest: string } {
	const fields: Record<string, string> = {};
	const rest = line.replace(BRACKET_FIELD_REGEX, (_m, key: string, value: string) => {
		fields[key] = value.trim();
		return " ";
	});
	return { fields, rest };
}

const LINE_FIELD_REGEX = /^(?:[-*+]\s+)?(?:\*\*|__)?([A-Za-z][\w -]*?)(?:\*\*|__)?::\s*(.*)$/;

/**
 * Read a Dataview-style field line (`Ratio:: ...`, `- **Held**:: ...`). The `::` must follow the
 * key directly; `Ratio :: ...` with a space is a basic card, not a field.
 */
export function parseLineField(trimmed: string): { key: string; value: string } | null {
	const m = trimmed.match(LINE_FIELD_REGEX);
	if (!m) return null;
	const sepIndex = trimmed.indexOf("::");
	if (sepIndex <= 0 || /\s/.test(trimmed[sepIndex - 1])) return null;
	return { key: m[1], value: m[2].trim() };
}

/** Clean a case name: drop list markers, tags, emphasis and trailing separators. */
export function cleanCaseName(text: string): string {
	return text
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/(^|\s)#[\w/-]+/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[\s\-–—:;,]+|[\s\-–—:;,]+$/g, "")
		.replace(/^[*_]+|[*_]+$/g, "")
		.trim();
}

/** Simple YAML frontmatter reader: scalars, quoted strings, `|`/`>` blocks, and lists. */
export function parseFrontmatter(lines: string[]): { data: Record<string, string | string[]>; end: number } {
	const data: Record<string, string | string[]> = {};
	if (lines.length === 0 || lines[0].trim() !== "---") return { data, end: 0 };
	let end = 0;
	for (let i = 1; i < lines.length; i++) {
		const t = lines[i].trim();
		if (t === "---" || t === "...") {
			end = i;
			break;
		}
	}
	if (end === 0) return { data, end: 0 };

	const unquote = (v: string) => v.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
	for (let i = 1; i < end; i++) {
		const m = lines[i].match(/^([A-Za-z_][\w -]*?)\s*:(?:\s+(.*))?$/);
		if (!m) continue;
		const key = m[1];
		const raw = (m[2] ?? "").trim();
		// Indented continuation lines belong to this key
		const block: string[] = [];
		while (i + 1 < end && (/^\s+\S/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]))) {
			block.push(lines[++i]);
		}
		if (/^[|>][+-]?$/.test(raw)) {
			const body = block.map((l) => l.trim());
			data[key] = raw.startsWith("|") ? body.join("\n").trim() : body.join(" ").trim();
		} else if (raw.startsWith("[") && raw.endsWith("]")) {
			data[key] = raw.slice(1, -1).split(",").map(unquote).filter(Boolean);
		} else if (raw === "" && block.length > 0 && block.every((l) => /^\s*-\s/.test(l))) {
			data[key] = block.map((l) => unquote(l.replace(/^\s*-\s+/, ""))).filter(Boolean);
		} else if (raw !== "") {
			data[key] = [unquote(raw), ...block.map((l) => l.trim())].join(" ").trim();
		}
	}
	return { data, end: end + 1 };
}

/** Whether frontmatter tags include the case tag. */
export function frontmatterHasTag(data: Record<string, string | string[]>, tag: string): boolean {
	const bare = bareTag(tag);
	for (const key of ["tags", "tag"]) {
		const value = data[key];
		if (value === undefined) continue;
		const list = Array.isArray(value) ? value : value.split(/[\s,]+/);
		if (list.some((t) => bareTag(t) === bare)) return true;
	}
	return false;
}

/** Copy recognised case fields from a raw key/value map, keeping only filled-in values. */
export function collectCaseFields(
	raw: Record<string, string | string[]>,
	into: Partial<Record<CaseField, string>>
): CaseField[] {
	const added: CaseField[] = [];
	for (const [key, value] of Object.entries(raw)) {
		const field = caseFieldFor(key);
		const text = (Array.isArray(value) ? value.join(", ") : value).trim();
		if (!field || !text || into[field]) continue;
		into[field] = text;
		added.push(field);
	}
	return added;
}

const italic = (name: string) => (/^\*.*\*$|^_.*_$/.test(name) ? name : `*${name}*`);

/** The "where and when" line: citation if there is one, else court and year. */
function caseDetails(fields: CaseRecord["fields"]): string {
	if (fields.citation) return fields.citation;
	return [fields.court, fields.year].filter(Boolean).join(", ");
}

/** Build the cards for one case. Returns none when the case has no name or no filled-in fields. */
export function buildCaseCards(record: CaseRecord, reverse: boolean): CaseCard[] {
	const { fields } = record;
	const name = record.name.trim();
	if (!name) return [];
	const n = italic(name);
	const lineOf = (f: CaseField) => record.lines[f] ?? record.defaultLine;
	const details = caseDetails(fields);
	const nameWithDetails = details ? `${n} (${details})` : n;
	const cards: CaseCard[] = [];

	if (fields.ratio) {
		cards.push({ kind: "ratio", question: `What is the ratio of ${n}?`, answer: fields.ratio, line: lineOf("ratio") });
	}
	if (fields.held) {
		cards.push({ kind: "held", question: `What was held in ${n}?`, answer: fields.held, line: lineOf("held") });
	}
	if (fields.issue) {
		cards.push({ kind: "issue", question: `What was the issue in ${n}?`, answer: fields.issue, line: lineOf("issue") });
	}
	if (fields.facts) {
		cards.push({ kind: "facts", question: `What are the facts of ${n}?`, answer: fields.facts, line: lineOf("facts") });
	}
	if (details) {
		const where = fields.citation ? "citation" : fields.court ? "court" : "year";
		const question = fields.citation
			? `What is the citation for ${n}?`
			: fields.court && fields.year
				? `Which court decided ${n}, and when?`
				: fields.court
					? `Which court decided ${n}?`
					: `When was ${n} decided?`;
		cards.push({ kind: "details", question, answer: details, line: lineOf(where) });
	}
	if (reverse && fields.ratio) {
		cards.push({
			kind: "ratio-reverse",
			question: `Which case established this principle?\n\n${fields.ratio}`,
			answer: nameWithDetails,
			line: lineOf("ratio"),
		});
	}
	if (reverse && fields.facts) {
		cards.push({
			kind: "facts-reverse",
			question: `Which case had these facts?\n\n${fields.facts}`,
			answer: nameWithDetails,
			line: lineOf("facts"),
		});
	}
	return cards;
}
