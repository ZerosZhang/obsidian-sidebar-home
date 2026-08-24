import { Workspace, WorkspaceLeaf } from 'obsidian';
import type SidebarHomePlugin from './main';

const _origOpenLinkText = Workspace.prototype.openLinkText;

/**
 * 重写 WorkspaceLeaf.prototype.detach + 监听 layout-change 以拦截关闭标签页：
 * - Obsidian 默认在关闭活跃标签页后激活后一个（右侧）标签页
 * - 本 patch 在 closeTabGoToPrev 开启时改为激活前一个（左侧）标签页
 * - 关闭的是第一个标签页时保持默认行为，不做干预
 *
 * 为什么不在 detach 返回后同步判断 activeLeaf：
 * Obsidian 在 detach 流程中同步触发 active-leaf-change / layout-change，
 * detach 返回时 activeLeaf 可能尚未更新，同步判断会失效。
 * 因此在 detach 时同步记录上下文（此时 activeLeaf 仍是关闭前的值），
 * 在 layout-change 回调中消费（此时 Obsidian 已完成激活）。
 */
export function patchCloseTabGoToPrev(plugin: SidebarHomePlugin): () => void {
	const workspace = plugin.app.workspace;
	const original = WorkspaceLeaf.prototype.detach;
	let closeInfo: {
		prevLeaf: WorkspaceLeaf | null;
		nextLeaf: WorkspaceLeaf | null;
		closedActive: boolean;
	} | null = null;

	// iterateRootLeaves 在标签页组/浮动标签页等布局下返回不全，改用 DOM 顺序获取
	// 主区域（含浮动标签页，排除左右侧边栏）的叶子列表，按视觉从左到右排列
	const getRootLeavesInOrder = (): WorkspaceLeaf[] => {
		const headers = Array.from(document.querySelectorAll<HTMLElement>('.workspace-tab-header'))
			.filter((h) => !h.closest('.mod-left-split, .mod-right-split'));
		if (headers.length === 0) return [];
		const byHeader = new Map<HTMLElement, WorkspaceLeaf>();
		workspace.iterateAllLeaves((leaf) => {
			const tabHeaderEl = (leaf as any).tabHeaderEl as HTMLElement | undefined;
			if (tabHeaderEl) byHeader.set(tabHeaderEl, leaf);
		});
		return headers.map((h) => byHeader.get(h)).filter((l): l is WorkspaceLeaf => !!l);
	};

	const onLayoutChange = () => {
		const info = closeInfo;
		closeInfo = null;
		if (!info || !plugin.settings.closeTabGoToPrev) return;

		// 仅当 Obsidian 默认激活了"后一个"时改激活"前一个"（关闭第一个标签页时不动）
		if (info.closedActive && info.prevLeaf && info.nextLeaf && workspace.activeLeaf === info.nextLeaf) {
			workspace.setActiveLeaf(info.prevLeaf, { focus: true });
		}
	};
	const eventRef = workspace.on('layout-change', onLayoutChange);

	WorkspaceLeaf.prototype.detach = function (this: WorkspaceLeaf) {
		if (plugin.settings.closeTabGoToPrev) {
			// detach 前记录上下文：主区域叶子顺序、被关闭叶子的位置和活跃状态
			const rootLeaves = getRootLeavesInOrder();
			const index = rootLeaves.indexOf(this);
			closeInfo = {
				closedActive: workspace.activeLeaf === this,
				prevLeaf: index > 0 ? rootLeaves[index - 1] : null,
				nextLeaf: index >= 0 ? rootLeaves[index + 1] : null,
			};
		}
		original.call(this);
	};

	return () => {
		WorkspaceLeaf.prototype.detach = original;
		workspace.offref(eventRef);
	};
}

/**
 * 重写 Workspace.prototype.openLinkText 以拦截 wiki 链接点击：
 * - reuseExistingTab 开启时：若文件已打开则跳转，否则强制在新标签页打开
 * - reuseExistingTab 关闭时：透传原行为
 */
export function patchOpenLinkText(plugin: SidebarHomePlugin): () => void {
	const original = Workspace.prototype.openLinkText;

	Workspace.prototype.openLinkText = async function (
		this: Workspace,
		linkText: string,
		sourcePath: string,
		newLeaf?: any,
		openViewState?: any,
	) {
		if (!plugin.settings.reuseExistingTab) {
			return await original.apply(this, [linkText, sourcePath, newLeaf, openViewState]);
		}

		const fileName = linkText.split('#')[0];
		const isSameFile = fileName === '' || `${fileName}.md` === sourcePath;

		if (isSameFile) {
			return await original.apply(this, [linkText, sourcePath, newLeaf, openViewState]);
		}

		let fileAlreadyOpen = false;
		plugin.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			const vs = leaf.getViewState();
			const file = (vs.state as { file?: string })?.file;
			if (vs.type === 'markdown' && file?.endsWith(`${fileName}.md`)) {
				plugin.app.workspace.setActiveLeaf(leaf);
				fileAlreadyOpen = true;
			}
		});

		if (fileAlreadyOpen) {
			return await original.apply(this, [linkText, sourcePath, false, openViewState]);
		}

		return await original.apply(this, [linkText, sourcePath, true, openViewState]);
	};

	return () => {
		Workspace.prototype.openLinkText = original;
	};
}

/**
 * 文件浏览器点击处理器（捕获阶段）：
 * - reuseExistingTab 开启时：文件已打开则跳转，否则强制在新标签页打开
 */
export function registerFileExplorerHandler(plugin: SidebarHomePlugin): () => void {
	const handler = (event: MouseEvent) => {
		if (!plugin.settings.reuseExistingTab) return;

		const target = event.target as Element;
		const isNavFile =
			target?.classList?.contains('nav-file-title') ||
			target?.classList?.contains('nav-file-title-content');
		const titleEl = target?.closest('.nav-file-title');

		const pureClick =
			!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;

		if (!isNavFile || !titleEl || !pureClick) return;

		const path = titleEl.getAttribute('data-path');
		if (!path) return;

		const workspace = plugin.app.workspace;
		let found = false;
		workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			const vs = leaf.getViewState();
			const file = (vs.state as { file?: string })?.file;
			if (file === path) {
				workspace.setActiveLeaf(leaf);
				found = true;
			}
		});

		if (found) {
			event.stopPropagation();
			event.preventDefault();
			return;
		}

		const emptyLeaves = workspace.getLeavesOfType('empty');
		if (emptyLeaves.length > 0) {
			workspace.setActiveLeaf(emptyLeaves[0]);
			return;
		}

		event.stopPropagation();
		event.preventDefault();
		workspace.openLinkText(path, path, true);
	};

	document.addEventListener('click', handler, { capture: true });
	return () => document.removeEventListener('click', handler, { capture: true });
}
