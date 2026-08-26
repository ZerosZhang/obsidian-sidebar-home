import { moment } from 'obsidian';

// ============================================================
// 格式化入口
// ============================================================
export function formatMarkdown(text: string, fileCreatedAt: number, settings: FormatSettings): string {
	if (settings.yamlSkipTag && hasYamlTag(text, settings.yamlSkipTag)) {
		return text;
	}

	// 提取 YAML frontmatter，格式化仅作用于正文
	let yaml = '';
	let body = text;
	if (text.startsWith('---')) {
		const secondDash = text.indexOf('---', 3);
		if (secondDash !== -1) {
			yaml = text.slice(0, secondDash + 3);
			body = text.slice(secondDash + 3);
		}
	}

	// 先转换 markdown 链接为 wiki（产生新链接）
	if (settings.markdownLinkToWiki) body = markdownLinkToWiki(body);

	// 保护所有 wiki 链接，避免被 CJK 空格等规则修改
	const wikiLinks: string[] = [];
	body = body.replace(/\[\[.+?\]\]/g, (match) => {
		wikiLinks.push(match);
		return `\u0000WIKI${wikiLinks.length - 1}\u0000`;
	});

	// 代码块默认语言（须在代码块占位保护之前执行，否则代码块已被替换为占位符）
	if (settings.codeFenceLanguage) body = codeFenceLanguage(body, settings.codeFenceDefaultLanguage);

	// 保护代码块内容，避免被格式化
	const codeBlocks: string[] = [];
	body = body.replace(/(`{3,}|~{3,})([\s\S]*?)\1/g, (match) => {
		codeBlocks.push(match);
		return `\u0000CODE${codeBlocks.length - 1}\u0000`;
	});

	// 保护 <span> 标签及其内容，避免被格式化
	const spanBlocks: string[] = [];
	if (settings.protectSpanText) {
		body = body.replace(/<span[^>]*>([\s\S]*?)<\/span>/g, (match) => {
			spanBlocks.push(match);
			return `\u0000SPAN${spanBlocks.length - 1}\u0000`;
		});
	}

	// 保护剩余 markdown 链接（图片、外部链接）的 URL 部分，避免被 CJK 空格等规则修改
	const mdLinkUrls: string[] = [];
	body = body.replace(/(\[[^\]]*\]\()([^)\s]+)/g, (_, prefix, url) => {
		mdLinkUrls.push(url);
		return prefix + `\u0000MDLINK${mdLinkUrls.length - 1}\u0000`;
	});

	// Phase 1-9: 正文格式化
	if (settings.boldToStrong) body = boldToStrong(body);
	if (settings.strikethroughToDel) body = strikethroughToDel(body);
	if (settings.smartQuotes) body = smartQuotes(body);
	if (settings.removeUnclosedTags) body = removeUnclosedTags(body);
	if (settings.headerIncrement) body = headerIncrement(body);
	if (settings.headingsStartLine) body = headingsStartLine(body);
	if (settings.cjkSpacing) body = cjkSpacing(body);
	if (settings.spaceAfterListMarkers) body = spaceAfterListMarkers(body);
	if (settings.unorderedListStyle) body = unorderedListStyle(body);
	if (settings.removeEmptyLinesBetweenListMarkers) body = removeEmptyLinesBetweenListMarkers(body);
	if (settings.blockquoteStyle) body = blockquoteStyle(body);
	if (settings.addBlankLineAfterYaml) body = addBlankLineAfterYaml(body);
	if (settings.compactYaml) body = compactYaml(body);
	if (settings.headingBlankLines) body = headingBlankLines(body);
	if (settings.paragraphBlankLines) body = paragraphBlankLines(body);
	if (settings.emptyLineAroundTables) body = emptyLineAroundTables(body);
	if (settings.consecutiveBlankLines) body = consecutiveBlankLines(body);
	if (settings.removeMultipleSpaces) body = removeMultipleSpaces(body);
	if (settings.removeSpaceAroundFullWidthChars) body = removeSpaceAroundFullWidthChars(body);
	if (settings.removeLinkSpacing) body = removeLinkSpacing(body);
	if (settings.removeLeadingSpaces) body = removeLeadingSpaces(body);
	if (settings.trailingSpaces) body = trailingSpaces(body);
	if (settings.lineBreakAtDocumentEnd) body = lineBreakAtDocumentEnd(body);

	// 还原 span 块（外层先还原，其内容可能含内层占位符）
	body = body.replace(/\u0000SPAN(\d+)\u0000/g, (_, i) => spanBlocks[parseInt(i)]);

	// 还原代码块
	body = body.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeBlocks[parseInt(i)]);

	// 还原 markdown 链接 URL
	body = body.replace(/\u0000MDLINK(\d+)\u0000/g, (_, i) => mdLinkUrls[parseInt(i)]);

	// 还原 wiki 链接
	body = body.replace(/\u0000WIKI(\d+)\u0000/g, (_, i) => wikiLinks[parseInt(i)]);

	// Phase 10: YAML 时间戳（始终作用于完整文档）
	let result = yaml ? yaml + body : body;
	if (settings.yamlTimestamp) result = yamlTimestamp(result, fileCreatedAt, settings);

	return result;
}

// ============================================================
// 格式化设置接口（从 settings.ts 引用，此处定义以保持模块独立）
// ============================================================
export interface FormatSettings {
	protectSpanText: boolean;
	boldToStrong: boolean;
	strikethroughToDel: boolean;
	markdownLinkToWiki: boolean;
	smartQuotes: boolean;
	removeUnclosedTags: boolean;
	headerIncrement: boolean;
	headingsStartLine: boolean;
	cjkSpacing: boolean;
	codeFenceLanguage: boolean;
	codeFenceDefaultLanguage: string;
	spaceAfterListMarkers: boolean;
	unorderedListStyle: boolean;
	removeEmptyLinesBetweenListMarkers: boolean;
	blockquoteStyle: boolean;
	removeMultipleSpaces: boolean;
	removeSpaceAroundFullWidthChars: boolean;
	removeLinkSpacing: boolean;
	removeLeadingSpaces: boolean;
	addBlankLineAfterYaml: boolean;
	compactYaml: boolean;
	headingBlankLines: boolean;
	paragraphBlankLines: boolean;
	emptyLineAroundTables: boolean;
	consecutiveBlankLines: boolean;
	trailingSpaces: boolean;
	lineBreakAtDocumentEnd: boolean;
	yamlTimestamp: boolean;
	yamlDateFormat: string;
	yamlDateCreatedKey: string;
	yamlDateModifiedKey: string;
	yamlSkipTag: string;
	formatOnSave: boolean;
}

// ============================================================
// Phase 1: 标记转换
// ============================================================

function boldToStrong(text: string): string {
	return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function strikethroughToDel(text: string): string {
	return text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

function markdownLinkToWiki(text: string): string {
	// 不转换 http/https 开头的外部链接，去除 .md 后缀和 title 属性
	return text.replace(/(?<!!)\[([^\]]+)\]\(((?!https?:\/\/)[^)\s]+)(?:\s+"[^"]*")?\)/g, (_, _text, url) => {
		return '[[' + url.replace(/\.md$/i, '') + ']]';
	});
}

function smartQuotes(text: string): string {
	// 用占位符保护 HTML 标签，避免替换 style="..." 等属性内的引号
	const htmlTags: string[] = [];
	text = text.replace(/<[^>]+>/g, (match) => {
		htmlTags.push(match);
		return `\u0000HTML${htmlTags.length - 1}\u0000`;
	});

	// 双引号 "text" → \u201ctext\u201d
	text = text.replace(/"([^"]*)"/g, '\u201c$1\u201d');
	// 单引号 'text' → \u2018text\u2019 (避免匹配英文缩写如 don't)
	text = text.replace(/(^|[^\w])'([^']*)'([^\w]|$)/g, '$1\u2018$2\u2019$3');

	// 还原 HTML 标签
	text = text.replace(/\u0000HTML(\d+)\u0000/g, (_, i) => htmlTags[parseInt(i)]);

	return text;
}

function removeUnclosedTags(text: string): string {
	const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
	const tagRegex = /<\/?(\w+)[^>]*>/g;
	const stack: Array<{ tag: string; index: number; length: number }> = [];
	const toRemove: Array<{ index: number; length: number }> = [];

	let match;
	while ((match = tagRegex.exec(text)) !== null) {
		const fullTag = match[0];
		const tagName = match[1].toLowerCase();
		if (voidElements.has(tagName) || fullTag.endsWith('/>')) continue;

		if (fullTag.startsWith('</')) {
			let found = false;
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].tag === tagName) { stack.splice(i, 1); found = true; break; }
			}
			if (!found) toRemove.push({ index: match.index, length: fullTag.length });
		} else {
			stack.push({ tag: tagName, index: match.index, length: fullTag.length });
		}
	}

	for (const item of stack) toRemove.push(item);
	toRemove.sort((a, b) => b.index - a.index);
	for (const item of toRemove) text = text.slice(0, item.index) + text.slice(item.index + item.length);

	return text;
}

// ============================================================
// Phase 2: 标题处理
// ============================================================

function headerIncrement(text: string): string {
	const lines = text.split('\n');

	// 检查文档中是否存在 H1 (# 开头)，不存在说明已递增过，跳过
	let hasH1 = false;
	for (const line of lines) {
		if (/^# [^#]/.test(line)) { hasH1 = true; break; }
	}
	if (!hasH1) return text;

	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(#{1,6})\s/);
		if (!m) continue;
		const level = Math.min(m[1].length + 1, 6);
		lines[i] = lines[i].replace(/^(#{1,6})\s/, '#'.repeat(level) + ' ');
	}
	return lines.join('\n');
}

function headingsStartLine(text: string): string {
	return text.replace(/^[ \t]+(#{1,6}\s)/gm, '$1');
}

// ============================================================
// Phase 3: 中英文空格
// ============================================================

function cjkSpacing(text: string): string {
	const cjk = '[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]';
	let result = text.replace(new RegExp(`(${cjk})([a-zA-Z0-9])`, 'g'), '$1 $2');
	result = result.replace(new RegExp(`([a-zA-Z0-9])(${cjk})`, 'g'), '$1 $2');
	return result;
}

// ============================================================
// Phase 4: 代码块默认语言
// ============================================================

function codeFenceLanguage(text: string, defaultLanguage: string): string {
	if (!defaultLanguage) return text;
	const lines = text.split('\n');
	// 栈追踪嵌套代码块（obsidian-columns 的 ```col 嵌套语法）
	// 有语言标识的行压栈，无语言的 ``` 行闭合栈顶；栈空时无语言 ``` 视为新开口
	const stack: boolean[] = [];
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed.startsWith('```')) {
			const lang = trimmed.slice(3).trim();
			if (lang) {
				stack.push(true);
			} else if (stack.length > 0) {
				stack.pop();
			} else {
				lines[i] = lines[i].replace('```', '```' + defaultLanguage);
				stack.push(false);
			}
		}
	}
	return lines.join('\n');
}

