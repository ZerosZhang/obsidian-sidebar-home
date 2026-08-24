/**
 * TTS 朗读高亮：用 CM6 Decoration 实现，不影响编辑器选区
 * 在编辑模式和阅读模式下均生效
 */
import {
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	EditorView,
} from '@codemirror/view';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';

/** 高亮颜色，由 main.ts 在设置变更时写入 */
export const highlightColor = { value: '#FFFACD' };

/** 当前高亮范围 effect */
export const setHighlightEffect = StateEffect.define<{ from: number; to: number } | null>();

/** 存储当前高亮范围的 StateField */
const highlightField = StateField.define<{ from: number; to: number } | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(setHighlightEffect)) return e.value;
		}
		return value;
	},
});

function buildDecorations(view: EditorView): DecorationSet {
	const range = view.state.field(highlightField);
	if (!range) return Decoration.none;

	const builder = new RangeSetBuilder<Decoration>();
	builder.add(
		Math.max(0, range.from),
		Math.min(view.state.doc.length, range.to),
		Decoration.mark({
			attributes: {
				style: `background-color: ${highlightColor.value}; border-radius: 2px;`,
			},
		}),
	);
	return builder.finish();
}

const ttsHighlightPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.transactions.some(t => t.effects.some(e => e.is(setHighlightEffect)))) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: v => v.decorations },
);

/** 在外部调用：设置高亮范围（编辑器内绝对偏移） */
export function highlightRange(view: EditorView | null, from: number, to: number) {
	if (!view) return;
	view.dispatch({
		effects: setHighlightEffect.of({ from, to }),
	});
}

/** 在外部调用：清除高亮 */
export function clearHighlight(view: EditorView | null) {
	if (!view) return;
	view.dispatch({
		effects: setHighlightEffect.of(null),
	});
}

/** 创建 CM6 扩展，由 main.ts 注册 */
export function createTtsHighlightExtension() {
	return [highlightField, ttsHighlightPlugin];
}
