// tests/layout/layout-check.ts — finds accidental overflow in a rendered page.
//
// `findLayoutProblems` runs INSIDE the browser (page.evaluate), so it must stay
// self-contained: no imports, no references to anything outside the function.
//
// What counts as a problem (see docs/develop/layout.md):
//  - page-overflow   the page scrolls sideways (something is wider than the screen)
//  - broken-word     an ordinary word is split across lines ("U / pp / er") —
//                    its box was squeezed below the width of the word
//  - text-outside    text sticks out of the box it belongs to
//  - clipped-text    text is cut off by an `overflow: hidden` ancestor
//  - word-stack      a phrase of 3+ words gets one line per word: the column is
//                    far too narrow to be read
//  - cut-label       a button's or link's own label is shortened with "…"
//  - item-stack      a wrapping row (links, buttons, chips) squeezed by its
//                    neighbours until every item gets a line of its own
//  - text-overlap    text lies on top of other text (floating buttons, overlays)
// Words longer than `maxWordLength` (tokens such as e-mail addresses, ticket
// codes, 34-letter compound words) may break: they would not fit a phone anyway.

export type LayoutProblemKind =
	| 'page-overflow'
	| 'broken-word'
	| 'text-outside'
	| 'clipped-text'
	| 'word-stack'
	| 'item-stack'
	| 'cut-label'
	| 'text-overlap';

export interface LayoutProblem {
	kind: LayoutProblemKind;
	/** Readable path to the element, e.g. `div.bed-card.occupied > span.label`. */
	where: string;
	/** The word or text involved. */
	text: string;
	detail: string;
}

export interface LayoutCheckOptions {
	/** Words up to this many letters/digits must never be split across lines. */
	maxWordLength: number;
	/** Elements (and their descendants) matching these selectors are skipped. */
	ignore: string[];
	/** Backgrounds meant to lie under floating controls (the camp map): their
	 * text may be covered, but must still not be cut off or squeezed. */
	canvas?: string[];
	/** Attribute set on offending elements, so a screenshot can outline them. */
	markAttribute?: string;
}