// ============================================================
// Phase 5: 列表
// ============================================================

function spaceAfterListMarkers(text: string): string {
	// 无序列表：跳过水平线 ---、***、- - - 等
	text = text.replace(/^(\s*)([-*+])(?![ \t]*\2)([^\s])/gm, '$1$2 $3');
	// 有序列表
	text = text.replace(/^(\s*\d+[.)])([^\s])/gm, '$1 $2');
	return text;
}

function unorderedListStyle(text: string): string {
	const lines = text.split('\n');
	let firstStyle = '';
	let found = false;

	for (const line of lines) {
		const match = line.match(/^\s*([-*+]) /);
		if (match) {
			firstStyle = match[1];
			found = true;
			break;
		}
	}

	if (!found) return text;

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^\s*([-*+]) /);
		if (match && match[1] !== firstStyle) {
			lines[i] = lines[i].replace(/^\s*[-*+] /, firstStyle + ' ');
		}
	}

	return lines.join('\n');
}

function removeEmptyLinesBetweenListMarkers(text: string): string {
	return text.replace(/(^\s*[-*+]\s.+\n)\n+(^\s*[-*+]\s)/gm, '$1$2');
}

// ============================================================
// Phase 6: 引用块
// ============================================================

function blockquoteStyle(text: string): string {
	return text.replace(/^(>[ \t]?)(?!\s*\[!)/gm, (match) => {
		if (match === '>') return '> ';
		return match;
	});
}

// ============================================================
// Phase 7: 多余空格清理
// ============================================================

function removeMultipleSpaces(text: string): string {
	return text.replace(/[^\S\n]{2,}/g, ' ');
}

function removeSpaceAroundFullWidthChars(text: string): string {
	const fw = '[\uff01\uff0c\u3002\uff1b\uff1a\u3001\uff08\uff09\u201c\u201d\u2018\u2019\uff5e\u300a\u300b]';
	// 移除全角符号周围的空格
	text = text.replace(new RegExp('[ \\t]+(' + fw + ')', 'g'), '$1');
	text = text.replace(new RegExp('(' + fw + ')[ \\t]+', 'g'), '$1');
	// 恢复列表标记后的空格（- "xxx" → -"xxx" → - "xxx"）
	text = text.replace(new RegExp('^([\\t ]*(?:[-*+]|\\d+[.)]))(' + fw + ')', 'gm'), '$1 $2');
	return text;
}

function removeLinkSpacing(text: string): string {
	// [^\[\]]+ 确保不匹配 [[wiki链接]]
	return text.replace(/\[([^\[\]]+)\s*\]/g, (_, content) => '[' + content.trim() + ']');
}

function removeLeadingSpaces(text: string): string {
	const lines = text.split('\n');
	const result: string[] = [];

	for (const line of lines) {
		// 列表/引用/标题/表格行保留行首缩进
		const isSpecial = /^\s*(?:[-*+]|\d+[.)])/.test(line) ||
			/^\s*>/.test(line) || /^\s*#{1,6}\s/.test(line) || line.includes('|');
		// 行首 1-3 个空格 + 非空白
		const m = line.match(/^ {1,3}(?=\S)/);
		if (!isSpecial && m) {
			result.push(line.slice(m[0].length));
		} else {
			result.push(line);
		}
	}

	return result.join('\n');
}

