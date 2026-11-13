/**
 * Offline rendering: neutralise everything in a Markdown snippet that would make Obsidian load
 * something over the network (or render another note that might), before the snippet is handed to
 * MarkdownRenderer.
 *
 * - Remote images, `![alt](https://...)`, become a plain-text placeholder.
 * - Embeds of other notes, `![[Note]]` and `![](Note.md)`, become links, so their content (which this
 *   function never sees) is not rendered. Embeds of local images, audio, video and PDFs are kept.
 * - Reference-style images, `![alt][ref]`, become links.
 * - Raw HTML that can load resources (`<img>`, `<iframe>`, `<video>`, `<link>`, `<style>`, inline
 *   `style="...url(...)"`, ...) is escaped and shown as text.
 *
 * Fenced code blocks and inline code are left untouched: they render as text.
 */

const LOCAL_MEDIA_EXT =
	/\.(?:avif|bmp|gif|jpe?g|png|svg|webp|ico|tiff?|mp3|m4a|ogg|oga|opus|wav|flac|webm|mp4|m4v|mov|mkv|ogv|3gp|pdf)$/i;

const RESOURCE_TAGS =
	"img|image|picture|source|srcset|track|iframe|frame|frameset|object|embed|applet|video|audio|link|style|script|svg|use|portal|meta|base|form|input|button|math";
const RESOURCE_TAG_REGEX = new RegExp(`<(/?)(${RESOURCE_TAGS})(?=[\\s/>])`, "gi");
/** Any other tag carrying a url(), src, srcset, href to a remote host, or a background attribute. */
const RISKY_ATTR_TAG_REGEX =
	/<([a-z][\w-]*)(?=[^>]*(?:url\s*\(|\bsrc(?:set)?\s*=|\bbackground\s*=|\bposter\s*=|\bdata\s*=))/gi;

function isRemote(url: string): boolean {
	return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url.trim()) || /^(?:https?|ftp|wss?):/i.test(url.trim());
}

/** The link target of a wikilink or markdown link, without subpath, alias or title. */
function linkPath(target: string): string {
	return target.split("|")[0].split("#")[0].trim();
}

function neutraliseText(text: string): string {
	return (
		text
			// ![alt](url "title") — remote: placeholder; local non-media (a note): link; local media: keep
			.replace(
				/!\[([^\]\n]*)\]\(\s*(?:<([^>\n]*)>|([^)\s]*))(?:\s+["'(][^)]*)?\s*\)/g,
				(whole, alt: string, bracketed: string | undefined, bare: string | undefined) => {
					const url = bracketed ?? bare ?? "";
					if (isRemote(url)) {
						return `*(remote image not loaded${alt.trim() ? `: ${alt.trim()}` : ""})*`;
					}
					const path = decodeURIComponentSafe(linkPath(url));
					return LOCAL_MEDIA_EXT.test(path) ? whole : whole.slice(1);
				}
			)
			// Safety net: any image syntax still pointing at a remote host becomes a link
			.replace(/!(\[[^\]\n]*\]\([^)\n]*?(?:[a-z][a-z0-9+.-]*:)?\/\/)/gi, "$1")
			// ![[Note]] / ![[Note#Heading]] — show as a link; ![[image.png]] stays an embed
			.replace(/!\[\[([^\]\n]+)\]\]/g, (whole, target: string) =>
				LOCAL_MEDIA_EXT.test(linkPath(target)) && !isRemote(target) ? whole : whole.slice(1)
			)
			// ![alt][ref] — reference-style images may point anywhere
			.replace(/!\[([^\]\n]*)\]\[([^\]\n]*)\]/g, (whole) => whole.slice(1))
			// Raw HTML that can load resources
			.replace(RESOURCE_TAG_REGEX, (_m, slash: string, tag: string) => `&lt;${slash}${tag}`)
			.replace(RISKY_ATTR_TAG_REGEX, (_m, tag: string) => `&lt;${tag}`)
	);
}

function decodeURIComponentSafe(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/** Split into code and non-code segments so code is never rewritten. */
export function makeOfflineMarkdown(markdown: string): string {
	const out: string[] = [];
	const lines = markdown.split("\n");
	let fence: string | null = null;
	let buffer: string[] = [];
	const flush = () => {
		if (buffer.length === 0) return;
		const text = buffer.join("\n");
		// Inline code spans are kept verbatim
		out.push(text.split(/(`+[^`\n]*?`+)/g).map((part, i) => (i % 2 === 1 ? part : neutraliseText(part))).join(""));
		buffer = [];
	};

	for (const line of lines) {
		const marker = line.match(/^\s*(`{3,}|~{3,})/);
		if (fence === null && marker) {
			flush();
			fence = marker[1];
			out.push(line);
		} else if (fence !== null) {
			out.push(line);
			if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) {
				fence = null;
			}
		} else {
			buffer.push(line);
		}
	}
	flush();
	return out.join("\n");
}
