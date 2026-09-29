/**
 * 阅读模式 / 悬浮预览的 Excel 内嵌渲染
 *
 * 找到 Obsidian 渲染出的 `.internal-embed`，在它旁边挂一个预览容器。
 * 刻意不替换宿主元素本身 —— Obsidian 原生支持点击非 Markdown 文件
 * 用系统默认程序打开，替换掉宿主就会连带丢掉这个行为。
 *
 * 阅读模式下容器挂在宿主元素**之后**（兄弟节点），而不是嵌在它内部：
 * 阅读模式下 Obsidian 会先渲染占位、随后重写该元素的内部内容，
 * 嵌在里面的容器会被一并清掉，页面上只剩文件名标题栏。
 */

import type { MarkdownPostProcessorContext } from 'obsidian';
import { TFile } from 'obsidian';
import type SidebarHomePlugin from '../main';
import { excelConfig, isSpreadsheetPath } from './excel-config';
import { renderSpreadsheetPreview } from './excel-table';

const EMBED_SELECTOR = '.internal-embed';
const HOST_CLASS = 'sh-excel-host';
const EMBED_PATTERN = /!\[\[([^\]\n]+)\]\]/g;

/** 排在 Obsidian 自身渲染之后，避免我们挂好的容器又被它覆盖 */
const POST_PROCESSOR_ORDER = 100;
/** 嵌入元素可能在本处理器之后才生成或被重写，延时复查一次 */
const REMOUNT_DELAY = 400;

interface MountRecord {
	path: string;
	rerender: () => void;
}

const mounted = new Map<HTMLElement, MountRecord>();

/**
 * 找已经挂好的容器：阅读模式在宿主之后的兄弟节点，实时预览在宿主内部。
 *
 * 去重依据是「容器是否真的还在」，而不是「是否打过标记」——
 * 容器被 Obsidian 覆盖掉之后标记仍在，靠标记判定就永远不会重新挂载。
 */
function findHost(embedEl: HTMLElement): HTMLElement | null {
	const nested = embedEl.querySelector<HTMLElement>(`.${HOST_CLASS}`);
	if (nested) return nested;
	const sibling = embedEl.nextElementSibling;
	if (sibling && sibling.classList.contains(HOST_CLASS)) {
		return sibling as HTMLElement;
	}
	return null;
}

export function getEmbedLinkText(el: HTMLElement): string | null {
	const attr = el.getAttribute('src') || el.getAttribute('data-src');
	if (attr) return attr;
	const anchor = el.querySelector('a.internal-link');
	return (
		anchor?.getAttribute('data-href') || anchor?.getAttribute('href') || null
	);
}

function decodeLinkPart(raw: string): string {
	try {
		return decodeURIComponent(raw);
	} catch (err) {
		// 链接含非法转义时按原文处理
		return raw;
	}
}

/**
 * 拆分 `文件名#子路径|别名`。
 * 先按 `|` 去别名、再按 `#` 切分、最后才解码 —— 顺序反了会把
 * 文件名里的 %23 误解成子路径分隔符。
 */
export function splitSubpath(linkText: string): { path: string; subpath: string } {
	const noAlias = linkText.split('|')[0];
	const hash = noAlias.indexOf('#');
	if (hash < 0) {
		return { path: decodeLinkPart(noAlias), subpath: '' };
	}
	return {
		path: decodeLinkPart(noAlias.slice(0, hash)),
		subpath: decodeLinkPart(noAlias.slice(hash + 1)).trim(),
	};
}

/** 从宿主元素的 `src` 取不到子路径时，回退到该段原文里解析 */
function matchSubpathFromSection(
	plugin: SidebarHomePlugin,
	ctx: MarkdownPostProcessorContext,
	embedEl: HTMLElement,
	file: TFile,
): string {
	const info = ctx.getSectionInfo(embedEl);
	if (!info?.text) return '';

	EMBED_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = EMBED_PATTERN.exec(info.text)) !== null) {
		const { path, subpath } = splitSubpath(match[1]);
		if (!subpath || !isSpreadsheetPath(path)) continue;
		const resolved = plugin.app.metadataCache.getFirstLinkpathDest(
			path,
			ctx.sourcePath,
		);
		if (resolved && resolved.path === file.path) return subpath;
	}
	return '';
}

