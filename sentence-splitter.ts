/**
 * 智能分句：将纯文本拆分为句子数组
 * 支持中文和英文混合文本
 */
export function splitSentences(text: string): string[] {
	if (!text.trim()) return [];

	// 先按换行分段（段落是天然的分隔）
	const paragraphs = text.split(/\n+/).filter(p => p.trim());

	const sentences: string[] = [];

	for (const para of paragraphs) {
		const trimmed = para.trim();
		if (!trimmed) continue;

		// 按句子分隔符拆分：中英文句号、问号、感叹号、省略号、分号
		// 注意：需要保留分隔符
		const parts = trimmed.split(/(?<=[。！？；!?;…\.])/);

		for (const part of parts) {
			const s = part.trim();
			if (s) {
				sentences.push(s);
			}
		}
	}

	return sentences;
}

/**
 * 在原始 markdown 中查找每个纯文本句子的位置
 * 使用清洗后纯文本的偏移映射回原始文本
 */
export function findSentenceOffsets(rawMd: string, cleanSentences: string[]): Array<{ start: number; end: number }> {
	// 先完整清洗，得到每个 clean 字符对应的 raw 位置
	const map: number[] = []; // map[i] = 该 clean 字符在 raw 中的位置
	let rawPos = 0;
	while (rawPos < rawMd.length) {
		const ch = rawMd[rawPos];
		// 跳过 HTML 标签
		if (ch === '<') {
			const tagEnd = rawMd.indexOf('>', rawPos);
			if (tagEnd >= 0) {
				rawPos = tagEnd + 1;
				continue;
			}
		}
		// 跳过 Markdown 格式符，但这是 cleanMarkdownForTts 的职责
		// 这里简单处理：清洗逻辑与 markdown-cleaner 对齐有点复杂
		// 改为反向映射：每次在 raw 中搜索 clean 句子时，跳过 HTML 标签
		map.push(rawPos);
		rawPos++;
	}

	// 简单方案：在 raw 中从前往后搜索每个 clean 句子，搜索时跳过 HTML 标签
	const offsets: Array<{ start: number; end: number }> = [];
	let searchFrom = 0;

	for (const sentence of cleanSentences) {
		const result = findInRawSkippingHtml(rawMd, sentence, searchFrom);
		if (result) {
			offsets.push(result);
			searchFrom = result.end;
		} else {
			offsets.push({ start: searchFrom, end: searchFrom });
		}
	}

	return offsets;
}

/** 在 raw 文本中搜索 pattern，跳过 HTML 标签，返回 raw 中的起止位置 */
function findInRawSkippingHtml(raw: string, pattern: string, from: number): { start: number; end: number } | null {
	let cleanIdx = 0;
	const patternLen = pattern.length;

	for (let i = from; i < raw.length; i++) {
		// 跳过 HTML 标签
		if (raw[i] === '<') {
			const tagEnd = raw.indexOf('>', i);
			if (tagEnd >= 0) {
				i = tagEnd;
				continue;
			}
		}

		if (raw[i] === pattern[cleanIdx]) {
			if (cleanIdx === 0) {
				// 记录起始
				const start = i;
				// 从起始位置向后验证完整匹配
				let j = i;
				let c = 0;
				while (c < patternLen && j < raw.length) {
					if (raw[j] === '<') {
						const te = raw.indexOf('>', j);
						if (te >= 0) { j = te + 1; continue; }
					}
					if (raw[j] !== pattern[c]) break;
					c++;
					j++;
				}
				if (c === patternLen) {
					return { start, end: j };
				}
			}
		}
	}
	return null;
}
