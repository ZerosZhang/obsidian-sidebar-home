/**
 * 空格可视化模块
 *
 * 将空格以半透明 · 标记展现，帮助辨识空白位置。
 * 仅处理视口内可见行，性能开销极低。
 *
 * 导出：
 *   - `spaceConfig` — 模块级可变配置，由 main.ts 在设置变更时写入。
 *   - `createWhitespaceExtension()` — 工厂函数，返回 CM6 ViewPlugin。
 */

import {
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	EditorView,
	WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { SidebarHomeSettings } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';

export const spaceConfig: SidebarHomeSettings = { ...DEFAULT_SETTINGS };

class SpaceWidget extends WidgetType {
	toDOM(view: EditorView): HTMLElement {
		const doc = view.dom.ownerDocument;
		const span = doc.createElement('span');
		span.className = 'sh-space-char';
		span.textContent = '·';
		return span;
	}

	eq(other: SpaceWidget): boolean {
		return other instanceof SpaceWidget;
	}
}

function buildDecorations(view: EditorView): DecorationSet {
	if (!spaceConfig.showWhitespace) {
		return Decoration.none;
	}

	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;

	for (const { from, to } of view.visibleRanges) {
		if (from >= to) continue;

		const startLine = doc.lineAt(from);
		const endLine = doc.lineAt(to);

		for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
			const line = doc.line(lineNum);
			const lineFrom = Math.max(line.from, from);
			const lineTo = Math.min(line.to, to);
			if (lineFrom >= lineTo) continue;

			for (let i = lineFrom - line.from; i < lineTo - line.from; i++) {
				if (line.text[i] !== ' ') continue;
				const pos = line.from + i;
				builder.add(
					pos,
					pos + 1,
					Decoration.replace({ widget: new SpaceWidget() }),
				);
			}
		}
	}

	return builder.finish();
}

const spaceViewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate) {
			this.decorations = buildDecorations(update.view);
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);

export function createWhitespaceExtension() {
	return spaceViewPlugin;
}
