/**
 * 导出模块级配置
 *
 * 与 `excelConfig` / `spaceConfig` 同模式：main.ts 在设置变更时整体写入，
 * 导出侧直接读取该对象，不需要重建任何扩展。
 */

import type { SidebarHomeSettings } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';

export const exportConfig: SidebarHomeSettings = { ...DEFAULT_SETTINGS };

/** 资源子文件夹的默认名 */
export const DEFAULT_ASSETS_FOLDER = 'assets';

/** 会以 `![](…)` 图片语法重写的扩展名 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif', 'ico'];

export function getExtension(path: string): string {
	const dot = path.lastIndexOf('.');
	if (dot < 0) return '';
	return path.slice(dot + 1).toLowerCase();
}

export function getBasename(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? path : path.slice(slash + 1);
}

/** 去掉 `.md` 后的展示名，供链接文本使用 */
export function getDisplayName(path: string): string {
	const name = getBasename(path);
	return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

export function isImagePath(path: string): boolean {
	return IMAGE_EXTENSIONS.indexOf(getExtension(path)) >= 0;
}

export function isMarkdownPath(path: string): boolean {
	return getExtension(path) === 'md';
}
