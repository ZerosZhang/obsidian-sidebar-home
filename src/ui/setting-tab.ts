import { App, Notice, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder } from 'obsidian';
import type { ColorComponent } from 'obsidian';
import type SidebarHomePlugin from '../main';
import type { QuickLink, MenuAreaKey } from '../settings';
import { highlightColor } from '../tts/tts-highlight';
import { generateEdgeTts } from '../tts/edge-tts';
import { refreshMountedPreviews } from '../preview/excel-embed';
import { openInSystemExplorer, pickFolder } from '../export/folder-picker';
import { exportMarkdownFile } from '../export/export-runner';

const MENU_AREA_LABELS: Record<MenuAreaKey, string> = {
	'file-explorer': '文件资源管理器',
	'editor': '编辑器',
	'tab-header': '标签页标题',
};

type FormatSectionItem =
	| { kind: 'toggle'; key: string; label: string; desc: string }
	| { kind: 'text'; key: string; label: string; desc: string; placeholder: string };

const FORMAT_SECTIONS: Array<{ title: string; desc?: string; items: FormatSectionItem[] }> = [
	{
		title: '执行方式',
		desc: '使用 Ctrl+P → "格式化当前文档" 手动执行；规则按流水线顺序执行，先执行的在前。',
		items: [
			{ kind: 'toggle', key: 'formatOnSave', label: '保存时自动格式化', desc: '按 Ctrl+S 保存时，先格式化再保存' },
		],
	},
	{
		title: '保护机制',
		items: [
			{ kind: 'toggle', key: 'protectSpanText', label: '保护 span 标签内容', desc: '<span> 标签内的文本跳过格式化' },
			{ kind: 'text', key: 'yamlSkipTag', label: 'YAML 跳过标签', desc: 'YAML 含此标签时整篇跳过格式化', placeholder: '#no-format' },
		],
	},
	{
		title: 'Phase 1: 标记转换',
		items: [
			{ kind: 'toggle', key: 'boldToStrong', label: '加粗 → <strong>', desc: '**text** 转为 <strong>text</strong>' },
			{ kind: 'toggle', key: 'strikethroughToDel', label: '删除线 → <del>', desc: '~~text~~ 转为 <del>text</del>' },
			{ kind: 'toggle', key: 'markdownLinkToWiki', label: 'Markdown链接 → Wiki链接', desc: '[text](url) 转为 [[url]]' },
			{ kind: 'toggle', key: 'smartQuotes', label: '弯引号替换', desc: '"双引号" → \u201c弯双\u201d, \'单引号\' → \u2018弯单\u2019' },
			{ kind: 'toggle', key: 'removeUnclosedTags', label: '移除未闭合HTML标签', desc: '清除无配对的开闭标签（br/img等自闭合除外）' },
		],
	},
	{
		title: 'Phase 2: 标题处理',
		items: [
			{ kind: 'toggle', key: 'headerIncrement', label: '标题层级递增', desc: '从 H2 起步，H1→H2, H2→H3...' },
			{ kind: 'toggle', key: 'headingsStartLine', label: '标题前导空白', desc: '移除标题行首多余空格' },
		],
	},
	{
		title: 'Phase 3: 中英文排版',
		items: [
			{ kind: 'toggle', key: 'cjkSpacing', label: '中英文空格', desc: '中文与英文/数字间插入空格' },
		],
	},
	{
		title: 'Phase 4: 代码块',
		items: [
			{ kind: 'toggle', key: 'codeFenceLanguage', label: '代码块默认语言', desc: '无语言标识的代码块添加默认语言' },
			{ kind: 'text', key: 'codeFenceDefaultLanguage', label: '默认语言', desc: '为未指定语言的代码块添加的语言标识', placeholder: 'CSharp' },
			{ kind: 'toggle', key: 'inlineCodeSpacing', label: '行内代码前后空格', desc: '确保行内代码与两侧文字之间各有一个空格' },
		],
	},
	{
		title: 'Phase 5: 列表',
		items: [
			{ kind: 'toggle', key: 'spaceAfterListMarkers', label: '列表标记后空格', desc: '列表标记后确保有一个空格' },
			{ kind: 'toggle', key: 'unorderedListStyle', label: '无序列表样式', desc: '统一为文件中第一个列表标记样式' },
			{ kind: 'toggle', key: 'removeEmptyLinesBetweenListMarkers', label: '移除列表间空行', desc: '列表项之间不留空行' },
		],
	},
	{
		title: 'Phase 6: 引用块',
		items: [
			{ kind: 'toggle', key: 'blockquoteStyle', label: '引用块样式', desc: '> 后统一加空格' },
		],
	},
	{
		title: 'Phase 7: 空行管理',
		items: [
			{ kind: 'toggle', key: 'addBlankLineAfterYaml', label: 'YAML 后空行', desc: 'YAML frontmatter 后确保有空行' },
			{ kind: 'toggle', key: 'headingBlankLines', label: '标题前后空行', desc: '标题前后各确保一个空行' },
			{ kind: 'toggle', key: 'paragraphBlankLines', label: '段落空行', desc: '块级结构（标题/列表/表格等）后紧接段落时，补空行分隔' },
			{ kind: 'toggle', key: 'hrBlankLines', label: '分隔线前后空行', desc: '--- 分隔线上下各确保一个空行' },
			{ kind: 'toggle', key: 'emptyLineAroundTables', label: '表格前后空行', desc: '表格前后确保有空行' },
			{ kind: 'toggle', key: 'consecutiveBlankLines', label: '合并连续空行', desc: '3个以上连续空行合并为2个' },
		],
	},
	{
		title: 'Phase 8: 多余空格',
		items: [
			{ kind: 'toggle', key: 'removeMultipleSpaces', label: '移除多余空格', desc: '连续2个以上空格合并为1个' },
			{ kind: 'toggle', key: 'removeSpaceAroundFullWidthChars', label: '全角符号空格', desc: '移除全角标点周围的空格' },
			{ kind: 'toggle', key: 'removeLinkSpacing', label: '链接文本空格', desc: '移除 [] 内文本首尾空格' },
			{ kind: 'toggle', key: 'removeLeadingSpaces', label: '清理段落前导空格', desc: '移除普通段落行首的 1-3 个空格' },
		],
	},
	{
		title: 'Phase 9: 行尾处理',
		items: [
			{ kind: 'toggle', key: 'trailingSpaces', label: '行尾空格', desc: '移除行尾多余空格' },
			{ kind: 'toggle', key: 'lineBreakAtDocumentEnd', label: '文档末尾换行', desc: '确保文档末尾有换行符' },
		],
	},
	{
		title: 'Phase 10: YAML 时间戳',
		items: [
			{ kind: 'toggle', key: 'yamlTimestamp', label: 'YAML 时间戳', desc: '自动插入/更新创建和修改日期' },
			{ kind: 'text', key: 'yamlDateFormat', label: '日期格式', desc: 'Moment.js 格式字符串', placeholder: 'YYYY年MM月DD日 HH:mm:ss' },
			{ kind: 'text', key: 'yamlDateCreatedKey', label: '创建日期 Key', desc: 'YAML 中记录文件创建日期的字段名', placeholder: '创建日期' },
			{ kind: 'text', key: 'yamlDateModifiedKey', label: '修改日期 Key', desc: 'YAML 中记录文件修改日期的字段名', placeholder: '修改日期' },
		],
	},
];

