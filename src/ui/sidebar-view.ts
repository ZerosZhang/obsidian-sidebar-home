import {
	ItemView,
	MarkdownView,
	Menu,
	Notice,
	TFile,
	TFolder,
	WorkspaceLeaf,
} from 'obsidian';
import type SidebarHomePlugin from '../main';
import { type PlayState } from '../tts/tts-player';

export const VIEW_TYPE_SIDEBAR_HOME = 'sidebar-home';

export class SidebarHomeView extends ItemView {
	plugin: SidebarHomePlugin;
	private countCache: Map<string, number> = new Map();

	constructor(leaf: WorkspaceLeaf, plugin: SidebarHomePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SIDEBAR_HOME;
	}

	getDisplayText(): string {
		return '主页';
	}

	getIcon(): string {
		return 'home';
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		// 清理工作
	}

	onPaneMenu(menu: Menu, source: string): void {
		if (source === 'tab-header') {
			this.plugin.filterMenuItems(menu, 'tab-header');
		}
		super.onPaneMenu(menu, source);
	}

	render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('sidebar-home-container');

		this.renderCreateNoteSection(container);
		this.renderQuickLinksSection(container);
		this.renderStatusCardsSection(container);
		this.renderAudioControls(container);
	}

	// ========== 模块一：新建笔记 + 新建日记 ==========
	renderCreateNoteSection(container: HTMLElement) {
		const section = container.createDiv({ cls: 'sidebar-home-section sidebar-home-section--top' });
		const row = section.createDiv({ cls: 'sidebar-home-create-row' });

		// 新建笔记按钮
		const noteBtn = row.createEl('button', {
			cls: 'sidebar-home-create-btn sidebar-home-create-btn--green',
			text: '📝 新建笔记',
		});

		noteBtn.addEventListener('click', async () => {
			const originalText = noteBtn.textContent || '📝 新建笔记';
			noteBtn.setText('创建中…');
			noteBtn.disabled = true;
			try {
				await this.createDailyNote();
			} catch (e) {
				console.error('[SidebarHome] 创建笔记失败:', e);
				new Notice(`创建笔记失败: ${(e as Error).message}`);
			} finally {
				noteBtn.setText(originalText);
				noteBtn.disabled = false;
			}
		});

		// 新建日记按钮
		const diaryBtn = row.createEl('button', {
			cls: 'sidebar-home-create-btn sidebar-home-create-btn--blue',
			text: '📅 新建日记',
		});

		diaryBtn.addEventListener('click', async () => {
			const originalText = diaryBtn.textContent || '📅 新建日记';
			diaryBtn.setText('创建中…');
			diaryBtn.disabled = true;
			try {
				await this.createDiaryEntry();
			} catch (e) {
				console.error('[SidebarHome] 创建日记失败:', e);
				new Notice(`创建日记失败: ${(e as Error).message}`);
			} finally {
				diaryBtn.setText(originalText);
				diaryBtn.disabled = false;
			}
		});
	}

	async createDailyNote() {
		const { cacheFolder } = this.plugin.settings;
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const hours = String(now.getHours()).padStart(2, '0');
		const minutes = String(now.getMinutes()).padStart(2, '0');
		const seconds = String(now.getSeconds()).padStart(2, '0');
		const title = `${year}年${month}月${day}日 ${hours}时${minutes}分${seconds}秒`;

		// 确保文件夹存在
		let folder = this.app.vault.getAbstractFileByPath(cacheFolder);
		if (!folder) {
			await this.app.vault.createFolder(cacheFolder);
		}

		const filePath = `${cacheFolder}/${title}.md`;
		let file = this.app.vault.getAbstractFileByPath(filePath);

		// 处理重名
		let finalPath = filePath;
		let counter = 1;
		while (file) {
			finalPath = `${cacheFolder}/${title} (${counter}).md`;
			file = this.app.vault.getAbstractFileByPath(finalPath);
			counter++;
		}

		// 创建空白文件
		const newFile = await this.app.vault.create(finalPath, '');

		// 在新标签页中以编辑模式打开
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: 'markdown',
			state: {
				file: newFile.path,
				mode: 'source',
			},
		});
	}

	async createDiaryEntry() {
		const { diaryFolder } = this.plugin.settings;
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const monthName = `${year}年${month}月`;
		const dayHeading = `## ${year}年${month}月${day}日`;

		// 确保文件夹存在
		let folder = this.app.vault.getAbstractFileByPath(diaryFolder);
		if (!folder) {
			folder = await this.app.vault.createFolder(diaryFolder);
		}

		const filePath = `${diaryFolder}/${monthName}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			// 文件存在：追加今天的日期标题
			const content = await this.app.vault.read(file);
			const newContent = content.endsWith('\n') ? content + '\n' + dayHeading + '\n' : content + '\n\n' + dayHeading + '\n';
			await this.app.vault.modify(file, newContent);
		} else {
			// 文件不存在：创建并写入日期标题
			await this.app.vault.create(filePath, dayHeading + '\n');
		}

		// 在新标签页中以编辑模式打开
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: 'markdown',
			state: {
				file: filePath,
				mode: 'source',
			},
		});
	}

	// ========== 模块二：收藏夹 ==========
	renderQuickLinksSection(container: HTMLElement) {
		const section = container.createDiv({ cls: 'sidebar-home-section sidebar-home-section--grow' });
		section.createDiv({ cls: 'sidebar-home-section-title', text: '收藏夹' });

		if (this.plugin.settings.quickLinks.length === 0) {
			section.createDiv({
				cls: 'sidebar-home-empty',
				text: '暂无常用链接，请在设置中添加',
			});
			return;
		}

		const isSquare = this.plugin.settings.quickLinkStyle === 'square';
		const grid = section.createDiv({ cls: 'sidebar-home-quick-links-grid' });

		for (const link of this.plugin.settings.quickLinks) {
			const statusClass = this.getLinkStatusClass(link.targetPath);
			const styleClass = isSquare ? 'sidebar-home-quick-link--square' : '';
			const card = grid.createDiv({ cls: `sidebar-home-card sidebar-home-quick-link ${styleClass} ${statusClass}` });
			card.createSpan({ cls: 'sidebar-home-card-emoji', text: link.emoji });
			card.createSpan({ cls: 'sidebar-home-card-name', text: link.name });

			card.addEventListener('click', () => {
				this.openTarget(link.targetPath);
			});
		}
	}

	// ========== 模块三：待处理 ==========
	renderStatusCardsSection(container: HTMLElement) {
		const section = container.createDiv({ cls: 'sidebar-home-section sidebar-home-section--bottom' });
		section.createDiv({ cls: 'sidebar-home-section-title', text: '待处理' });
		const grid = section.createDiv({ cls: 'sidebar-home-status-grid' });

		const { todoPage, unfinishPage, clipPage, cacheFolder } = this.plugin.settings;
		const todoName = this.extractPageName(todoPage);
		const unfinishName = this.extractPageName(unfinishPage);

		// 待办
		this.createStatusCard(grid, '待办', '📋', 'sidebar-home-status--todo', async () => {
			return this.countBacklinks(todoPage);
		}, todoPage);

		// 未完成
		this.createStatusCard(grid, '未完成', '⏳', 'sidebar-home-status--unfinish', async () => {
			return this.countBacklinks(unfinishPage);
		}, unfinishPage);

		// 剪藏
		this.createStatusCard(grid, '剪藏', '📑', 'sidebar-home-status--clip', async () => {
			return await this.countH2Headers(clipPage);
		}, clipPage);

		// 缓存
		const cachePagePath = cacheFolder + '/' + this.extractPageName(cacheFolder);
		this.createStatusCard(grid, '缓存', '📦', 'sidebar-home-status--cache', async () => {
			return await this.countCacheFiles(cacheFolder);
		}, cachePagePath);
	}

	// ========== 模块四：语音播放控制 ==========
	renderAudioControls(container: HTMLElement) {
		const section = container.createDiv({ cls: 'sidebar-home-section tts-audio-section' });
		section.createDiv({ cls: 'sidebar-home-section-title', text: '🔊 语音朗读' });

		const panel = section.createDiv({ cls: 'tts-audio-panel' });

		// 进度文本
		const progressLabel = panel.createDiv({ cls: 'tts-progress-label', text: '就绪' });

		// 进度条
		const progressBar = panel.createDiv({ cls: 'tts-progress-bar' });
		const progressFill = progressBar.createDiv({ cls: 'tts-progress-fill' });

		// 控制按钮行
		const btnRow = panel.createDiv({ cls: 'tts-btn-row' });

		const readBtn = btnRow.createEl('button', {
			cls: 'tts-btn tts-btn--start',
			text: '▶ 朗读',
		});

		// 分隔线
		const sep = btnRow.createDiv({ cls: 'tts-btn-sep' });

		const pauseBtn = btnRow.createEl('button', {
			cls: 'tts-btn tts-btn--ctrl',
			text: '⏸ 暂停',
		});

		const stopBtn = btnRow.createEl('button', {
			cls: 'tts-btn tts-btn--ctrl',
			text: '⏹ 停止',
		});

		const player = this.plugin.ttsPlayer;
		console.log('[TTS-View] player=', player ? 'OK' : 'NULL');
		console.log('[TTS-View] player.state=', player?.getState());

		// 查找 Markdown 视图（避免 getActiveViewOfType 的类引用匹配问题）
		const getMarkdownView = (): { getValue: () => string; getSelection: () => string } | null => {
			// 先试 getActiveViewOfType
			let view = this.app.workspace.getActiveViewOfType(MarkdownView);
			console.log('[TTS-View] getActiveViewOfType(MarkdownView)=', view ? 'OK' : 'NULL');

			// 如果 null，遍历找到可见的 markdown leaf
			if (!view) {
				const leaves = this.app.workspace.getLeavesOfType('markdown');
				for (const leaf of leaves) {
					// 检查 leaf 是否在活跃分屏中且未隐藏
					const containerEl = (leaf as any).containerEl as HTMLElement | undefined;
					if (containerEl && containerEl.isConnected && containerEl.offsetParent !== null) {
						view = leaf.view as MarkdownView;
						console.log('[TTS-View] 找到可见 markdown:', (leaf as any).id);
						break;
					}
				}
				// 都不行就用第一个
				if (!view && leaves.length > 0) {
					view = leaves[0].view as MarkdownView;
				}
			}
			if (view && typeof view.editor?.getValue === 'function') {
				return {
					getValue: () => view!.editor.getValue(),
					getSelection: () => view!.editor.getSelection(),
				};
			}
			return null;
		};

		const updateUI = () => {
			const state = player.getState();
			const { current, total } = player.getProgress();

			if (state === 'idle' || state === 'stopped') {
				progressLabel.setText('就绪');
				progressFill.style.width = '0%';
				pauseBtn.setText('⏸ 暂停');
			} else if (state === 'generating') {
				progressLabel.setText('生成中…');
				progressFill.style.width = '0%';
				pauseBtn.setText('⏸ 暂停');
			} else if (state === 'playing') {
				progressLabel.setText(`句子 ${current}/${total}`);
				progressFill.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
				pauseBtn.setText('⏸ 暂停');
			} else if (state === 'paused') {
				progressLabel.setText(`已暂停 ${current}/${total}`);
				pauseBtn.setText('▶ 继续');
			}
		};

		player.onStateChange = (_state) => updateUI();
		player.onSentenceChange = (_index, _total) => updateUI();

		readBtn.addEventListener('click', async () => {
			console.log('[TTS-View] ▶ 朗读 按钮点击');
			const mdView = getMarkdownView();
			if (!mdView) {
				new Notice('请先打开一个笔记文件');
				return;
			}
			const sel = mdView.getSelection();
			const fullText = mdView.getValue();
			if (sel) {
				console.log('[TTS-View] 有选中文本, 长度=', sel.length);
				await player.playFromSelection(fullText, sel);
			} else {
				console.log('[TTS-View] 无选中, 朗读全文, 长度=', fullText.length);
				await player.playFullNote(fullText);
			}
		});

		pauseBtn.addEventListener('click', () => {
			console.log('[TTS-View] ⏸ 暂停按钮点击, state=', player.getState());
			const state = player.getState();
			if (state === 'playing') player.pause();
			else if (state === 'paused') player.resume();
		});

		stopBtn.addEventListener('click', () => {
			console.log('[TTS-View] ⏹ 停止按钮点击');
			player.stop();
		});

		updateUI();
	}

	createStatusCard(
		container: HTMLElement,
		name: string,
		emoji: string,
		colorClass: string,
		countFn: () => Promise<number>,
		targetPath: string
	) {
		const card = container.createDiv({ cls: `sidebar-home-card sidebar-home-status-card ${colorClass}` });
		card.createSpan({ cls: 'sidebar-home-status-emoji', text: emoji });
		const nameEl = card.createSpan({ cls: 'sidebar-home-status-name', text: name });
		const countEl = card.createSpan({ cls: 'sidebar-home-status-count', text: '...' });

		// 先显示缓存值（避免闪烁）
		const cached = this.countCache.get(name);
		if (cached !== undefined) {
			countEl.setText(` · ${cached}`);
		}

		// 异步获取数量并更新缓存
		countFn().then(count => {
			this.countCache.set(name, count);
			countEl.setText(` · ${count}`);
		}).catch(() => {
			countEl.setText(' · -');
		});

		card.addEventListener('click', () => {
			this.openTarget(targetPath);
		});
	}

	// ========== 辅助方法 ==========

	async countBacklinks(targetPath: string): Promise<number> {
		const pageName = this.extractPageName(targetPath);
		const candidates = [pageName, targetPath, targetPath + '.md'];
		const sourceSet = new Set<string>();
		const allFiles = this.app.vault.getMarkdownFiles();

		for (const file of allFiles) {
			if (file.name === pageName + '.md') continue;

			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			// 合并 links 和 embeds
			const allRefs = [
				...(cache.links || []),
				...(cache.embeds || []),
			];

			for (const ref of allRefs) {
				if (candidates.includes(ref.link)) {
					sourceSet.add(file.path);
					break;
				}
			}
		}

		return sourceSet.size;
	}

	async countH2Headers(pagePath: string): Promise<number> {
		const filePath = pagePath + '.md';
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return 0;

		const content = await this.app.vault.read(file);
		const matches = content.match(/^##\s+/gm);
		return matches ? matches.length : 0;
	}

	async countCacheFiles(folderPath: string): Promise<number> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) return 0;

		const pageName = this.extractPageName(folderPath) + '.md';
		let count = 0;
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md' && child.name !== pageName) {
				count++;
			}
		}
		return count;
	}

	extractPageName(filePath: string): string {
		// 从路径中提取页面名称，如 "任务/待办" -> "待办"
		const parts = filePath.split('/');
		return parts[parts.length - 1];
	}

	getLinkStatusClass(targetPath: string): string {
		if (!targetPath) return 'sidebar-home-link--missing';

		// 1. 尝试作为文件
		let file = this.app.vault.getAbstractFileByPath(targetPath);
		if (!file && !targetPath.endsWith('.md')) {
			file = this.app.vault.getAbstractFileByPath(targetPath + '.md');
		}
		if (file instanceof TFile) {
			return 'sidebar-home-link--file';
		}

		// 2. 尝试作为文件夹
		const folder = this.app.vault.getAbstractFileByPath(targetPath);
		if (folder instanceof TFolder) {
			return 'sidebar-home-link--folder';
		}

		// 3. 不存在
		return 'sidebar-home-link--missing';
	}

	async openFileInReadingMode(filePath: string) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		if (this.plugin.settings.reuseExistingTab) {
			// 查找主区域中已打开该文件的标签页
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of leaves) {
				const view = leaf.view as any;
				if (view.file?.path === filePath && leaf.getRoot() === this.app.workspace.rootSplit) {
					this.app.workspace.revealLeaf(leaf);
					this.app.workspace.setActiveLeaf(leaf, { focus: true });
					return;
				}
			}
		}

		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file);

		const view = leaf.view;
		if (view && (view as any).setState) {
			try {
				await (view as any).setState({ mode: 'preview' }, { history: false });
			} catch (e) {
				// ignore
			}
		}
	}

	async openTarget(targetPath: string) {
		if (!targetPath) return;

		// 1. 尝试直接作为文件打开（可能带 .md 后缀）
		let file = this.app.vault.getAbstractFileByPath(targetPath);
		if (!file && !targetPath.endsWith('.md')) {
			file = this.app.vault.getAbstractFileByPath(targetPath + '.md');
		}

		if (file instanceof TFile) {
			await this.openFileInReadingMode(file.path);
			return;
		}

		// 2. 尝试作为文件夹处理
		const folder = this.app.vault.getAbstractFileByPath(targetPath);
		if (folder instanceof TFolder) {
			const folderName = targetPath.split('/').pop() || targetPath;
			const sameNameFile = this.app.vault.getAbstractFileByPath(`${targetPath}/${folderName}.md`);

			if (sameNameFile instanceof TFile) {
				await this.openFileInReadingMode(sameNameFile.path);
			} else {
				this.openInSystemExplorer(targetPath);
			}
			return;
		}

		// 3. 都不存在，提示
		new Notice(`路径不存在: ${targetPath}`);
	}

	openInSystemExplorer(folderPath: string) {
		try {
			const { shell } = require('electron');
			const fullPath = (this.app.vault.adapter as any).getFullPath(folderPath);
			shell.openPath(fullPath);
		} catch (e) {
			console.error('[SidebarHome] 打开文件资源管理器失败:', e);
			new Notice('无法打开文件资源管理器');
		}
	}
}
