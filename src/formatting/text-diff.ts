// ============================================================
// 文本差异：把格式化前后的整篇差异拆成尽量小的多段改动
// 单段跨度越小的替换，编辑器的光标映射和视口恢复就越不容易偏移
// ============================================================

export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

interface Line {
	/** 含行尾换行的原始内容 */
	raw: string;
	from: number;
	to: number;
}

/** LCS 动态规划格子上限，超过则退化为单段替换（文档不会被切开） */
const LCS_CELL_LIMIT = 1000000;

function splitLines(text: string): Line[] {
	const lines: Line[] = [];
	let from = 0;
	for (;;) {
		const nl = text.indexOf('\n', from);
		if (nl === -1) {
			lines.push({ raw: text.slice(from), from, to: text.length });
			return lines;
		}
		lines.push({ raw: text.slice(from, nl + 1), from, to: nl + 1 });
		from = nl + 1;
	}
}

function lineStart(lines: Line[], index: number, textLength: number): number {
	return index < lines.length ? lines[index].from : textLength;
}

/** 对两个窗口做逐行 LCS，返回匹配的行号对 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
	const n = a.length;
	const m = b.length;
	const width = m + 1;
	const dp = new Int32Array((n + 1) * width);

	for (let i = n - 1; i >= 0; i--) {
		const row = i * width;
		const nextRow = row + width;
		for (let j = m - 1; j >= 0; j--) {
			dp[row + j] = a[i] === b[j]
				? dp[nextRow + j + 1] + 1
				: Math.max(dp[nextRow + j], dp[row + j + 1]);
		}
	}

	const pairs: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
			i++;
		} else {
			j++;
		}
	}
	return pairs;
}

/** 单行对单行时再按字符收窄，避免整行被当成改动 */
function narrowSingleLine(from: number, oldRaw: string, newRaw: string): TextChange | null {
	let prefix = 0;
	while (prefix < oldRaw.length && prefix < newRaw.length && oldRaw[prefix] === newRaw[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < oldRaw.length - prefix &&
		suffix < newRaw.length - prefix &&
		oldRaw[oldRaw.length - 1 - suffix] === newRaw[newRaw.length - 1 - suffix]
	) suffix++;

	const insert = newRaw.slice(prefix, newRaw.length - suffix);
	const to = from + oldRaw.length - suffix;
	const start = from + prefix;
	if (start === to && insert === '') return null;
	return { from: start, to, insert };
}

export function diffText(oldText: string, newText: string): TextChange[] {
	if (oldText === newText) return [];

	const oldLines = splitLines(oldText);
	const newLines = splitLines(newText);

	// 先剥离首尾相同的整行
	let prefix = 0;
	while (
		prefix < oldLines.length &&
		prefix < newLines.length &&
		oldLines[prefix].raw === newLines[prefix].raw
	) prefix++;

	let suffix = 0;
	while (
		suffix < oldLines.length - prefix &&
		suffix < newLines.length - prefix &&
		oldLines[oldLines.length - 1 - suffix].raw === newLines[newLines.length - 1 - suffix].raw
	) suffix++;

	const oldStartLine = prefix;
	const oldEndLine = oldLines.length - suffix;
	const newStartLine = prefix;
	const newEndLine = newLines.length - suffix;

	const a = oldLines.slice(oldStartLine, oldEndLine).map((line) => line.raw);
	const b = newLines.slice(newStartLine, newEndLine).map((line) => line.raw);
	const pairs = a.length * b.length <= LCS_CELL_LIMIT ? lcsPairs(a, b) : [];

	const changes: TextChange[] = [];
	let ai = 0;
	let bi = 0;

	const pushHunk = (aEnd: number, bEnd: number) => {
		if (aEnd <= ai && bEnd <= bi) return;

		const oldFromLine = oldStartLine + ai;
		const oldToLine = oldStartLine + aEnd;
		const newFromLine = newStartLine + bi;
		const newToLine = newStartLine + bEnd;

		const oldCount = oldToLine - oldFromLine;
		const newCount = newToLine - newFromLine;

		// 没有任何可对齐的行时按行号配对，剩余行作为尾部插入/删除
		// 否则「全篇每行都变」会被合并成一处覆盖全文的改动
		if (pairs.length === 0) {
			const common = Math.min(oldCount, newCount);
			for (let i = 0; i < common; i++) {
				const narrowed = narrowSingleLine(
					oldLines[oldFromLine + i].from,
					oldLines[oldFromLine + i].raw,
					newLines[newFromLine + i].raw,
				);
				if (narrowed) changes.push(narrowed);
			}
			if (oldCount !== newCount) {
				const from = lineStart(oldLines, oldFromLine + common, oldText.length);
				const to = lineStart(oldLines, oldToLine, oldText.length);
				const insert = newText.slice(
					lineStart(newLines, newFromLine + common, newText.length),
					lineStart(newLines, newToLine, newText.length),
				);
				if (from !== to || insert !== '') changes.push({ from, to, insert });
			}
			return;
		}

		// 行数相同（含每行都被改的场景）逐行收窄，避免整段被当成一处改动
		if (oldCount === newCount && oldCount > 0) {
			for (let i = 0; i < oldCount; i++) {
				const narrowed = narrowSingleLine(
					oldLines[oldFromLine + i].from,
					oldLines[oldFromLine + i].raw,
					newLines[newFromLine + i].raw,
				);
				if (narrowed) changes.push(narrowed);
			}
			return;
		}

		const from = lineStart(oldLines, oldFromLine, oldText.length);
		const to = lineStart(oldLines, oldToLine, oldText.length);
		const insert = newText.slice(
			lineStart(newLines, newFromLine, newText.length),
			lineStart(newLines, newToLine, newText.length),
		);
		changes.push({ from, to, insert });
	};

	for (const [pa, pb] of pairs) {
		pushHunk(pa, pb);
		ai = pa + 1;
		bi = pb + 1;
	}
	pushHunk(a.length, b.length);

	return changes;
}
