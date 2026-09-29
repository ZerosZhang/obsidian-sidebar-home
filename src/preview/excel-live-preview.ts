/**
 * 实时预览（编辑模式）的 Excel 内嵌渲染
 *
 * 官方文档 Plugins/Editor/Editor extensions.md 明确：要改变实时预览的外观
 * 必须写编辑器扩展，Markdown 后处理器只覆盖阅读视图。这里不再自己下
 * replace decoration 去抢 Obsidian 的渲染范围，而是等 Obsidian 把嵌入渲染成
 * widget 之后，往它的容器里追加预览 —— 这样既不会与原生渲染冲突，也天然
 * 继承了「光标落在这一行时显示原文」的行为。
 */

import { StateField } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type SidebarHomePlugin from '../main';
import { excelConfig } from './excel-config';
import { mountEmbedPreview, unmountPreviews } from './excel-embed';

/** 编辑器 DOM 变动非常频繁，扫描需要节流 */
const SCAN_DELAY = 150;

export function createExcelLivePreviewExtension(plugin: SidebarHomePlugin) {
	return ViewPlugin.fromClass(
		class {
			private view: EditorView;
			private observer: MutationObserver;
			private timer: number | null = null;

			constructor(view: EditorView) {
				this.view = view;
				this.observer = new MutationObserver((records) => {
					// 忽略由我们自己的渲染引起的变动，避免自触发循环
					const relevant = records.some(
						(record) =>
							!(record.target instanceof HTMLElement) ||
							record.target.closest('.sh-excel-preview') === null,
					);
					if (relevant) this.schedule();
				});
				this.observer.observe(view.dom, { childList: true, subtree: true });
				this.schedule();
			}

			update(_update: ViewUpdate): void {
				this.schedule();
			}

			destroy(): void {
				this.observer.disconnect();
				if (this.timer !== null) {
					window.clearTimeout(this.timer);
					this.timer = null;
				}
			}

			private schedule(): void {
				if (this.timer !== null) return;
				this.timer = window.setTimeout(() => {
					this.timer = null;
					this.scan();
				}, SCAN_DELAY);
			}

			private scan(): void {
				if (!excelConfig.excelPreviewEnabled) {
					unmountPreviews(this.view.dom);
					return;
				}

				const info = this.view.state.field(
					editorInfoField as StateField<{ file?: { path: string } | null }>,
					false,
				);
				const sourcePath = info?.file?.path ?? '';

				this.view.dom
					.querySelectorAll<HTMLElement>('.internal-embed')
					.forEach((embedEl) => {
						mountEmbedPreview(plugin, embedEl, sourcePath, { nested: true });
					});
			}
		},
	);
}