export class SidebarHomeSettingTab extends PluginSettingTab {
	plugin: SidebarHomePlugin;
	private dragSrcIndex: number = -1;
	private activeTab: number = 0;
	private menuSearchQueries: Record<MenuAreaKey, string> = {
		'file-explorer': '',
		'editor': '',
		'tab-header': '',
	};

	constructor(app: App, plugin: SidebarHomePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Tab 栏
		const tabBar = containerEl.createDiv({ cls: 'sh-settings-tab-bar' });
		const tabs: Array<{ label: string }> = [
			{ label: '侧边栏' },
			{ label: '标签页' },
			{ label: '格式化' },
			{ label: '样式隐藏' },
			{ label: '语音朗读' },
			{ label: 'Excel 预览' },
			{ label: '导出' },
		];

		tabs.forEach((tab, index) => {
			const btn = tabBar.createDiv({
				cls: `sh-settings-tab-btn${this.activeTab === index ? ' is-active' : ''}`,
				text: tab.label,
			});
			btn.addEventListener('click', () => {
				if (this.activeTab !== index) {
					this.activeTab = index;
					this.display();
				}
			});
		});

		// Tab 内容
		const content = containerEl.createDiv({ cls: 'sh-settings-tab-content' });

		// Tab 1: 基础设置
		const panel1 = content.createDiv({
			cls: `sh-settings-tab-panel${this.activeTab === 0 ? ' is-active' : ''}`,
		});
		this.renderBasicSettings(panel1);

		// Tab 2: 标签页与菜单
		const panel2 = content.createDiv({
			cls: `sh-settings-tab-panel${this.activeTab === 1 ? ' is-active' : ''}`,
		});
		this.renderTabAndMenuSettings(panel2);

		// Tab 3: 格式化
		const panel3 = content.createDiv({
			cls: `sh-settings-tab-panel${this.activeTab === 2 ? ' is-active' : ''}`,
		});
		this.renderFormatSettings(panel3);

		// Tab 4: 隐藏样式
		const panel4 = content.createDiv({
			cls: `sh-settings-tab-panel${this.activeTab === 3 ? ' is-active' : ''}`,
		});
		this.renderFormatHiderSettings(panel4);

		// Tab 5: 语音朗读
		const panel5 = content.createDiv({
			cls: `sh-settings-tab-panel${this.activeTab === 4 ? ' is-active' : ''}`,
		});
		this.renderTtsSettings(panel5);

		// Tab 6: Excel 预览
		const panel6 = content.createDiv({
			cls: `sh-settings-tab-panel${this.activeTab === 5 ? ' is-active' : ''}`,
		});
		this.renderExcelSettings(panel6);

		// Tab 7: 导出
		const panel7 = content.createDiv({
			cls: `sh-settings-tab-panel${this.activeTab === 6 ? ' is-active' : ''}`,
		});
		this.renderExportSettings(panel7);
	}

