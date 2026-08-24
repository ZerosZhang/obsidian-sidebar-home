import {
	Editor,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { MenuAreaKey } from './settings';
import { SidebarHomeSettingTab } from './setting-tab';
import { SidebarHomeView, VIEW_TYPE_SIDEBAR_HOME } from './sidebar-view';
import { DEFAULT_SETTINGS, type SidebarHomeSettings } from './settings';
import { formattingConfig, createFormatHiderExtension } from './format-hider';
import { spaceConfig, createWhitespaceExtension } from './whitespace-visible';
import { TtsPlayer } from './tts-player';
import { createTtsHighlightExtension, highlightColor } from './tts-highlight';
import { formatMarkdown } from './format';
import { patchOpenLinkText, registerFileExplorerHandler, patchCloseTabGoToPrev } from './tab-utils';

export default class SidebarHomePlugin extends Plugin {
	settings: SidebarHomeSettings;
	ttsPlayer: TtsPlayer;
	private refreshTimer: number | null = null;
	private originalSaveCallback: ((checking: boolean) => boolean) | undefined;
	private uninstallMonkeyPatch: (() => void) | null = null;
	private uninstallFileExplorerHandler: (() => void) | null = null;
	private uninstallCloseTabPatch: (() => void) | null = null;
	lastMouseY: number = 0;

	async onload() {
		await this.loadSettings();
		this.syncConfig();

		// 初始化 TTS 播放器
		console.log('[Main] 初始化 TtsPlayer...');
		this.ttsPlayer = new TtsPlayer(this.app, this.settings);
		console.log('[Main] TtsPlayer 已创建, state=', this.ttsPlayer.getState());

		// 注册视图
		this.registerView(
			VIEW_TYPE_SIDEBAR_HOME,
			(leaf) => new SidebarHomeView(leaf, this)
		);

		// 添加设置面板
		this.addSettingTab(new SidebarHomeSettingTab(this.app, this));

		// 注册编辑器扩展：隐藏样式 + 空格可视化 + TTS 高亮
		this.registerEditorExtension(createFormatHiderExtension());
		this.registerEditorExtension(createWhitespaceExtension());
		this.registerEditorExtension(createTtsHighlightExtension());

		// 添加命令：打开侧边栏主页
		this.addCommand({
			id: 'open-sidebar-home',
			name: '打开侧边栏主页',
			callback: () => {
				this.activateView();
			},
		});

		// 添加 TTS 命令
		this.addCommand({
			id: 'tts-read-full',
			name: '朗读全文',
			editorCallback: async (editor) => {
				const text = editor.getValue();
				await this.ttsPlayer.playFullNote(text);
			},
		});

		this.addCommand({
			id: 'tts-read-selection',
			name: '朗读选中文本',
			editorCallback: (editor) => {
				const sel = editor.getSelection();
				if (sel) {
					this.ttsPlayer.playSelection(sel);
				} else {
					new Notice('请先选中要朗读的文本');
				}
			},
		});

		this.addCommand({
			id: 'tts-stop',
			name: '停止朗读',
			callback: () => {
				this.ttsPlayer.stop();
			},
		});

		// 格式化命令
		this.addCommand({
			id: 'format-current-file',
			name: '格式化当前文档',
			editorCallback: (editor) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('没有打开的文档');
					return;
				}

				try {
					const changed = this.applyFormattedText(editor, file);
					new Notice(changed ? '格式化完成' : '文档已符合格式要求');
				} catch (e) {
					console.error('[Format] 格式化失败:', e);
					new Notice(`格式化失败: ${e.message}`);
				}
			},
		});

		// 拦截保存命令：先格式化再保存（参照 obsidian-linter 实现）
			const saveCmd = (this.app as any).commands?.commands?.['editor:save-file'];
		this.originalSaveCallback = saveCmd?.checkCallback;
		if (typeof this.originalSaveCallback === 'function') {
			saveCmd.checkCallback = (checking: boolean) => {
				if (checking) return this.originalSaveCallback!(checking);

				this.originalSaveCallback!(checking);

				if (!this.settings.format.formatOnSave) return;

				const editor = this.app.workspace.activeEditor?.editor;
				const file = this.app.workspace.getActiveFile();
				if (!editor || !file) return;

				this.applyFormattedText(editor, file);
			};
		}

		// 注册文件变化事件，防抖刷新状态卡片
		const debouncedRefresh = () => {
			if (this.refreshTimer) {
				window.clearTimeout(this.refreshTimer);
			}
			this.refreshTimer = window.setTimeout(() => {
				this.refreshView();
				this.refreshTimer = null;
			}, 500);
		};

		this.registerEvent(this.app.vault.on('create', debouncedRefresh));
		this.registerEvent(this.app.vault.on('delete', debouncedRefresh));
		this.registerEvent(this.app.vault.on('rename', debouncedRefresh));
		this.registerEvent(this.app.vault.on('modify', debouncedRefresh));

		// 记录鼠标位置（用于菜单位置调整）
		this.registerDomEvent(document, 'mousemove', (evt) => {
			this.lastMouseY = evt.clientY;
		});

		// 双击标签页标题关闭该标签页
		this.registerDomEvent(document, 'dblclick', (evt) => {
			if (!this.settings.doubleClickCloseTab) return;

			const tabHeader = (evt.target as HTMLElement).closest('.workspace-tab-header');
			if (!tabHeader) return;

			this.app.workspace.iterateAllLeaves((leaf) => {
				if ((leaf as any).tabHeaderEl === tabHeader) {
					leaf.detach();
				}
			});
		});

		// 注册右键菜单拦截
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source) => {
			if (source === 'file-explorer') {
				this.filterMenuItems(menu, 'file-explorer');
			} else if (source === 'tab-header') {
				this.filterMenuItems(menu, 'tab-header');
			}
		}));

		this.registerEvent(this.app.workspace.on('editor-menu', (menu) => {
			this.filterMenuItems(menu, 'editor');
		}));

		// 如果侧边栏没有打开，自动打开
		this.app.workspace.onLayoutReady(() => {
			this.initView();
			this.applyHighlightStyle();

			// 注册 Tab 复用与新标签页逻辑
			this.uninstallMonkeyPatch = patchOpenLinkText(this);
			this.uninstallFileExplorerHandler = registerFileExplorerHandler(this);

			// 注册关闭标签页后跳转到前一个的逻辑
			this.uninstallCloseTabPatch = patchCloseTabGoToPrev(this);
		});
	}

	onunload() {
		if (this.refreshTimer) {
			window.clearTimeout(this.refreshTimer);
		}
		if (this.ttsPlayer) {
			this.ttsPlayer.stop();
		}
		// 还原保存命令回调
		if (this.originalSaveCallback) {
		const saveCmd = (this.app as any).commands?.commands?.['editor:save-file'];
			if (saveCmd) saveCmd.checkCallback = this.originalSaveCallback;
		}
		// 卸载 Tab 复用 monkey-patch 和文件浏览器处理器
		if (this.uninstallMonkeyPatch) {
			this.uninstallMonkeyPatch();
			this.uninstallMonkeyPatch = null;
		}
		if (this.uninstallFileExplorerHandler) {
			this.uninstallFileExplorerHandler();
			this.uninstallFileExplorerHandler = null;
		}
		if (this.uninstallCloseTabPatch) {
			this.uninstallCloseTabPatch();
			this.uninstallCloseTabPatch = null;
		}
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR_HOME);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.syncConfig();
		this.repaintAllEditors();
		// 刷新视图
		this.refreshView();
	}

	async initView() {
		const { workspace } = this.app;

		// 检查是否已经有该视图
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_HOME);
		if (leaves.length > 0) {
			return;
		}

		// 在左侧边栏创建视图
		const leaf = workspace.getLeftLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR_HOME, active: true });
		}
	}

	async activateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_HOME);

		if (leaves.length > 0) {
			// 激活已有的视图
			workspace.revealLeaf(leaves[0]);
		} else {
			// 创建新视图
			const leaf = workspace.getLeftLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR_HOME, active: true });
			}
		}
	}

	filterMenuItems(menu: Menu, area: MenuAreaKey) {
		const config = this.settings.menuSettings[area];
		if (!config.enabled) return;

		const hiddenTitles = new Set(
			config.items.filter(i => i.hidden).map(i => i.title)
		);

		// 监听菜单 style 变化：Obsidian 设置 top/left 后立即触发，无延迟
		let done = false;
		const observer = new MutationObserver(() => {
			if (done) return;
			const menuEls = document.querySelectorAll('.menu');
			const menuEl = menuEls.length > 0 ? (menuEls[menuEls.length - 1] as HTMLElement) : null;
			if (!menuEl || !menuEl.style.top) return;

			done = true;
			observer.disconnect();

			const scrollEl = menuEl.querySelector('.menu-scroll') || menuEl;
			const domItems = scrollEl.querySelectorAll('.menu-item');
			if (domItems.length === 0) return;

			// 隐藏前：记录原始位置
			const originalTop = parseFloat(menuEl.style.top);
			const originalBottom = originalTop + menuEl.offsetHeight;
			// 通过鼠标位置判断翻转：鼠标靠近菜单底部=翻转，靠近顶部=正常
			const flipped = Math.abs(this.lastMouseY - originalBottom) < Math.abs(this.lastMouseY - originalTop);

			// 隐藏菜单项 + 发现新项
			let changed = false;
			domItems.forEach(item => {
				const titleEl = item.querySelector('.menu-item-title');
				if (!titleEl) return;
				const title = titleEl.textContent?.trim();
				if (!title) return;

				if (!config.items.some(i => i.title === title)) {
					config.items.push({
						id: title.toLowerCase().replace(/\s+/g, '-'),
						title,
						hidden: false,
					});
					changed = true;
				}

				if (hiddenTitles.has(title)) {
					(item as HTMLElement).style.display = 'none';
				}
			});
			if (changed) {
				this.saveSettings();
			}

			// 清理多余分隔线
			const children = Array.from(scrollEl.children) as HTMLElement[];
			const isHidden = (el: HTMLElement) => el.style.display === 'none';
			const isSep = (el: HTMLElement) => el.classList.contains('menu-separator');
			const isGroup = (el: HTMLElement) => el.classList.contains('menu-group');
			const isGroupEmpty = (el: HTMLElement) =>
				isGroup(el) && Array.from(el.querySelectorAll('.menu-item')).every(c => isHidden(c as HTMLElement));

			for (const child of children) {
				if (!isSep(child)) continue;
				const prev = child.previousElementSibling as HTMLElement | null;
				const next = child.nextElementSibling as HTMLElement | null;
				const prevBad = !prev || isSep(prev) || isHidden(prev) || isGroupEmpty(prev);
				const nextBad = !next || isSep(next) || isHidden(next) || isGroupEmpty(next);
				if (prevBad || nextBad) {
					child.style.display = 'none';
				}
			}

			// 重新定位：保持菜单与鼠标位置的相对关系
			const newHeight = menuEl.offsetHeight;
			const viewportH = window.innerHeight;
			let newTop: number;
			if (flipped) {
				// 翻转模式：保持底部对齐鼠标位置
				newTop = Math.max(0, this.lastMouseY - newHeight);
			} else {
				// 正常模式：保持顶部对齐鼠标位置
				newTop = this.lastMouseY;
				if (newTop + newHeight > viewportH) {
					newTop = Math.max(0, viewportH - newHeight);
				}
			}
			menuEl.style.top = `${newTop}px`;
		});
		observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });
		setTimeout(() => observer.disconnect(), 2000);
	}

	private syncConfig() {
		Object.assign(formattingConfig, this.settings);
		Object.assign(spaceConfig, this.settings);
	}

	private repaintAllEditors() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				const cm6 = (leaf.view.editor as unknown as { cm: EditorView }).cm;
				if (cm6) cm6.dispatch({});
			}
		});
	}

	refreshView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_HOME);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof SidebarHomeView) {
				view.render();
			}
		}
	}

	applyHighlightStyle() {
		highlightColor.value = this.settings.ttsHighlightColor;
	}

	private applyFormattedText(editor: Editor, file: TFile): boolean {
		const oldText = editor.getValue();
		const newText = formatMarkdown(oldText, file.stat.ctime, this.settings.format);
		if (oldText === newText) return false;

		const cm = (editor as any).cm;
		const scrollTop = cm.scrollDOM?.scrollTop ?? 0;

		// 找首尾公共部分，只替换中间差异
		let prefixLen = 0;
		while (prefixLen < oldText.length && prefixLen < newText.length && oldText[prefixLen] === newText[prefixLen]) {
			prefixLen++;
		}
		let oldEnd = oldText.length;
		let newEnd = newText.length;
		while (oldEnd > prefixLen && newEnd > prefixLen && oldText[oldEnd - 1] === newText[newEnd - 1]) {
			oldEnd--;
			newEnd--;
		}
		const insert = newText.slice(prefixLen, newEnd);
		cm.dispatch({
			changes: [{ from: prefixLen, to: oldEnd, insert }],
			scrollIntoView: false,
			filter: false,
		});

		// 双帧后恢复滚动（确保 DOM 完成布局和绘制）
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				cm.scrollDOM.scrollTop = scrollTop;
			});
		});

		return true;
	}
}
