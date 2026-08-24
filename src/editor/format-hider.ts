/**
 * 隐藏样式模块
 *
 * 在 Obsidian 实时预览模式下，通过 CodeMirror 6 装饰隐藏 Markdown
 * 格式化标记符号（**、*、==、~~、`）、转义符号（\）、标题符号（#）、
 * 以及 HTML 标签（<strong>、<del>、<font>、<mark> 等可配置列表）。
 *
 * 导出：
 *   - `formattingConfig` — 模块级可变配置，由 main.ts 在设置变更时写入。
 *   - `createFormatHiderExtension()` — 工厂函数，返回 Prec.high CM6 扩展。
 */

import {
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	EditorView,
} from '@codemirror/view';
import { Prec, RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SidebarHomeSettings } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';

/** 模块级可变配置对象 */
export const formattingConfig: SidebarHomeSettings = { ...DEFAULT_SETTINGS };

/** HTML 标签对应的文本样式映射 */
const TAG_CLASS_MAP: Record<string, string> = {
	'strong': 'sh-tag-bold',
	'b': 'sh-tag-bold',
	'del': 'sh-tag-strikethrough',
	's': 'sh-tag-strikethrough',
	'strike': 'sh-tag-strikethrough',
	'em': 'sh-tag-italic',
	'i': 'sh-tag-italic',
	'mark': 'sh-tag-highlight',
	'u': 'sh-tag-underline',
};

/** 从 hideHtmlTags 字段解析标签名列表，构建正则（缓存） */
let htmlTagRegex: RegExp | null = null;
let cachedHtmlTagsStr = '';

function getHtmlTagRegex(): RegExp {
	const tagsStr = formattingConfig.hideHtmlTags;
	if (tagsStr !== cachedHtmlTagsStr) {
		cachedHtmlTagsStr = tagsStr;
		const tags = tagsStr
			.split(',')
			.map(t => t.trim().toLowerCase())
			.filter(t => t.length > 0);
		if (tags.length > 0) {
			htmlTagRegex = new RegExp(`^<\\/?(${tags.join('|')})\\b`, 'i');
		} else {
			htmlTagRegex = null;
		}
	}
	return htmlTagRegex!;
}