	// ========== Tab 1: 基础设置 ==========

	private renderBasicSettings(container: HTMLElement) {
		container.createEl('h2', { text: '基础设置' });

		new Setting(container)
			.setName('缓存文件夹')
			.setDesc('快速创建笔记的目标文件夹（相对库根目录）')
			.addText(text => text
				.setPlaceholder('缓存')
				.setValue(this.plugin.settings.cacheFolder)
				.onChange(async (value) => {
					this.plugin.settings.cacheFolder = value || '缓存';
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('时光页面')
			.setDesc('「打开时光」按钮跳转的笔记路径（相对库根目录，不含 .md）')
			.addText(text => text
				.setPlaceholder('主题/时光/时光')
				.setValue(this.plugin.settings.timePage)
				.onChange(async (value) => {
					this.plugin.settings.timePage = value || '主题/时光/时光';
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('剪藏页面')
			.setDesc('剪藏卡片对应的笔记路径（相对库根目录，不含 .md）')
			.addText(text => {
				text.setPlaceholder('剪藏')
					.setValue(this.plugin.settings.clipPage)
					.onChange(async (value) => {
						this.plugin.settings.clipPage = value || '剪藏';
						await this.plugin.saveSettings();
					});
				this.setupPathSuggestion(text.inputEl);
			});

		new Setting(container)
			.setName('待办页面')
			.setDesc('待办卡片对应的笔记路径（相对库根目录，不含 .md）')
			.addText(text => {
				text.setPlaceholder('待办')
					.setValue(this.plugin.settings.todoPage)
					.onChange(async (value) => {
						this.plugin.settings.todoPage = value || '待办';
						await this.plugin.saveSettings();
					});
				this.setupPathSuggestion(text.inputEl);
			});

		new Setting(container)
			.setName('未完成页面')
			.setDesc('未完成卡片对应的笔记路径（相对库根目录，不含 .md）')
			.addText(text => {
				text.setPlaceholder('未完成')
					.setValue(this.plugin.settings.unfinishPage)
					.onChange(async (value) => {
						this.plugin.settings.unfinishPage = value || '未完成';
						await this.plugin.saveSettings();
					});
				this.setupPathSuggestion(text.inputEl);
			});

		// ========== 常用链接 ==========
		container.createEl('h2', { text: '常用链接' });

		new Setting(container)
			.setName('卡片显示样式')
			.setDesc('选择收藏夹卡片的布局方式')
			.addDropdown(dropdown => dropdown
				.addOption('horizontal', '横向（左图标右文字）')
				.addOption('square', '方形（上图标下文字）')
				.setValue(this.plugin.settings.quickLinkStyle)
				.onChange(async (value) => {
					this.plugin.settings.quickLinkStyle = value as 'horizontal' | 'square';
					await this.plugin.saveSettings();
				}));

		const linksContainer = container.createDiv({ cls: 'sidebar-home-settings-links' });
		this.renderQuickLinksList(linksContainer);

		new Setting(container)
			.addButton((btn) => {
				btn.setButtonText('+ 添加常用链接')
					.setCta()
					.onClick(() => {
						const newLink: QuickLink = {
							id: Date.now().toString(),
							emoji: '📄',
							name: '新链接',
							targetPath: '',
						};
						this.plugin.settings.quickLinks.push(newLink);
						this.plugin.saveSettings();
						this.display();
					});
			});
	}

	// ========== Tab 2: 标签页与菜单 ==========

	private renderTabAndMenuSettings(container: HTMLElement) {
		// 标签页设置
		container.createEl('h2', { text: '标签页设置' });

		new Setting(container)
			.setName('复用已有标签页')
			.setDesc('打开文件时，如果该文件已在主标签页中打开，则直接跳转到该标签页，不再重新打开')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reuseExistingTab)
				.onChange(async (value) => {
					this.plugin.settings.reuseExistingTab = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('双击关闭标签页')
			.setDesc('双击标签页标题即可关闭该标签页')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.doubleClickCloseTab)
				.onChange(async (value) => {
					this.plugin.settings.doubleClickCloseTab = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('关闭标签页后跳转到前一个')
			.setDesc('关闭标签页后激活前一个（左侧）标签页；关闭第一个标签页时保持默认行为')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.closeTabGoToPrev)
				.onChange(async (value) => {
					this.plugin.settings.closeTabGoToPrev = value;
					await this.plugin.saveSettings();
				}));

		// 右键菜单设置
		container.createEl('h2', { text: '右键菜单' });

		const areas: MenuAreaKey[] = ['file-explorer', 'editor', 'tab-header'];
		for (const area of areas) {
			this.renderMenuAreaSection(container, area);
		}
	}

	// ========== Tab 3: 隐藏样式 ==========

	private renderFormatHiderSettings(container: HTMLElement) {
		// HTML 标签隐藏
		container.createEl('h2', { text: 'HTML 标签隐藏' });

		new Setting(container)
			.setName('隐藏 HTML 标签')
			.setDesc('关闭时标签可见且内容仍显示格式（粗体/删除线等）；开启时标签隐藏')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideHtmlFormatting)
				.onChange(async (value) => {
					this.plugin.settings.hideHtmlFormatting = value;
					await this.plugin.saveSettings();
					tagEditorEl.style.display = value ? 'block' : 'none';
				}));

		const tagEditorEl = container.createDiv({
			attr: { style: `display: ${this.plugin.settings.hideHtmlFormatting ? 'block' : 'none'}` },
		});
		this.renderHtmlTagEditor(tagEditorEl);

		// 空格可视化
		container.createEl('h2', { text: '空格可视化' });

		new Setting(container)
			.setName('显示空格')
			.setDesc('以半透明 · 标记显示空格位置，帮助辨识缩进和对齐')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showWhitespace)
				.onChange(async (value) => {
					this.plugin.settings.showWhitespace = value;
					await this.plugin.saveSettings();
				}));
	}

	private renderHtmlTagEditor(container: HTMLElement) {
		const wrap = container.createDiv({ cls: 'sh-html-tags' });
		let tags = this.plugin.settings.hideHtmlTags
			.split(',')
			.map(t => t.trim().toLowerCase())
			.filter(t => t.length > 0);

		const persist = async () => {
			this.plugin.settings.hideHtmlTags = tags.join(',');
			await this.plugin.saveSettings();
		};

		const render = () => {
			wrap.empty();

			tags.forEach((tag) => {
				const chip = wrap.createSpan({ cls: 'sh-html-tag-chip' });
				chip.createSpan({ text: tag });
				const remove = chip.createSpan({
					cls: 'sh-html-tag-chip-remove',
					text: '×',
					attr: { title: '移除' },
				});
				remove.addEventListener('click', async () => {
					tags = tags.filter(t => t !== tag);
					await persist();
					render();
					wrap.querySelector('input')?.focus();
				});
			});

			const input = wrap.createEl('input', {
				cls: 'sh-html-tag-input',
				attr: { placeholder: tags.length > 0 ? '添加标签…' : '输入标签名后回车添加' },
				type: 'text',
			});
			input.addEventListener('keydown', async (e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				const value = input.value.trim().toLowerCase();
				if (!value || tags.includes(value)) {
					input.value = '';
					return;
				}
				tags.push(value);
				await persist();
				render();
				wrap.querySelector('input')?.focus();
			});
		};

		render();
	}

	private renderMenuAreaSection(container: HTMLElement, area: MenuAreaKey) {
		const config = this.plugin.settings.menuSettings[area];
		const label = MENU_AREA_LABELS[area];

		const section = container.createDiv({ cls: 'sh-menu-area-section' });

		// 区域标题 + 启用开关
		const header = section.createDiv({ cls: 'sh-menu-area-header' });
		header.createSpan({ cls: 'sh-menu-area-title', text: label });

		const toggleContainer = header.createDiv();
		const toggleInput = toggleContainer.createEl('input', { type: 'checkbox' });
		toggleInput.checked = config.enabled;
		toggleInput.addEventListener('change', async () => {
			config.enabled = toggleInput.checked;
			await this.plugin.saveSettings();
			// 刷新子面板可见性
			bodyEl.style.display = config.enabled ? 'block' : 'none';
		});

		// 菜单项列表（仅启用时展开）
		const bodyEl = section.createDiv({
			cls: 'sh-menu-area-body',
			attr: { style: `display: ${config.enabled ? 'block' : 'none'}` },
		});

		// 搜索框
		const searchInput = bodyEl.createEl('input', {
			cls: 'sh-menu-search-input',
			type: 'text',
			attr: { placeholder: '搜索菜单项…' },
		}) as HTMLInputElement;
		searchInput.value = this.menuSearchQueries[area];
		searchInput.addEventListener('input', () => {
			this.menuSearchQueries[area] = searchInput.value;
			this.renderMenuItemsList(itemsContainer, area);
		});

		// 菜单项列表容器
		const itemsContainer = bodyEl.createDiv({ cls: 'sh-menu-items-list' });
		this.renderMenuItemsList(itemsContainer, area);

		// 清空按钮
		const clearBtn = bodyEl.createEl('button', {
			cls: 'sh-menu-clear-btn',
			text: '清空已发现项',
			type: 'button',
		});
		clearBtn.addEventListener('click', async () => {
			config.items = [];
			await this.plugin.saveSettings();
			this.renderMenuItemsList(itemsContainer, area);
		});
	}

	private renderMenuItemsList(container: HTMLElement, area: MenuAreaKey) {
		container.empty();
		const config = this.plugin.settings.menuSettings[area];
		const query = this.menuSearchQueries[area].toLowerCase();

		const filtered = query
			? config.items.filter(item => item.title.toLowerCase().includes(query))
			: config.items;

		if (filtered.length === 0) {
			container.createDiv({
				cls: 'sh-menu-items-empty',
				text: query ? '无匹配项' : '暂无已发现的菜单项，使用对应区域的右键菜单后将自动出现在此处',
			});
			return;
		}

		for (const item of filtered) {
			const row = container.createDiv({ cls: 'sh-menu-item-row' });
			row.createSpan({ cls: 'sh-menu-item-title', text: item.title });

			const statusBtn = row.createEl('button', {
				cls: `sh-menu-item-toggle${item.hidden ? ' is-hidden' : ''}`,
				text: item.hidden ? '隐藏' : '显示',
				type: 'button',
			});
			statusBtn.addEventListener('click', async () => {
				item.hidden = !item.hidden;
				await this.plugin.saveSettings();
				statusBtn.setText(item.hidden ? '隐藏' : '显示');
				statusBtn.toggleClass('is-hidden', item.hidden);
			});
		}
	}

	// ========== 收藏夹链接列表 ==========

	renderQuickLinksList(container: HTMLElement) {
		container.empty();

		if (this.plugin.settings.quickLinks.length === 0) {
			container.createDiv({
				cls: 'sidebar-home-settings-empty',
				text: '暂无常用链接',
			});
			return;
		}

		const self = this;

		for (let i = 0; i < this.plugin.settings.quickLinks.length; i++) {
			const link = this.plugin.settings.quickLinks[i];
			const row = container.createDiv({ cls: 'sidebar-home-settings-link-row' });
			row.setAttribute('draggable', 'true');
			row.setAttribute('data-index', String(i));

			// 拖拽手柄
			const dragHandle = row.createSpan({
				cls: 'sidebar-home-settings-drag-handle',
				text: '⋮⋮',
			});

			// 路径输入框
			const pathInput = row.createEl('input', {
				cls: 'sidebar-home-settings-input sidebar-home-settings-input-path',
				attr: { placeholder: '路径', title: '笔记的相对路径，如：项目管理/周报.md' },
				type: 'text',
			});
			pathInput.value = link.targetPath;
			pathInput.addEventListener('change', async () => {
				link.targetPath = pathInput.value;
				await this.plugin.saveSettings();
			});
			this.setupPathSuggestion(pathInput, async (value) => {
				link.targetPath = value;
				await this.plugin.saveSettings();
			});

			// 图标输入框
			const emojiInput = row.createEl('input', {
				cls: 'sidebar-home-settings-input sidebar-home-settings-input-emoji',
				attr: { placeholder: '📄', title: '图标' },
				type: 'text',
			});
			emojiInput.value = link.emoji;
			emojiInput.addEventListener('change', async () => {
				link.emoji = emojiInput.value;
				await this.plugin.saveSettings();
			});

			// 名称输入框
			const nameInput = row.createEl('input', {
				cls: 'sidebar-home-settings-input sidebar-home-settings-input-name',
				attr: { placeholder: '链接名称', title: '名称' },
				type: 'text',
			});
			nameInput.value = link.name;
			nameInput.addEventListener('change', async () => {
				link.name = nameInput.value;
				await this.plugin.saveSettings();
			});

			// 删除按钮
			const delBtn = row.createEl('button', {
				cls: 'sidebar-home-settings-delete-btn',
				text: '删除',
				type: 'button',
			});
			delBtn.addEventListener('click', async () => {
				this.plugin.settings.quickLinks.splice(i, 1);
				await this.plugin.saveSettings();
				this.display();
			});

			// --- 拖拽事件 ---
			row.addEventListener('dragstart', (e) => {
				self.dragSrcIndex = i;
				row.addClass('sidebar-home-settings-link-row--dragging');
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', String(i));
				}
			});

			row.addEventListener('dragover', (e) => {
				e.preventDefault();
				if (e.dataTransfer) {
					e.dataTransfer.dropEffect = 'move';
				}
				if (self.dragSrcIndex !== i) {
					row.addClass('sidebar-home-settings-link-row--drag-over');
				}
			});

			row.addEventListener('dragleave', () => {
				row.removeClass('sidebar-home-settings-link-row--drag-over');
			});

			row.addEventListener('drop', async (e) => {
				e.preventDefault();
				row.removeClass('sidebar-home-settings-link-row--drag-over');

				const srcIndex = self.dragSrcIndex;
				const dstIndex = i;

				if (srcIndex < 0 || srcIndex === dstIndex) return;

				// 调换数组元素
				const ql = self.plugin.settings.quickLinks;
				const [moved] = ql.splice(srcIndex, 1);
				ql.splice(dstIndex, 0, moved);

				await self.plugin.saveSettings();
				self.display();
			});

			row.addEventListener('dragend', () => {
				row.removeClass('sidebar-home-settings-link-row--dragging');
				// 清理所有行的 drag-over 状态
				const allRows = container.querySelectorAll('.sidebar-home-settings-link-row');
				allRows.forEach((r) => r.removeClass('sidebar-home-settings-link-row--drag-over'));
				self.dragSrcIndex = -1;
			});

			// 分隔线
			if (i < this.plugin.settings.quickLinks.length - 1) {
				container.createEl('hr', { cls: 'sidebar-home-settings-divider' });
			}
		}
	}

	// ========== 路径自动补全 ==========

	private setupPathSuggestion(inputEl: HTMLInputElement, onSelect?: (value: string) => void) {
		const dropdown = document.body.createDiv({ cls: 'sidebar-home-suggest-dropdown' });

		const positionDropdown = () => {
			const rect = inputEl.getBoundingClientRect();
			dropdown.style.top = `${rect.bottom + 2}px`;
			dropdown.style.left = `${rect.left}px`;
			dropdown.style.width = `${rect.width}px`;
		};

		const getAllPaths = (): string[] => {
			const paths: string[] = [];
			const collect = (item: TAbstractFile) => {
				if (item instanceof TFile && item.extension === 'md') {
					paths.push(item.path.replace(/\.md$/, ''));
				} else if (item instanceof TFolder) {
					paths.push(item.path);
					item.children.forEach(collect);
				}
			};
			this.app.vault.getRoot().children.forEach(collect);
			return paths;
		};

		const updateSuggestions = () => {
			const query = inputEl.value.toLowerCase();
			const allPaths = getAllPaths();

			const matches = allPaths
				.filter(p => p.toLowerCase().includes(query))
				.slice(0, 20);

			dropdown.empty();

			if (matches.length === 0 || document.activeElement !== inputEl) {
				dropdown.style.display = 'none';
				return;
			}

			for (const match of matches) {
				const item = dropdown.createDiv({ cls: 'sidebar-home-suggest-item' });
				item.setText(match);
				item.addEventListener('mousedown', (e) => {
					e.preventDefault();
					inputEl.value = match;
					inputEl.dispatchEvent(new Event('input'));
					onSelect?.(match);
					dropdown.style.display = 'none';
				});
			}

			positionDropdown();
			dropdown.style.display = 'block';
		};

		inputEl.addEventListener('input', updateSuggestions);
		inputEl.addEventListener('focus', updateSuggestions);

		const handleClick = (e: MouseEvent) => {
			if (!inputEl.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
				dropdown.style.display = 'none';
			}
		};
		document.addEventListener('click', handleClick);
	}

	// ========== Tab 3: 格式化 ==========

	private renderFormatSettings(container: HTMLElement) {
		// 按分组渲染：执行方式 → 保护机制 → 各 Phase
		const formatSettings = this.plugin.settings.format as unknown as Record<string, string | boolean>;
		for (const section of FORMAT_SECTIONS) {
			container.createEl('h3', { text: section.title });
			if (section.desc) {
				const descCard = container.createDiv({ cls: 'setting-item' });
				descCard
					.createDiv({ cls: 'setting-item-info' })
					.createDiv({ cls: 'setting-item-description', text: section.desc });
			}

			for (const item of section.items) {
				const setting = new Setting(container).setName(item.label).setDesc(item.desc);

				if (item.kind === 'toggle') {
					setting.addToggle(toggle => toggle
						.setValue(formatSettings[item.key] as boolean)
						.onChange(async (value) => {
							formatSettings[item.key] = value;
							await this.plugin.saveSettings();
						}));
				} else {
					setting.addText(text => text
						.setPlaceholder(item.placeholder)
						.setValue(formatSettings[item.key] as string)
						.onChange(async (value) => {
							formatSettings[item.key] = value;
							await this.plugin.saveSettings();
						}));
				}
			}
		}
	}

	// ========== Tab 4: 语音朗读 ==========

	private DEFAULT_HIGHLIGHT_COLOR = '#FFFACD';

	private renderTtsSettings(container: HTMLElement) {
		container.createEl('h2', { text: '语音朗读' });

		// Edge-TTS 音色
		const edgeVoiceSetting = new Setting(container)
			.setName('Edge-TTS 音色')
			.setDesc('在线神经网络语音（高质量，需联网）；失败时自动改用本地音色')
			.addDropdown(dropdown => dropdown
				.addOption('zh-CN-XiaoxiaoNeural', '晓晓 (女声，活泼)')
				.addOption('zh-CN-YunxiNeural', '云希 (男声，沉稳)')
				.addOption('zh-CN-YunjianNeural', '云健 (男声，叙事)')
				.addOption('zh-CN-XiaoyiNeural', '晓伊 (女声，温柔)')
				.addOption('zh-CN-YunyangNeural', '云扬 (男声，新闻)')
				.addOption('zh-CN-XiaochenNeural', '晓辰 (女声，自然)')
				.addOption('zh-CN-XiaohanNeural', '晓涵 (女声，温柔)')
				.addOption('zh-CN-XiaomengNeural', '晓梦 (女声，活泼)')
				.addOption('zh-CN-XiaomoNeural', '晓墨 (女声，知性)')
				.addOption('zh-CN-XiaoqiuNeural', '晓秋 (女声，温柔)')
				.addOption('zh-CN-XiaoruiNeural', '晓睿 (女声，知性)')
				.addOption('zh-CN-XiaoshuangNeural', '晓双 (女声，可爱)')
				.addOption('zh-CN-XiaoxuanNeural', '晓萱 (女声，自信)')
				.addOption('zh-CN-XiaoyanNeural', '晓颜 (女声，温柔)')
				.addOption('zh-CN-XiaozhenNeural', '晓珍 (女声，温柔)')
				.setValue(this.plugin.settings.ttsEdgeVoice)
				.onChange(async (value) => {
					this.plugin.settings.ttsEdgeVoice = value;
					await this.plugin.saveSettings();
				}));
		edgeVoiceSetting.settingEl.addClass('sh-tts-voice-setting');

		// 本地音色
		let voiceDropdown: any;
		const refreshVoiceList = () => {
			const voices = window.speechSynthesis.getVoices();
			const zhVoices = voices.filter(v => v.lang.startsWith('zh'));
			voiceDropdown?.selectEl?.empty?.();
			if (zhVoices.length === 0) {
				voiceDropdown?.addOption?.('', '（无中文语音，使用系统默认）');
			} else {
				voiceDropdown?.addOption?.('', '系统默认');
				for (const v of zhVoices) {
					// 系统语音名通常形如 "Microsoft Yaoyao - Chinese (Simplified, PRC)"，只保留短名
					const shortName = v.name
						.replace(/^Microsoft\s+/i, '')
						.replace(/\s*-\s*Chinese.*$/i, '')
						.trim() || v.name;
					const label = `${shortName} (${v.lang}${v.localService ? '' : ' 在线'})`;
					voiceDropdown?.addOption?.(v.voiceURI, label);
				}
			}
			voiceDropdown?.setValue?.(this.plugin.settings.ttsVoice);
		};

		const voiceSetting = new Setting(container)
			.setName('本地音色')
			.setDesc('本地语音引擎的音色（需系统已安装对应语音包）')
			.addDropdown(dropdown => {
				voiceDropdown = dropdown;
				refreshVoiceList();
				dropdown.onChange(async (value) => {
					this.plugin.settings.ttsVoice = value;
					await this.plugin.saveSettings();
				});
			});
		voiceSetting.settingEl.addClass('sh-tts-voice-setting');

		// 语音列表是异步加载的，首次为空时等 voiceschanged 再填充
		if (window.speechSynthesis.getVoices().length === 0) {
			window.speechSynthesis.addEventListener('voiceschanged', refreshVoiceList, { once: true });
		}

		// 语速
		new Setting(container)
			.setName('语速')
			.setDesc('朗读速度倍率 (0.5 ~ 2.0)')
			.addSlider(slider => slider
				.setLimits(0.5, 2.0, 0.1)
				.setValue(this.plugin.settings.ttsSpeed)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.ttsSpeed = value;
					await this.plugin.saveSettings();
				}));

