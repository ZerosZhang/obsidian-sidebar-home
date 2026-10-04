/**
 * 链接重写
 *
 * 把正文里的 Obsidian 语法链接换成标准 Markdown 相对链接，
 * 使其脱离 Obsidian 后仍能正常显示。纯逻辑，可离线断言。
 */

import type { LinkMatch } from './link-scanner';
import { getDisplayName, isImagePath } from './export-config';

export interface RewriteEntry {
	match: LinkMatch;
	/** 目标在资源文件夹里的文件名；null 表示未解析，保持原样 */
	outName: string | null;
	/** 目标的库内路径，未解析时为 ''，用于推断默认显示文本 */
	targetPath: string;
}

/** 只编码真正会破坏 Markdown 链接的字符，中文保持可读 */
function encodePath(relPath: string): string {
	return relPath
		.split('/')
		.map((segment) =>
			segment
				.replace(/%/g, '%25')
				.replace(/#/g, '%23')
				.replace(/\?/g, '%3F')
				.replace(/ /g, '%20')
				.replace(/\(/g, '%28')
				.replace(/\)/g, '%29'),
		)
		.join('/');
}

function encodeFragment(fragment: string): string {
	return fragment.replace(/%/g, '%25').replace(/ /g, '%20').replace(/#/g, '%23');
}

function escapeLabel(label: string): string {
	return label.replace(/([\[\]])/g, '\\$1');
}

function buildReplacement(entry: RewriteEntry, assetsFolder: string): string | null {
	const match = entry.match;
	if (!entry.outName) return null;

	const relative = assetsFolder ? assetsFolder + '/' + entry.outName : entry.outName;
	const href = encodePath(relative) + (match.subpath ? '#' + encodeFragment(match.subpath) : '');
	const isImage = isImagePath(entry.outName);

	if (match.syntax === 'markdown') {
		// `![文字](笔记.md)` 这类嵌入 Markdown 的写法重写后会变成坏图，去掉 `!`
		const bang = match.embed && isImage ? '!' : '';
		return bang + '[' + escapeLabel(match.label) + '](' + href + ')';
	}

	// wiki 嵌入的 `|` 参数是图片尺寸而不是别名
	if (match.embed && isImage && /^\d+$/.test(match.label)) {
		return '<img src="' + href + '" width="' + match.label + '">';
	}

	const label = match.label || getDisplayName(entry.targetPath) || entry.outName;
	if (match.embed && isImage) {
		return '![' + escapeLabel(match.label) + '](' + href + ')';
	}
	return '[' + escapeLabel(label) + '](' + href + ')';
}

export function rewriteLinks(text: string, entries: RewriteEntry[], assetsFolder: string): string {
	// 从后往前替换，避免前面的长度变化影响后面的偏移
	const ordered = entries.slice().sort((a, b) => b.match.start - a.match.start);
	let result = text;
	for (const entry of ordered) {
		const replacement = buildReplacement(entry, assetsFolder);
		if (replacement === null) continue;
		result =
			result.slice(0, entry.match.start) + replacement + result.slice(entry.match.end);
	}
	return result;
}
