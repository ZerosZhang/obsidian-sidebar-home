/**
 * Excel 预览模块级配置
 *
 * 与 `spaceConfig` / `formattingConfig` 同模式：main.ts 在设置变更时整体写入，
 * 预览侧直接读取该对象，不需要重建扩展。
 */

import type { SidebarHomeSettings } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';

export const excelConfig: SidebarHomeSettings = { ...DEFAULT_SETTINGS };

/**
 * 可预览的表格扩展名。
 *
 * 走 SheetJS 的 mini 构建，其中不含 BIFF / OOXML-bin 解析器，
 * 因此 .xls 与 .xlsb 不在此列 —— 它们保持 Obsidian 原生占位，点击仍可用 Excel 打开。
 * 详见 doc/开发记录-Excel预览功能.md。
 */
export const SPREADSHEET_EXTENSIONS = ['xlsx', 'xlsm', 'ods', 'csv'];

export function isSpreadsheetPath(path: string): boolean {
	const dot = path.lastIndexOf('.');
	if (dot < 0) return false;
	return SPREADSHEET_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}