		// 高亮背景色
		let colorInput: HTMLInputElement;
		let colorPicker: ColorComponent | undefined;
		const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

		const colorSetting = new Setting(container)
			.setName('高亮背景色')
			.setDesc('朗读时当前句子的背景颜色 (hex)')
			.addColorPicker(picker => {
				colorPicker = picker;
				picker
					.setValue(isHexColor(this.plugin.settings.ttsHighlightColor)
						? this.plugin.settings.ttsHighlightColor
						: this.DEFAULT_HIGHLIGHT_COLOR)
					.onChange(async (value) => {
						this.plugin.settings.ttsHighlightColor = value;
						colorInput.value = value;
						this.updateHighlightStyle(value);
						await this.plugin.saveSettings();
					});
			})
			.addText(text => {
				colorInput = text.inputEl;
				text.setValue(this.plugin.settings.ttsHighlightColor)
					.onChange(async (value) => {
						this.plugin.settings.ttsHighlightColor = value;
						if (isHexColor(value)) colorPicker?.setValue(value);
						this.updateHighlightStyle(value);
						await this.plugin.saveSettings();
					});
			})
			.addExtraButton(btn => {
				btn.setIcon('reset')
					.setTooltip('恢复默认')
					.onClick(async () => {
						this.plugin.settings.ttsHighlightColor = this.DEFAULT_HIGHLIGHT_COLOR;
						colorInput.value = this.DEFAULT_HIGHLIGHT_COLOR;
						colorPicker?.setValue(this.DEFAULT_HIGHLIGHT_COLOR);
						this.updateHighlightStyle(this.DEFAULT_HIGHLIGHT_COLOR);
						await this.plugin.saveSettings();
						new Notice('高亮颜色已恢复默认');
					});
			});
		colorSetting.settingEl.addClass('sh-tts-color-setting');