function buildDecorations(view: EditorView): DecorationSet {
	// 仅实时预览模式生效
	const cmContainer = view.dom.closest('.markdown-source-view');
	if (!cmContainer || !cmContainer.classList.contains('is-live-preview')) {
		return Decoration.none;
	}

	// 收集所有装饰，按位置排序后统一添加
	const decoItems: Array<{ from: number; to: number; deco: Decoration }> = [];

	// ── HTML 标签：内容始终加样式，标签隐藏可选 ──
	const htmlTags = formattingConfig.hideHtmlTags
		.split(',')
		.map(t => t.trim())
		.filter(t => t.length > 0);
	if (htmlTags.length > 0) {
		const tagPattern = htmlTags.join('|');
		const scanRegex = new RegExp(`<\\/?(${tagPattern})\\b[^>]*>`, 'gi');
		const fullText = view.state.doc.sliceString(0, view.state.doc.length);

		const tagMatches: Array<{ index: number; length: number; tag: string; isClose: boolean }> = [];
		let match: RegExpExecArray | null;
		while ((match = scanRegex.exec(fullText)) !== null) {
			tagMatches.push({
				index: match.index,
				length: match[0].length,
				tag: match[1].toLowerCase(),
				isClose: match[0].startsWith('</'),
			});
		}

		const stack: Array<{ tag: string; openIndex: number; openLength: number }> = [];
		for (const tm of tagMatches) {
			if (!tm.isClose) {
				stack.push({ tag: tm.tag, openIndex: tm.index, openLength: tm.length });
			} else {
				let found = false;
				for (let i = stack.length - 1; i >= 0; i--) {
					if (stack[i].tag === tm.tag) {
						const open = stack[i];
						stack.splice(i, 1);
						found = true;
						// 标签隐藏（仅 hideHtmlFormatting 开启时）
						if (formattingConfig.hideHtmlFormatting) {
							decoItems.push({ from: open.openIndex, to: open.openIndex + open.openLength, deco: Decoration.replace({ markerType: 'open' }) });
							decoItems.push({ from: tm.index, to: tm.index + tm.length, deco: Decoration.replace({ markerType: 'close' }) });
						}
						// 内容加样式（始终生效）
						const contentFrom = open.openIndex + open.openLength;
						const contentTo = tm.index;
						if (contentFrom < contentTo && TAG_CLASS_MAP[open.tag]) {
							decoItems.push({ from: contentFrom, to: contentTo, deco: Decoration.mark({ class: TAG_CLASS_MAP[open.tag] }) });
						}
						break;
					}
				}
				if (!found && formattingConfig.hideHtmlFormatting) {
					decoItems.push({ from: tm.index, to: tm.index + tm.length, deco: Decoration.replace({}) });
				}
			}
		}
		if (formattingConfig.hideHtmlFormatting) {
			for (const orphan of stack) {
				decoItems.push({ from: orphan.openIndex, to: orphan.openIndex + orphan.openLength, deco: Decoration.replace({}) });
			}
		}
	}

	// ── Markdown 格式符号：通过语法树节点类型匹配 ──
	const tree = syntaxTree(view.state);
	tree.iterate({
		enter(node: { type: { name: string }; from: number; to: number }) {
			const typeName = node.type.name;
			let markerLen = 0;

			if (formattingConfig.hideBoldFormatting && typeName.includes('formatting-strong')) {
				markerLen = 2;
			} else if (formattingConfig.hideItalicFormatting && typeName.includes('formatting-em') && !typeName.includes('formatting-embed')) {
				markerLen = 1;
			} else if (formattingConfig.hideHighlightFormatting && typeName.includes('formatting-highlight')) {
				markerLen = 2;
			} else if (formattingConfig.hideStrikethroughFormatting && typeName.includes('formatting-strikethrough')) {
				markerLen = 2;
			} else if (
				formattingConfig.hideCodeFormatting &&
				typeName.includes('formatting-code') &&
				typeName.includes('inline-code')
			) {
				const text = view.state.doc.sliceString(node.from, node.to);
				const match = text.match(/^`+/);
				markerLen = match ? match[0].length : 1;
			} else if (
				formattingConfig.hideEscapeFormatting &&
				(typeName === 'Escape' || typeName === 'escape' || typeName.includes('formatting-escape'))
			) {
				markerLen = 1;
			} else if (
				formattingConfig.hideHeadingFormatting &&
				(typeName.includes('formatting-header') || typeName.includes('formatting-heading') || typeName.includes('HeadingMark') || typeName.includes('HeaderMark'))
			) {
				const text = view.state.doc.sliceString(node.from, node.to);
				const headingMatch = text.match(/^(#+)\s?$/);
				if (headingMatch) {
					const spaceInside = text.endsWith(' ');
					const spaceAfter = !spaceInside && view.state.doc.sliceString(node.to, node.to + 1) === ' ';
					if (spaceInside || spaceAfter) {
						markerLen = headingMatch[1]!.length + 1;
					}
				}
			}

			if (markerLen > 0) {
				const isEscape = typeName === 'Escape' || typeName === 'escape' || typeName.includes('formatting-escape');
				const isHeading = typeName.includes('formatting-header') || typeName.includes('formatting-heading') || typeName.includes('HeadingMark') || typeName.includes('HeaderMark');

				decoItems.push({
					from: node.from,
					to: node.from + markerLen,
					deco: Decoration.replace({ markerType: 'open' }),
				});
				if (!isEscape && !isHeading) {
					decoItems.push({
						from: node.to - markerLen,
						to: node.to,
						deco: Decoration.replace({ markerType: 'close' }),
					});
				}
			}
		},
	});

	// 按位置排序后添加到 builder
	decoItems.sort((a, b) => a.from - b.from || a.to - b.to);
	const builder = new RangeSetBuilder<Decoration>();
	for (const item of decoItems) {
		builder.add(item.from, item.to, item.deco);
	}
	return builder.finish();
}

export function createFormatHiderExtension() {
	return Prec.high(
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = buildDecorations(view);
				}

				update(update: ViewUpdate) {
					this.decorations = buildDecorations(update.view);
					this.correctCursorAfterClick(update);
				}

				private correctCursorAfterClick(update: ViewUpdate) {
					for (const tr of update.transactions) {
						if (!tr.isUserEvent('select.pointer')) continue;

						const sel = tr.state.selection.main;
						if (sel.anchor !== sel.head) continue;

						const pos = sel.head;
						const adjusted = this.adjustCursor(pos);
						if (adjusted === pos) continue;

						const view = update.view;
						queueMicrotask(() => {
							const curPos = view.state.selection.main.head;
							const curAdjusted = this.adjustCursor(curPos);
							if (curAdjusted === curPos) return;

							view.dispatch({
								selection: { anchor: curAdjusted, head: curAdjusted },
								scrollIntoView: false,
							});
						});
					}
				}

				private adjustCursor(pos: number): number {
					let adjusted = pos;

					this.decorations.between(pos - 1, pos, (from, to, value) => {
						const spec = value.spec as Record<string, unknown>;
						if (to === pos && spec.markerType === 'open') {
							adjusted = from;
							return false;
						}
						return;
					});

					if (adjusted !== pos) return adjusted;

					this.decorations.between(pos, pos + 1, (from, to, value) => {
						const spec = value.spec as Record<string, unknown>;
						if (from === pos && spec.markerType === 'close') {
							adjusted = to;
							return false;
						}
						return;
					});

					return adjusted;
				}
			},
			{
				decorations: (v) => v.decorations,
			},
		),
	);
}
