/**
 * 扫描 Markdown 正文里对库内文件的引用
 *
 * 覆盖三种写法：`![[嵌入]]`、`[[wiki 链接]]`、`[文字](路径)`。
 * 围栏代码块与行内代码里的内容不算引用，直接跳过。
 *
 * 纯逻辑，不依赖 Obsidian 运行时，可离线断言。
 */

export type LinkSyntax = 'wiki' | 'markdown';

export interface LinkMatch {
	/** 在原文中的起止偏移，重写时按此区间整体替换 */
	start: number;
	end: number;
	/** 原始区间文本 */
	raw: string;
	syntax: LinkSyntax;
	/** 是否带 `!`，即嵌入 */
	embed: boolean;
	/** 链接目标，已解码，不含 `#子路径` 与 `|别名` */
	target: string;
	/** `#…` 子路径（不含 `#`），如标题名或 `^块引用` */
	subpath: string;
	/** 显示文本：wiki 的别名 / markdown 链接的正文 */
	label: string;
	/** 是否指向库外（外链、同文档锚点、其它协议） */
	external: boolean;
}

const WIKI_RE = /(!?)\[\[([^\[\]\n]+)\]\]/g;
const MD_RE = /(!?)\[([^\[\]\n]*)\]\(([^()\n]*)\)/g;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

type Range = [number, number];

function decodeLinkPart(raw: string): string {
	try {
		return decodeURIComponent(raw);
	} catch (err) {
		// 链接含非法转义时按原文处理
		return raw;
	}
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInsideAny(ranges: Range[], index: number): boolean {
	for (const range of ranges) {
		if (index >= range[0] && index < range[1]) return true;
	}
	return false;
}

/** 找第一个未被 `\` 转义的分隔符 */
function indexOfUnescaped(s: string, ch: string): number {
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '\\') {
			i++;
			continue;
		}
		if (s[i] === ch) return i;
	}
	return -1;
}

function unescapeWiki(s: string): string {
	return s.replace(/\\([\\|#^])/g, '$1');
}

/** 围栏代码块的区间；未闭合的围栏算到文末 */
function computeFenceRanges(text: string): Range[] {
	const ranges: Range[] = [];
	const openRe = /^[ \t]*(`{3,}|~{3,})[^\n]*$/gm;
	let match: RegExpExecArray | null;
	while ((match = openRe.exec(text)) !== null) {
		const fence = match[1];
		const start = match.index;
		const closeRe = new RegExp(
			'^[ \\t]*' + escapeRegExp(fence[0]) + '{' + fence.length + ',}[ \\t]*$',
			'gm',
		);
		closeRe.lastIndex = start + match[0].length;
		const close = closeRe.exec(text);
		const end = close ? close.index + close[0].length : text.length;
		ranges.push([start, end]);
		openRe.lastIndex = end;
	}
	return ranges;
}

/** 行内代码区间：反引号串必须成对且长度相同 */
function computeInlineCodeRanges(text: string, exclude: Range[]): Range[] {
	const ranges: Range[] = [];
	let i = 0;
	while (i < text.length) {
		if (text[i] !== '`' || isInsideAny(exclude, i)) {
			i++;
			continue;
		}
		const openStart = i;
		while (i < text.length && text[i] === '`') i++;
		const runLength = i - openStart;
		const closeRe = new RegExp('`{' + runLength + '}(?!`)', 'g');
		closeRe.lastIndex = i;
		const close = closeRe.exec(text);
		if (!close) break;
		const end = close.index + runLength;
		ranges.push([openStart, end]);
		i = end;
	}
	return ranges;
}

function computeSkipRanges(text: string): Range[] {
	const fences = computeFenceRanges(text);
	const inline = computeInlineCodeRanges(text, fences);
	return fences.concat(inline).sort((a, b) => a[0] - b[0]);
}

function parseWikiInner(inner: string): { target: string; subpath: string; alias: string } {
	// 表格里必须写成 `\|` 才能转义别名分隔符，因此竖线一律视为分隔符
	const pipe = inner.indexOf('|');
	let head = pipe < 0 ? inner : inner.slice(0, pipe);
	const alias = pipe < 0 ? '' : inner.slice(pipe + 1);
	if (head.charAt(head.length - 1) === '\\') head = head.slice(0, -1);

	const hash = indexOfUnescaped(head, '#');
	const target = hash < 0 ? head : head.slice(0, hash);
	const subpath = hash < 0 ? '' : head.slice(hash + 1);
	return {
		target: unescapeWiki(decodeLinkPart(target)),
		subpath: unescapeWiki(decodeLinkPart(subpath)),
		alias: unescapeWiki(alias),
	};
}

/** 去掉 `<…>` 包裹与可选的 `"标题"` */
function parseMarkdownUrl(raw: string): string {
	let url = raw.trim();
	const titled = url.match(/^(<[^>]*>|\S+)\s+("[^"]*"|'[^']*')$/);
	if (titled) url = titled[1];
	if (url.length > 1 && url[0] === '<' && url[url.length - 1] === '>') {
		url = url.slice(1, -1);
	}
	return url.trim();
}

function isExternalTarget(target: string): boolean {
	if (target.startsWith('//')) return true;
	return SCHEME_RE.test(target);
}

export function scanLinks(text: string): LinkMatch[] {
	const skips = computeSkipRanges(text);
	const results: LinkMatch[] = [];
	const claimed: Range[] = [];

	let match: RegExpExecArray | null;

	WIKI_RE.lastIndex = 0;
	while ((match = WIKI_RE.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (isInsideAny(skips, start) || isInsideAny(claimed, start)) continue;

		const parsed = parseWikiInner(match[2]);
		if (!parsed.target) continue;

		results.push({
			start,
			end,
			raw: match[0],
			syntax: 'wiki',
			embed: match[1] === '!',
			target: parsed.target,
			subpath: parsed.subpath,
			label: parsed.alias,
			external: isExternalTarget(parsed.target),
		});
		claimed.push([start, end]);
	}

	MD_RE.lastIndex = 0;
	while ((match = MD_RE.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (isInsideAny(skips, start) || isInsideAny(claimed, start)) continue;

		const url = parseMarkdownUrl(match[3]);
		if (!url) continue;

		const hash = url.indexOf('#');
		const rawTarget = hash < 0 ? url : url.slice(0, hash);
		const target = decodeLinkPart(rawTarget);
		// `[文字](#锚点)` 指向本文档自身，无需处理
		if (!target) continue;

		results.push({
			start,
			end,
			raw: match[0],
			syntax: 'markdown',
			embed: match[1] === '!',
			target,
			subpath: hash < 0 ? '' : decodeLinkPart(url.slice(hash + 1)),
			label: match[2],
			external: isExternalTarget(target),
		});
		claimed.push([start, end]);
	}

	results.sort((a, b) => a.start - b.start);
	return results;
}