export function findLayoutProblems(options: LayoutCheckOptions): LayoutProblem[] {
	const { maxWordLength, ignore, canvas = [], markAttribute } = options;
	const problems: LayoutProblem[] = [];
	const seen = new Set<string>();
	const TOLERANCE = 1.5;
	if (markAttribute) {
		for (const el of document.querySelectorAll(`[${markAttribute}]`))
			el.removeAttribute(markAttribute);
	}

	function describe(el: Element): string {
		const parts: string[] = [];
		let node: Element | null = el;
		while (node && node !== document.body && parts.length < 4) {
			// Without Svelte's scoping classes (svelte-xyz, s-xyz).
			const classes = [...node.classList].filter((c) => !/^(svelte|s)-/.test(c)).slice(0, 3);
			parts.unshift(node.tagName.toLowerCase() + classes.map((c) => '.' + c).join(''));
			node = node.parentElement;
		}
		return parts.join(' > ');
	}

	function report(kind: LayoutProblemKind, el: Element, text: string, detail: string) {
		const where = describe(el);
		const key = `${kind}|${where}|${text}`;
		if (seen.has(key)) return;
		seen.add(key);
		if (markAttribute) el.setAttribute(markAttribute, kind);
		problems.push({ kind, where, text: text.slice(0, 80), detail });
	}

	function isIgnored(el: Element): boolean {
		return ignore.some((selector) => el.closest(selector) !== null);
	}

	function isShown(el: Element): boolean {
		// Screen-reader-only text (clip: rect(0 0 0 0), 1px box) is meant to be invisible.
		const clip = getComputedStyle(el).clip;
		if (clip && clip !== 'auto') return false;
		if (typeof el.checkVisibility === 'function') {
			return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
		}
		const style = getComputedStyle(el);
		return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
	}

	/** The box a piece of inline text belongs to (its nearest non-inline ancestor). */
	function blockOf(el: Element): Element {
		let node: Element = el;
		while (node.parentElement && getComputedStyle(node).display === 'inline') {
			node = node.parentElement;
		}
		return node;
	}

	/** Groups rects into lines: a rect whose top is below the previous rect's middle starts a new line. */
	function countLines(rects: DOMRect[]): number {
		let lines = 0;
		let lastMiddle = -Infinity;
		for (const rect of [...rects].sort((a, b) => a.top - b.top)) {
			if (rect.top > lastMiddle) {
				lines++;
				lastMiddle = rect.top + rect.height / 2;
			}
		}
		return lines;
	}

	const viewportWidth = document.documentElement.clientWidth;

	// 1. The page itself must not scroll sideways.
	const pageWidth = document.documentElement.scrollWidth;
	if (pageWidth > viewportWidth + TOLERANCE) {
		// Follow the too-wide content down the tree: the deepest element that is
		// still wider than the screen is the one to look at. (Its box may well
		// look narrow — a <select> hands WebKit the width of its longest option.)
		let culprit: Element | null = null;
		let node: Element | null = document.body;
		while (node) {
			const wider: Element | null =
				[...node.children].find(
					(child) =>
						!isIgnored(child) &&
						isShown(child) &&
						(child.scrollWidth > viewportWidth + TOLERANCE ||
							child.getBoundingClientRect().right > viewportWidth + TOLERANCE)
				) ?? null;
			if (wider) culprit = wider;
			node = wider;
		}
		report(
			'page-overflow',
			culprit ?? document.body,
			culprit?.textContent?.trim() ?? '',
			`page is ${pageWidth}px wide on a ${viewportWidth}px screen`
		);
	}

	// 2. Text: words split across lines, text outside its box, text cut off.
	const range = document.createRange();
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const lines: { rect: DOMRect; text: Text; el: Element }[] = [];
	const clippers = new Map<Element, Element[]>();

	/** Ancestors that cut off horizontal overflow (hidden/clip), innermost first. */
	function clippingAncestors(el: Element): Element[] {
		const cached = clippers.get(el);
		if (cached) return cached;
		const parent = el.parentElement;
		const inherited = parent ? clippingAncestors(parent) : [];
		const overflowX = getComputedStyle(el).overflowX;
		const own = overflowX === 'hidden' || overflowX === 'clip' ? [el, ...inherited] : inherited;
		clippers.set(el, own);
		return own;
	}

	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node as Text;
		const parent = text.parentElement;
		if (!parent || !text.data.trim()) continue;
		if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'OPTION', 'TITLE'].includes(parent.tagName)) {
			continue;
		}
		if (isIgnored(parent) || !isShown(parent)) continue;
		const block = blockOf(parent);
		const blockStyle = getComputedStyle(block);
		const truncated = blockStyle.textOverflow === 'ellipsis';

		range.selectNodeContents(text);
		const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
		if (rects.length === 0) continue;

		// 2a. Text outside the box it belongs to (e.g. an unbreakable word pushing
		// past a card's border). Scroll containers and ellipsis are deliberate.
		if (!truncated) {
			const box = block.getBoundingClientRect();
			const outside = rects.find(
				(r) => r.right > box.right + TOLERANCE || r.left < box.left - TOLERANCE
			);
			if (outside) {
				report(
					'text-outside',
					block,
					text.data.trim(),
					`text reaches ${Math.round(outside.left)}–${Math.round(outside.right)}px, its box ${Math.round(box.left)}–${Math.round(box.right)}px`
				);
			}
		}

		// 2b. Text cut off by an ancestor with overflow hidden/clip.
		if (!truncated) {
			for (const clipper of clippingAncestors(parent)) {
				const box = clipper.getBoundingClientRect();
				const style = getComputedStyle(clipper);
				const left = box.left + parseFloat(style.borderLeftWidth);
				const right = box.right - parseFloat(style.borderRightWidth);
				const cut = rects.find((r) => r.right > right + TOLERANCE || r.left < left - TOLERANCE);
				if (cut) {
					report(
						'clipped-text',
						parent,
						text.data.trim(),
						`cut off by ${describe(clipper)} (${Math.round(left)}–${Math.round(right)}px)`
					);
					break;
				}
			}
		}

		// 2c. Ordinary words split across lines (only possible in text that
		// takes more than one line). E-mail addresses, links and domains have
		// no natural break points: they may break anywhere.
		const lineCount = countLines(rects);
		const wraps = blockStyle.whiteSpace !== 'nowrap' && blockStyle.whiteSpace !== 'pre';
		if (lineCount > 1 && wraps) {
			for (const token of text.data.matchAll(/\S+/g)) {
				if (/[@/\\]|\.\w/.test(token[0])) continue;
				for (const run of token[0].matchAll(/[\p{L}\p{N}]+/gu)) {
					const word = run[0];
					if (word.length < 2 || word.length > maxWordLength) continue;
					const at = token.index! + run.index!;
					range.setStart(text, at);
					range.setEnd(text, at + word.length);
					const wordRects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
					if (wordRects.length > 1 && countLines(wordRects) > 1) {
						report(
							'broken-word',
							parent,
							word,
							`split across ${countLines(wordRects)} lines in a ${Math.round(block.getBoundingClientRect().width)}px box`
						);
					}
				}
			}
		}

		// 2d. One word per line: the column is too narrow to read.
		const phrase = text.data.trim().split(/\s+/);
		if (phrase.length >= 3 && lineCount >= phrase.length) {
			report(
				'word-stack',
				parent,
				text.data.trim(),
				`${phrase.length} words on ${lineCount} lines in a ${Math.round(block.getBoundingClientRect().width)}px box`
			);
		}

		// What can be seen of the text: clipped or ellipsised parts can't overlap.
		for (const rect of rects) {
			let visible: DOMRect | null = rect;
			for (const clipper of clippingAncestors(parent)) {
				const box = clipper.getBoundingClientRect();
				const left = Math.max(visible.left, box.left);
				const right = Math.min(visible.right, box.right);
				const top = Math.max(visible.top, box.top);
				const bottom = Math.min(visible.bottom, box.bottom);
				visible =
					right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
				if (!visible) break;
			}
			if (visible) lines.push({ rect: visible, text, el: parent });
		}
	}

	// 3. Labels of buttons and links cut with "…". Long content (a file name,
	// an e-mail address) may be shortened; a label like "DEACTIVATE" may not.
	const LABEL_LENGTH = 30;
	for (const el of document.body.querySelectorAll('button, a, summary, label, [role="button"]')) {
		if (isIgnored(el) || !isShown(el)) continue;
		for (const part of [el, ...el.querySelectorAll('*')]) {
			if (getComputedStyle(part).textOverflow !== 'ellipsis') continue;
			const text = (part.textContent ?? '').trim();
			if (!text || text.length > LABEL_LENGTH) continue;
			if (part.scrollWidth > part.clientWidth + TOLERANCE) {
				report('cut-label', part, text, `needs ${part.scrollWidth}px, has ${part.clientWidth}px`);
			}
		}
	}

	// 4. Rows squeezed into a column: a wrapping flex row with 3+ items, one
	// per line, although it sits next to other items in its parent's row
	// (a row alone in its line at 320 px may well need one line per item).
	for (const el of document.body.querySelectorAll('*')) {
		const style = getComputedStyle(el);
		if (!style.display.endsWith('flex') || style.flexWrap !== 'wrap') continue;
		if (!style.flexDirection.startsWith('row') || isIgnored(el) || !isShown(el)) continue;
		const items = [...el.children].filter((child) => isShown(child));
		if (items.length < 3) continue;
		const itemRects = items.map((child) => child.getBoundingClientRect());
		if (countLines(itemRects) < items.length) continue;
		const parent = el.parentElement;
		if (!parent) continue;
		const parentStyle = getComputedStyle(parent);
		if (!parentStyle.display.endsWith('flex') || !parentStyle.flexDirection.startsWith('row')) {
			continue;
		}
		const box = el.getBoundingClientRect();
		const beside = [...parent.children].some((sibling) => {
			if (sibling === el || !isShown(sibling)) return false;
			const other = sibling.getBoundingClientRect();
			return other.width > 0 && other.top < box.bottom && other.bottom > box.top;
		});
		if (beside) {
			report(
				'item-stack',
				el,
				(el.textContent ?? '').trim().replace(/\s+/g, ' '),
				`${items.length} items, one per line, in a ${Math.round(box.width)}px box next to its neighbours`
			);
		}
	}

	// 5. Text on top of other text (e.g. a floating button over the footer).
	// A dialog over the page is meant to cover it: text inside a fixed layer
	// that fills the screen doesn't count.
	const viewportArea = viewportWidth * document.documentElement.clientHeight;
	function inFullScreenLayer(el: Element): boolean {
		for (let node: Element | null = el; node; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (style.position !== 'fixed') continue;
			const box = node.getBoundingClientRect();
			if (box.width * box.height >= viewportArea * 0.9) return true;
		}
		return false;
	}
	lines.sort((a, b) => a.rect.top - b.rect.top);
	for (let i = 0; i < lines.length; i++) {
		const a = lines[i];
		for (let j = i + 1; j < lines.length && lines[j].rect.top < a.rect.bottom; j++) {
			const b = lines[j];
			if (a.text === b.text || a.el.contains(b.el) || b.el.contains(a.el)) continue;
			const left = Math.max(a.rect.left, b.rect.left);
			const right = Math.min(a.rect.right, b.rect.right);
			const top = Math.max(a.rect.top, b.rect.top);
			const bottom = Math.min(a.rect.bottom, b.rect.bottom);
			if (right - left < 4 || bottom - top < 4) continue;
			const area = (right - left) * (bottom - top);
			const smaller = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
			if (area < smaller * 0.2) continue;
			const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
			if (!hit) continue;
			const onTop = [a, b].find((line) => line.el.contains(hit) || hit.contains(line.el));
			if (!onTop || inFullScreenLayer(onTop.el)) continue;
			const below = onTop === a ? b : a;
			if (canvas.some((selector) => below.el.closest(selector))) continue;
			report(
				'text-overlap',
				below.el,
				below.text.data.trim(),
				`covered by "${onTop.text.data.trim().slice(0, 40)}" in ${describe(onTop.el)}`
			);
		}
	}

	return problems;
}
