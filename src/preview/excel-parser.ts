/**
 * Excel 解析与缓存
 *
 * 用 SheetJS mini 构建解析工作簿，按 `路径 + mtime + 体积` 缓存，LRU 上限 5 个。
 * 同一文件的并发解析合并为一次读取。
 *
 * 缓存整个 WorkBook 而非转换后的行数组：SheetJS 在 read 阶段就已经把工作表
 * 解析成单元格对象，缓存行数组只会多占一份内存，而保留 WorkBook 可以按需
 * 只转换要显示的那个窗口（见 buildSheet）。
 */

import { App, TFile } from 'obsidian';
import * as XLSX from 'xlsx/dist/xlsx.mini.min.js';
import { excelConfig } from './excel-config';

/** 超过该体积不解析，避免单个巨型文件拖住笔记 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CACHE_LIMIT = 5;

export interface MergeRange {
	s: { r: number; c: number };
	e: { r: number; c: number };
}

export interface SheetLimit {
	rows: number;
	cols: number;
}

export interface SheetModel {
	name: string;
	hidden: boolean;
	/** 工作表实际总行数，来自 !ref，不受渲染窗口限制 */
	totalRows: number;
	totalCols: number;
	/** 渲染窗口内的数据，坐标为窗口内相对行号 */
	rows: string[][];
	/** 已裁剪到窗口内的合并区域，坐标为窗口内相对行号 */
	merges: MergeRange[];
	hasHeader: boolean;
}

export interface WorkbookModel {
	file: TFile;
	sheetNames: string[];
	hiddenSheets: string[];
	/** 默认展示：第一个可见工作表 */
	defaultSheet: string;
	/** limit 为 null 表示不限量，用于「显示全部行列」 */
	readSheet(name: string, limit: SheetLimit | null): SheetModel | null;
}

interface CacheEntry {
	mtime: number;
	size: number;
	wb: XLSX.WorkBook;
}

/** Map 保持插入顺序，据此实现 LRU */
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<XLSX.WorkBook>>();

export function invalidateSpreadsheet(path: string): void {
	cache.delete(path);
}

export function currentLimit(): SheetLimit {
	return {
		rows: Math.max(1, excelConfig.excelPreviewMaxRows || 1),
		cols: Math.max(1, excelConfig.excelPreviewMaxCols || 1),
	};
}

async function loadWorkbook(app: App, file: TFile): Promise<XLSX.WorkBook> {
	const cached = cache.get(file.path);
	if (
		cached &&
		cached.mtime === file.stat.mtime &&
		cached.size === file.stat.size
	) {
		// 命中后移到队尾，维持 LRU 顺序
		cache.delete(file.path);
		cache.set(file.path, cached);
		return cached.wb;
	}

	const pending = inflight.get(file.path);
	if (pending) return pending;

	const task = (async () => {
		const data = await app.vault.readBinary(file);
		const wb = XLSX.read(new Uint8Array(data), { type: 'array' });
		cache.set(file.path, {
			mtime: file.stat.mtime,
			size: file.stat.size,
			wb,
		});
		while (cache.size > CACHE_LIMIT) {
			const oldest = cache.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
		return wb;
	})();

	inflight.set(file.path, task);
	try {
		return await task;
	} finally {
		inflight.delete(file.path);
	}
}

function isHidden(wb: XLSX.WorkBook, index: number): boolean {
	const meta = wb.Workbook?.Sheets?.[index] as { Hidden?: number } | undefined;
	return !!meta?.Hidden;
}

/**
 * 把合并区域换算到窗口内相对坐标，并裁掉窗口外的部分。
 * 锚点落在窗口外、或裁剪后不足两格的区域直接丢弃。
 */
function clipMerges(
	merges: MergeRange[],
	originRow: number,
	originCol: number,
	winRows: number,
	winCols: number,
): MergeRange[] {
	const out: MergeRange[] = [];
	for (const m of merges) {
		const s = { r: m.s.r - originRow, c: m.s.c - originCol };
		if (s.r < 0 || s.c < 0 || s.r >= winRows || s.c >= winCols) continue;
		const e = {
			r: Math.min(m.e.r - originRow, winRows - 1),
			c: Math.min(m.e.c - originCol, winCols - 1),
		};
		if (e.r <= s.r && e.c <= s.c) continue;
		out.push({ s, e });
	}
	return out;
}

/** 首行全部有内容且不含纯数字时，认为它是表头 */
function looksLikeHeader(rows: string[][]): boolean {
	const first = rows[0];
	if (!first || first.length === 0) return false;
	return (
		first.every((cell) => cell.trim().length > 0) &&
		!first.some((cell) => /^[-+]?[\d.,\s]+%?$/.test(cell.trim()))
	);
}

function buildSheet(
	wb: XLSX.WorkBook,
	name: string,
	hidden: boolean,
	limit: SheetLimit | null,
): SheetModel {
	const ws = wb.Sheets[name];
	const ref = ws?.['!ref'];
	if (!ws || typeof ref !== 'string') {
		return {
			name,
			hidden,
			totalRows: 0,
			totalCols: 0,
			rows: [],
			merges: [],
			hasHeader: false,
		};
	}

	const full = XLSX.utils.decode_range(ref);
	const totalRows = full.e.r - full.s.r + 1;
	const totalCols = full.e.c - full.s.c + 1;

	const endRow = limit ? Math.min(full.e.r, full.s.r + limit.rows - 1) : full.e.r;
	const endCol = limit ? Math.min(full.e.c, full.s.c + limit.cols - 1) : full.e.c;

	const rows = XLSX.utils.sheet_to_json(ws, {
		header: 1,
		// raw:false 让 SheetJS 返回按单元格格式格式化后的文本，
		// 日期因此不会显示成 45000 这类序列号
		raw: false,
		defval: '',
		// blankrows 必须保留：丢掉空行会让行号整体错位，合并单元格坐标随之全错
		blankrows: true,
		range: {
			s: { r: full.s.r, c: full.s.c },
			e: { r: endRow, c: endCol },
		},
	}) as string[][];

	return {
		name,
		hidden,
		totalRows,
		totalCols,
		rows,
		merges: clipMerges(
			(ws['!merges'] || []) as MergeRange[],
			full.s.r,
			full.s.c,
			endRow - full.s.r + 1,
			endCol - full.s.c + 1,
		),
		hasHeader: looksLikeHeader(rows),
	};
}

export async function openWorkbook(app: App, file: TFile): Promise<WorkbookModel> {
	if (file.stat.size > MAX_FILE_BYTES) {
		throw new Error(
			`文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB，未生成预览`,
		);
	}

	const wb = await loadWorkbook(app, file);
	const sheetNames = wb.SheetNames.slice();
	const hiddenSheets = sheetNames.filter((_, i) => isHidden(wb, i));
	const defaultSheet =
		sheetNames.find((_, i) => !isHidden(wb, i)) ?? sheetNames[0] ?? '';

	return {
		file,
		sheetNames,
		hiddenSheets,
		defaultSheet,
		readSheet: (name, limit) =>
			wb.Sheets[name] === undefined
				? null
				: buildSheet(wb, name, hiddenSheets.includes(name), limit),
	};
}