		// 初始应用样式
		this.updateHighlightStyle(this.plugin.settings.ttsHighlightColor);

		// Edge-TTS 测试按钮
		new Setting(container)
			.setName('Edge-TTS 连接测试')
			.setDesc('发送一条短文本测试微软语音服务是否可用')
			.addButton(btn => btn
				.setButtonText('测试连接')
				.onClick(async () => {
					btn.setButtonText('测试中…');
					btn.setDisabled(true);
					try {
						const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${this.plugin.settings.ttsEdgeVoice}'><prosody rate='${this.plugin.settings.ttsSpeed}' pitch='+0Hz'>测试语音服务连接</prosody></voice></speak>`;
						await generateEdgeTts(ssml, {
							voice: this.plugin.settings.ttsEdgeVoice,
							rate: String(this.plugin.settings.ttsSpeed),
							pitch: '+0Hz',
						});
						new Notice('Edge-TTS 连接成功');
						btn.setButtonText('✓ 连接成功');
					} catch (e) {
						new Notice(`Edge-TTS 失败: ${e.message}`);
						btn.setButtonText('✗ 连接失败');
					}
					setTimeout(() => {
						btn.setButtonText('测试连接');
						btn.setDisabled(false);
					}, 2000);
				}));
	}

	private updateHighlightStyle(color: string) {
		highlightColor.value = color;
	}

	// ========== Tab 6: Excel 预览 ==========
	private renderExcelSettings(container: HTMLElement) {
		container.createEl('h2', { text: 'Excel 预览' });

		new Setting(container)
			.setName('启用 Excel 内嵌预览')
			.setDesc('用 ![[表格.xlsx]] 在笔记内只读预览表格')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.excelPreviewEnabled)
				.onChange(async (value) => {
					this.plugin.settings.excelPreviewEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('默认显示行数')
			.setDesc('超出部分不渲染，避免大表拖慢笔记；需要时在预览框内点「显示全部行列」')
			.addSlider(slider => slider
				.setLimits(10, 500, 10)
				.setValue(this.plugin.settings.excelPreviewMaxRows)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.excelPreviewMaxRows = value;
					await this.plugin.saveSettings();
					refreshMountedPreviews();
				}));

		new Setting(container)
			.setName('默认显示列数')
			.setDesc('超出部分不渲染')
			.addSlider(slider => slider
				.setLimits(5, 50, 1)
				.setValue(this.plugin.settings.excelPreviewMaxCols)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.excelPreviewMaxCols = value;
					await this.plugin.saveSettings();
					refreshMountedPreviews();
				}));

		new Setting(container)
			.setName('预览框高度')
			.setDesc('表格区域的最大高度（像素），超出部分在框内滚动')
			.addSlider(slider => slider
				.setLimits(200, 1000, 50)
				.setValue(this.plugin.settings.excelPreviewHeight)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.excelPreviewHeight = value;
					await this.plugin.saveSettings();
					refreshMountedPreviews();
				}));
	}

	// ========== Tab 7: 导出 ==========

	private renderExportSettings(container: HTMLElement) {
		container.createEl('h2', { text: '导出' });
		container.createEl('p', {
			text: '把当前文档导出到库外文件夹：正文存为 .md，引用的图片与其他文件统一放进资源子文件夹，链接改写为标准 Markdown 相对路径。',
		});

		new Setting(container)
			.setName('导出目标文件夹')
			.setDesc('库外绝对路径。留空则每次导出时弹出系统文件夹选择框。每篇文档会在其中建一个同名子文件夹')
			.addText(text => text
				.setPlaceholder('例如 D:\\导出')
				.setValue(this.plugin.settings.exportTargetFolder)
				.onChange(async (value) => {
					this.plugin.settings.exportTargetFolder = value.trim();
					await this.plugin.saveSettings();
				}))
			.addButton(btn => btn
				.setButtonText('选择')
				.onClick(async () => {
					const picked = await pickFolder(this.plugin.settings.exportTargetFolder);
					if (!picked) {
						new Notice('未能获取文件夹路径，请手动填写');
						return;
					}
					this.plugin.settings.exportTargetFolder = picked;
					await this.plugin.saveSettings();
					this.display();
				}))
			.addButton(btn => btn
				.setButtonText('打开')
				.onClick(() => {
					const target = this.plugin.settings.exportTargetFolder.trim();
					if (!target) {
						new Notice('尚未设置导出目标文件夹');
						return;
					}
					openInSystemExplorer(target);
				}));

		new Setting(container)
			.setName('资源文件夹名')
			.setDesc('导出包内存放图片与被引用文档的子文件夹名')
			.addText(text => text
				.setPlaceholder('assets')
				.setValue(this.plugin.settings.exportAssetsFolder)
				.onChange(async (value) => {
					this.plugin.settings.exportAssetsFolder = value.trim() || 'assets';
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('导出当前文档')
			.setDesc('等同于命令面板中的「导出文档（Markdown + 资源）」')
			.addButton(btn => btn
				.setButtonText('立即导出')
				.onClick(async () => {
					const file = this.app.workspace.getActiveFile();
					if (!file) {
						new Notice('没有打开的文档');
						return;
					}
					await exportMarkdownFile(this.plugin, file);
				}));
	}
}