// ============================================================
// Phase 8: 空行管理
// ============================================================

function addBlankLineAfterYaml(text: string): string {
	if (!text.startsWith('---')) return text;

	const secondDash = text.indexOf('---', 3);
	if (secondDash === -1) return text;

	const afterYaml = secondDash + 3;
	if (text[afterYaml] === '\n' && text[afterYaml + 1] === '\n') return text;
	if (text[afterYaml] === '\n' && text[afterYaml + 1] !== '\n') {
		return text.slice(0, afterYaml + 1) + '\n' + text.slice(afterYaml + 1);
	}

	return text;
}

function compactYaml(text: string): string {
	return text.replace(/^---\n\n+/gm, '---\n');
}

function headingBlankLines(text: string): string {
	const lines = text.split('\n');
	const result: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const isHeading = /^#{1,6}\s/.test(lines[i]);
		if (!isHeading) {
			result.push(lines[i]);
			continue;
		}

		// 标题上方空行（文档开头除外）
		if (result.length > 0 && result[result.length - 1] !== '') {
			result.push('');
		}

		result.push(lines[i]);

		// 标题下方空行（文档末尾除外）
		if (i + 1 < lines.length && lines[i + 1] !== '') {
			result.push('');
		}
	}

	return result.join('\n');
}

function paragraphBlankLines(text: string): string {
	const lines = text.split('\n');
	const result: string[] = [];
	let inYaml = false;
	let yamlEnded = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (i === 0 && line.startsWith('---')) {
			inYaml = true;
			result.push(line);
			continue;
		}
		if (inYaml && line.startsWith('---')) {
			inYaml = false;
			yamlEnded = true;
			result.push(line);
			continue;
		}
		if (inYaml) {
			result.push(line);
			continue;
		}

		const isEmpty = line.trim() === '';
		const isHeading = /^#{1,6}\s/.test(line);
		const isBlockquote = line.startsWith('>');
		const isListItem = /^\s*[-*+]\s/.test(line) || /^\s*\d+[.)]\s/.test(line);
		const isCodeFence = line.startsWith('```') || line.startsWith('~~~');
		const isTableRow = line.includes('|');

		if (isEmpty || isHeading || isBlockquote || isListItem || isCodeFence || isTableRow) {
			result.push(line);
			continue;
		}

		// 普通段落行：上方空行
		if (result.length > 0 && result[result.length - 1] !== '') {
			const prev = result[result.length - 1];
			const prevIsSpecial = /^#{1,6}\s/.test(prev) || prev.startsWith('>') ||
				/^\s*[-*+]\s/.test(prev) || prev.startsWith('```') || prev.includes('|');
			if (!prevIsSpecial) {
				// 连续段落，不加空行
			} else {
				result.push('');
			}
		}

		result.push(line);
	}

	return result.join('\n');
}