export interface MountOptions {
	ctx?: MarkdownPostProcessorContext;
	/** 容器是否嵌在宿主内部。实时预览必须（CM6 管理宿主），阅读模式不可（会被重写清掉） */
	nested?: boolean;
}

export function mountEmbedPreview(
	plugin: SidebarHomePlugin,
	embedEl: HTMLElement,
	sourcePath: string,
	options: MountOptions = {},
): void {
	const { ctx, nested = false } = options;

	if (!excelConfig.excelPreviewEnabled) return;
	if (findHost(embedEl)) return;

	const linkText = getEmbedLinkText(embedEl);
	if (!linkText) return;

	const { path, subpath } = splitSubpath(linkText);
	if (!isSpreadsheetPath(path)) return;

	const file = plugin.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
	if (!(file instanceof TFile)) return;

	const sheet =
		subpath ||
		(ctx ? matchSubpathFromSection(plugin, ctx, embedEl, file) : '');

	const doc = embedEl.ownerDocument;
	const host = doc.createElement('div');
	host.className = HOST_CLASS;
	if (nested) {
		// 实时预览：宿主位于 CM6 自己管理的 widget 容器内，
		// 容器必须留在内部，否则会被 CM6 的内容 diff 清掉
		embedEl.appendChild(host);
	} else {
		// 阅读模式：宿主内部随后会被 Obsidian 重写，容器必须放在它外面
		embedEl.insertAdjacentElement('afterend', host);
	}

	// 容器若落在宿主内部，宿主自带的「点击打开文件」会把点标签页吃掉；
	// 拦下我们容器内部的交互向外冒泡，文件名标题栏在容器之外不受影响
	const swallow = (evt: Event) => {
		evt.stopPropagation();
		// click/dblclick 的默认行为可能落在祖先链接上，一并取消
		if (evt.type === 'click' || evt.type === 'dblclick') evt.preventDefault();
	};
	host.addEventListener('click', swallow);
	host.addEventListener('dblclick', swallow);
	host.addEventListener('mousedown', swallow);
	host.addEventListener('auxclick', swallow);

	const rerender = () => {
		void renderSpreadsheetPreview(host, plugin.app, file, sheet || null);
	};
	mounted.set(host, { path: file.path, rerender });
	rerender();
}

/** 重绘预览：传入 path 只重绘该文件，省略则全部重绘。顺带回收已脱离文档的宿主 */
export function refreshMountedPreviews(path?: string): void {
	for (const [host, record] of Array.from(mounted.entries())) {
		if (!host.isConnected) {
			mounted.delete(host);
			continue;
		}
		if (path === undefined || record.path === path) record.rerender();
	}
}

/** 关闭设置或插件时清掉已挂载的预览，恢复 Obsidian 原样 */
export function unmountPreviews(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>(`.${HOST_CLASS}`).forEach((host) => {
		mounted.delete(host);
		host.remove();
	});
}

export function registerExcelPostProcessor(plugin: SidebarHomePlugin): void {
	const processor = (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		if (!excelConfig.excelPreviewEnabled) return;

		const tryMount = () => {
			el.querySelectorAll<HTMLElement>(EMBED_SELECTOR).forEach((embedEl) => {
				mountEmbedPreview(plugin, embedEl, ctx.sourcePath, { ctx });
			});
		};

		tryMount();

		// Obsidian 可能在本处理器之后才生成嵌入元素、或重写它的内容
		// （容器的去重依据是「容器是否还在」，因此被清掉后这里能重新挂上）
		window.setTimeout(() => {
			if (el.isConnected) tryMount();
		}, REMOUNT_DELAY);
	};

	plugin.registerMarkdownPostProcessor(processor, POST_PROCESSOR_ORDER);
}
