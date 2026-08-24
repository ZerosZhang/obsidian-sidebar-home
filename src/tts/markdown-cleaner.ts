/**
 * Markdown 清洗器：将 Markdown 文本转换为适合 TTS 朗读的纯文本
 */
export function cleanMarkdownForTts(md: string): string {
	let text = md;

	// 移除 YAML frontmatter
	text = text.replace(/^---[\s\S]*?---\n*/m, '');

	// 移除图片
	text = text.replace(/!\[.*?\]\(.*?\)/g, '');
	text = text.replace(/!\[\[.*?\]\]/g, '');

	// 移除链接，保留文字
	text = text.replace(/\[([^\]]*?)\]\(.*?\)/g, '$1');

	// 转换 wikilink [[note]] → "note", [[note|alias]] → "alias"
	text = text.replace(/\[\[([^\]|#]*?)\]\]/g, '$1');
	text = text.replace(/\[\[.*?\|(.*?)\]\]/g, '$1');

	// 移除粗体/斜体/高亮/删除线标记
	text = text.replace(/\*\*(.+?)\*\*/g, '$1');
	text = text.replace(/__(.+?)__/g, '$1');
	text = text.replace(/\*(.+?)\*/g, '$1');
	text = text.replace(/_(.+?)_/g, '$1');
	text = text.replace(/==(.+?)==/g, '$1');
	text = text.replace(/~~(.+?)~~/g, '$1');

	// 移除行内代码
	text = text.replace(/`([^`]+)`/g, '$1');

	// 移除 Callout 标记 [!note] 等
	text = text.replace(/>\s*\[!.*?\]\s*[+-]?\n?/gi, '');

	// 移除块引用符号 '> '
	text = text.replace(/^>\s?/gm, '');

	// 移除标题标记符 #，保留标题文字
	text = text.replace(/^#{1,6}\s+/gm, '');

	// 移除水平线
	text = text.replace(/^[-*_]{3,}\s*$/gm, '');

	// 移除列表标记 - * + 数字.
	text = text.replace(/^\s*[-*+]\s+/gm, '');
	text = text.replace(/^\s*\d+[.)]\s+/gm, '');

	// 移除 HTML 标签（必须在 #tag 移除之前，避免 #ff0000 等被误匹配）
	text = text.replace(/<[^>]*>/g, '');

	// 移除标签 #tag
	text = text.replace(/(?<!\w)#[^\s#.,;!?，。；！？]+/g, '');

	// 合并连续空行
	text = text.replace(/\n{3,}/g, '\n\n');

	// 去除首尾空白
	text = text.trim();

	return text;
}