function emptyLineAroundTables(text: string): string {
	const lines = text.split('\n');
	const result: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const isTableLine = lines[i].includes('|');
		const prevIsTable = i > 0 && lines[i - 1].includes('|');
		const nextIsTable = i + 1 < lines.length && lines[i + 1].includes('|');

		// 表格第一行：上方插入空行
		if (isTableLine && !prevIsTable && result.length > 0 && result[result.length - 1] !== '') {
			result.push('');
		}

		result.push(lines[i]);

		// 表格最后一行：下方插入空行
		if (isTableLine && !nextIsTable && i + 1 < lines.length && lines[i + 1] !== '') {
			result.push('');
		}
	}

	return result.join('\n');
}

function consecutiveBlankLines(text: string): string {
	return text.replace(/\n{3,}/g, '\n\n');
}

// ============================================================
// Phase 9: 行尾处理
// ============================================================

function trailingSpaces(text: string): string {
	return text.replace(/[ \t]+$/gm, '');
}

function lineBreakAtDocumentEnd(text: string): string {
	if (text.length === 0) return text;
	return text.endsWith('\n') ? text : text + '\n';
}

// ============================================================
// Phase 10: YAML 时间戳
// ============================================================

function yamlTimestamp(text: string, fileCreatedAt: number, settings: FormatSettings): string {
	if (!settings.yamlDateCreatedKey && !settings.yamlDateModifiedKey) return text;

	const now = moment();
	const nowStr = now.format(settings.yamlDateFormat);
	const createdStr = moment(fileCreatedAt).format(settings.yamlDateFormat);

	// 文档无 YAML frontmatter → 创建新的
	if (!text.startsWith('---')) {
		let yaml = '---\n';
		if (settings.yamlDateCreatedKey) yaml += `${settings.yamlDateCreatedKey}: ${createdStr}\n`;
		if (settings.yamlDateModifiedKey) yaml += `${settings.yamlDateModifiedKey}: ${nowStr}\n`;
		yaml += '---\n\n';
		return yaml + text.trimStart();
	}

	const secondDash = text.indexOf('---', 3);
	if (secondDash === -1) return text;

	const yamlBlock = text.slice(0, secondDash + 3);
	const body = text.slice(secondDash + 3);

	let updatedYaml = yamlBlock;

	// 更新修改日期
	if (settings.yamlDateModifiedKey) {
		const key = settings.yamlDateModifiedKey;
		const regex = new RegExp(`^${escapeRegex(key)}:.*$`, 'm');
		if (regex.test(updatedYaml)) {
			updatedYaml = updatedYaml.replace(regex, `${key}: ${nowStr}`);
		} else {
			updatedYaml = updatedYaml.replace('---\n', `---\n${key}: ${nowStr}\n`);
		}
	}

	// 更新创建日期（仅当不存在时插入）
	if (settings.yamlDateCreatedKey) {
		const key = settings.yamlDateCreatedKey;
		const regex = new RegExp(`^${escapeRegex(key)}:.*$`, 'm');
		if (!regex.test(updatedYaml)) {
			updatedYaml = updatedYaml.replace('---\n', `---\n${key}: ${createdStr}\n`);
		}
	}

	return updatedYaml + body;
}

// ============================================================
// 工具函数
// ============================================================

function hasYamlTag(text: string, tag: string): boolean {
	if (!text.startsWith('---')) return false;
	const secondDash = text.indexOf('---', 3);
	if (secondDash === -1) return false;

	const yamlBlock = text.slice(3, secondDash);
	const escaped = escapeRegex(tag);
	return new RegExp(`\\b${escaped}\\b`, 'm').test(yamlBlock);
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

