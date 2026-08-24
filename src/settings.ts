export interface QuickLink {
	id: string;
	emoji: string;
	name: string;
	targetPath: string;
}

export type QuickLinkStyle = 'horizontal' | 'square';

export interface MenuItemConfig {
	id: string;
	title: string;
	hidden: boolean;
}

export type MenuAreaKey = 'file-explorer' | 'editor' | 'tab-header';

export interface MenuAreaConfig {
	enabled: boolean;
	items: MenuItemConfig[];
}

export interface MenuSettings {
	'file-explorer': MenuAreaConfig;
	'editor': MenuAreaConfig;
	'tab-header': MenuAreaConfig;
}

export interface FormatSettings {
	// 保护机制
	protectSpanText: boolean;
	// 标记转换
	boldToStrong: boolean;
	strikethroughToDel: boolean;
	markdownLinkToWiki: boolean;
	smartQuotes: boolean;
	removeUnclosedTags: boolean;
	// 标题处理
	headerIncrement: boolean;
	headingsStartLine: boolean;
	// 中英文空格
	cjkSpacing: boolean;
	// 代码块
	codeFenceLanguage: boolean;
	codeFenceDefaultLanguage: string;
	// 列表
	spaceAfterListMarkers: boolean;
	unorderedListStyle: boolean;
	removeEmptyLinesBetweenListMarkers: boolean;
	// 引用块
	blockquoteStyle: boolean;
	// 多余空格
	removeMultipleSpaces: boolean;
	removeSpaceAroundFullWidthChars: boolean;
	removeLinkSpacing: boolean;
	removeLeadingSpaces: boolean;
	// 空行管理
	addBlankLineAfterYaml: boolean;
	compactYaml: boolean;
	headingBlankLines: boolean;
	paragraphBlankLines: boolean;
	emptyLineAroundTables: boolean;
	consecutiveBlankLines: boolean;
	// 行尾
	trailingSpaces: boolean;
	lineBreakAtDocumentEnd: boolean;
	// YAML 时间戳
	yamlTimestamp: boolean;
	yamlDateFormat: string;
	yamlDateCreatedKey: string;
	yamlDateModifiedKey: string;
	// 跳过标记
	yamlSkipTag: string;
	// 保存时格式化
	formatOnSave: boolean;
}

export interface SidebarHomeSettings {
	cacheFolder: string;
	diaryFolder: string;
	quickLinks: QuickLink[];
	quickLinkStyle: QuickLinkStyle;
	clipPage: string;
	todoPage: string;
	unfinishPage: string;
	reuseExistingTab: boolean;
	doubleClickCloseTab: boolean;
	closeTabGoToPrev: boolean;
	menuSettings: MenuSettings;
	// 隐藏样式
	hideBoldFormatting: boolean;
	hideItalicFormatting: boolean;
	hideHighlightFormatting: boolean;
	hideStrikethroughFormatting: boolean;
	hideCodeFormatting: boolean;
	hideEscapeFormatting: boolean;
	hideHeadingFormatting: boolean;
	hideHtmlFormatting: boolean;
	hideHtmlTags: string;
	showWhitespace: boolean;
	// 语音朗读
	ttsVoice: string;
	ttsEdgeVoice: string;
	ttsSpeed: number;
	ttsHighlightColor: string;
	// 格式化
	format: FormatSettings;
}

export const DEFAULT_SETTINGS: SidebarHomeSettings = {
	cacheFolder: '缓存',
	diaryFolder: '日记',
	quickLinks: [],
	quickLinkStyle: 'horizontal',
	clipPage: '剪藏',
	todoPage: '待办',
	unfinishPage: '未完成',
	reuseExistingTab: true,
	doubleClickCloseTab: true,
	closeTabGoToPrev: true,
	menuSettings: {
		'file-explorer': { enabled: false, items: [] },
		'editor': { enabled: false, items: [] },
		'tab-header': { enabled: false, items: [] },
	},
	hideBoldFormatting: true,
	hideItalicFormatting: true,
	hideHighlightFormatting: true,
	hideStrikethroughFormatting: true,
	hideCodeFormatting: true,
	hideEscapeFormatting: true,
	hideHeadingFormatting: true,
	hideHtmlFormatting: true,
	hideHtmlTags: 'strong,del,font,mark',
	showWhitespace: false,
	// 语音朗读
	ttsVoice: '',
	ttsEdgeVoice: 'zh-CN-XiaoxiaoNeural',
	ttsSpeed: 1.0,
	ttsHighlightColor: '#FFFACD',
	// 格式化
	format: {
		protectSpanText: true,
		boldToStrong: true,
		strikethroughToDel: true,
		markdownLinkToWiki: false,
		smartQuotes: false,
		removeUnclosedTags: false,
		headerIncrement: true,
		headingsStartLine: true,
		cjkSpacing: true,
		codeFenceLanguage: false,
		codeFenceDefaultLanguage: '',
		spaceAfterListMarkers: true,
		unorderedListStyle: true,
		removeEmptyLinesBetweenListMarkers: true,
		blockquoteStyle: true,
		removeMultipleSpaces: true,
		removeSpaceAroundFullWidthChars: true,
		removeLinkSpacing: true,
		removeLeadingSpaces: true,
		addBlankLineAfterYaml: true,
		compactYaml: true,
		headingBlankLines: true,
		paragraphBlankLines: true,
		emptyLineAroundTables: true,
		consecutiveBlankLines: true,
		trailingSpaces: true,
		lineBreakAtDocumentEnd: true,
		yamlTimestamp: true,
		yamlDateFormat: 'YYYY年MM月DD日 HH:mm:ss',
		yamlDateCreatedKey: '创建日期',
		yamlDateModifiedKey: '修改日期',
		yamlSkipTag: '',
		formatOnSave: false,
	},
};
