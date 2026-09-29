/**
 * Excel 预览的 DOM 渲染层
 *
 * 阅读模式与实时预览两条路径共用这里的 `renderSpreadsheetPreview`，
 * 差别只在「往哪个容器里挂」由各自负责。
 *
 * 只负责「追加」：调用方传进来的 host 由调用方创建，本模块不触碰
 * Obsidian 原生渲染出的任何节点，原生点击打开行为因此不受影响。
 */

import { App, Notice, TFile } from 'obsidian';
import { excelConfig } from './excel-config';
import { currentLimit, openWorkbook, SheetModel, WorkbookModel } from './excel-parser';

/** 单元格文本超过该长度时截断显示，完整内容放进 title */
const CELL_TRUNCATE = 24;

/** 「适应宽度」的缩放下限：再小就看不清了，此时宁可保留横向滚动 */
const MIN_FIT_ZOOM = 0.4;

/**
 * 缩放余量。
 * `offsetWidth` / `clientWidth` 返回的是取整后的整数，按它们算出的比例会略微偏大，
 * 渲染后溢出零点几像素就会画出横向滚动条，所以留出 1px 余量。
 */
const FIT_EPSILON = 1;

/** 估算值没算进边框、外边距和取整，按实测溢出量再收几轮 */
const FIT_CORRECTIONS = 3;

/**
 * TS 4.7 的 `CSSStyleDeclaration` 里没有 `zoom` 成员，只能用 setProperty 设置；
 * 传 null 表示恢复原始大小。
 */
function setZoom(el: HTMLElement, scale: number | null): void {
	if (scale === null) {
		el.style.removeProperty('zoom');
	} else {
		el.style.setProperty('zoom', String(scale));
	}
}

/**
 * 计算「适应宽度」的缩放值：把表格宽度收进容器可用宽度。
 * 返回 null 表示本来就装得下，无需缩放（也不做放大）。
 */
export function computeFitZoom(available: number, natural: number): number | null {
	if (available <= 0 || natural <= 0 || natural <= available) return null;
	return Math.max(MIN_FIT_ZOOM, (available - FIT_EPSILON) / natural);
}

export async function renderSpreadsheetPreview(
	host: HTMLElement,
	app: App,
	file: TFile,
	preferredSheet: string | null,
): Promise<void> {
	host.empty();
	host.addClass('sh-excel-preview');

	const notice = host.createDiv({ cls: 'sh-excel-notice', text: '正在读取表格…' });

	let model: WorkbookModel;
	try {
		model = await openWorkbook(app, file);
	} catch (err) {
		notice.setText(err instanceof Error ? err.message : '表格读取失败');
		notice.addClass('sh-excel-notice--error');
		return;
	}

	notice.remove();
	paintSpreadsheet(host, model, preferredSheet);
	// 渲染发生在异步之后，宿主的滚动位置需要重置
	host.scrollTop = 0;
}

function paintSpreadsheet(
	host: HTMLElement,
	model: WorkbookModel,
	preferredSheet: string | null,
): void {
	const state = {
		sheet:
			preferredSheet && model.sheetNames.includes(preferredSheet)
				? preferredSheet
				: model.defaultSheet,
		full: false,
		/** 是否处于「适应宽度」：仅当前预览有效，重开笔记回到原始大小 */
		fit: false,
		/** 未缩放时量得的表格宽度，供换 sheet / 窗口缩放后重算 */
		naturalWidth: 0,
	};

	let tabsEl: HTMLElement | null = null;
	if (model.sheetNames.length > 1) {
		tabsEl = host.createDiv({ cls: 'sh-excel-tabs' });
		for (const name of model.sheetNames) {
			const tab = tabsEl.createEl('button', {
				cls: 'sh-excel-tab',
				text: name,
				type: 'button',
			});
			if (model.hiddenSheets.includes(name)) {
				tab.addClass('sh-excel-tab--hidden-sheet');
			}
			tab.addEventListener('click', () => {
				if (state.sheet === name) return;
				state.sheet = name;
				state.full = false;
				paint();
			});
		}
	}

	const scrollEl = host.createDiv({ cls: 'sh-excel-scroll' });
	scrollEl.style.maxHeight = `${Math.max(80, excelConfig.excelPreviewHeight || 400)}px`;

	const footerEl = host.createDiv({ cls: 'sh-excel-footer' });
	const countEl = footerEl.createSpan({ cls: 'sh-excel-count' });
	const actionsEl = footerEl.createDiv({ cls: 'sh-excel-actions' });
	const fitBtn = actionsEl.createEl('button', {
		cls: 'sh-excel-fit',
		text: '适应宽度',
		type: 'button',
	});
	const expandBtn = actionsEl.createEl('button', {
		cls: 'sh-excel-expand',
		text: '显示全部行列',
		type: 'button',
	});

	let tableEl: HTMLTableElement | null = null;

	/**
	 * 把表格缩到容器宽度内。
	 *
	 * 用 CSS `zoom` 而不是 `transform: scale()`：zoom 参与布局重排，
	 * 滚动区域和容器高度会自动跟着变；transform 只是视觉缩放，
	 * 元素布局尺寸不变，滚动条长度会对不上、右侧留一大片空白。
	 */
	const applyZoom = () => {
		if (!tableEl) return;
		if (!state.fit) {
			setZoom(tableEl, null);
			return;
		}

		let scale = computeFitZoom(scrollEl.clientWidth, state.naturalWidth);
		setZoom(tableEl, scale);
		if (scale === null) return;

		// 估算里没有边框、外边距和取整，这里按实测溢出量再收几轮。
		// 每一轮都瞄准「可用宽度 - 1px」，这样对恒定偏移也能快速收敛到区间内，
		// 而不是无限逼近边界。纵向滚动条不受影响，该出还是出。
		for (let i = 0; i < FIT_CORRECTIONS; i++) {
			const available = scrollEl.clientWidth;
			const rendered = scrollEl.scrollWidth;
			if (available <= 0 || rendered <= available - FIT_EPSILON) break;
			const next = Math.max(
				MIN_FIT_ZOOM,
				(scale * (available - FIT_EPSILON)) / rendered,
			);
			if (!(next < scale)) break;
			scale = next;
			setZoom(tableEl, scale);
		}
	};

	fitBtn.addEventListener('click', () => {
		state.fit = !state.fit;
		fitBtn.setText(state.fit ? '原始大小' : '适应宽度');
		fitBtn.toggleClass('is-active', state.fit);
		applyZoom();
	});

	// 侧边栏拖动、窗口缩放都会改变可用宽度
	const resizeObserver = new ResizeObserver(() => {
		if (!scrollEl.isConnected) {
			resizeObserver.disconnect();
			return;
		}
		applyZoom();
	});
	resizeObserver.observe(scrollEl);

	expandBtn.addEventListener('click', () => {
		const limit = currentLimit();
		const sheet = model.readSheet(state.sheet, null);
		if (!sheet) return;
		if (sheet.totalRows * sheet.totalCols > limit.rows * limit.cols * 20) {
			new Notice('表格较大，全部渲染可能造成卡顿');
		}
		state.full = true;
		paint();
	});

	function paint(): void {
		const limit = currentLimit();
		const sheet = model.readSheet(state.sheet, state.full ? null : limit);

		scrollEl.empty();
		countEl.setText('');
		tableEl = null;
		expandBtn.addClass('sh-excel-expand--hidden');

		if (!sheet) {
			scrollEl.createDiv({ cls: 'sh-excel-notice', text: '未找到该工作表' });
		} else if (sheet.totalRows === 0) {
			scrollEl.createDiv({ cls: 'sh-excel-notice', text: '（空工作表）' });
		} else {
			const table = buildTable(sheet, scrollEl.ownerDocument);
			scrollEl.appendChild(table);
			tableEl = table;
			// 必须在未缩放的状态下量取宽度，否则量到的是缩放后的值
			setZoom(table, null);
			state.naturalWidth = table.offsetWidth;
			applyZoom();

			const truncated =
				!state.full &&
				(sheet.totalRows > limit.rows || sheet.totalCols > limit.cols);
			countEl.setText(
				truncated
					? `共 ${sheet.totalRows} 行 × ${sheet.totalCols} 列，` +
							`当前显示 ${sheet.rows.length} 行 × ${sheet.rows[0]?.length ?? 0} 列`
					: `共 ${sheet.totalRows} 行 × ${sheet.totalCols} 列`,
			);
			if (truncated) expandBtn.removeClass('sh-excel-expand--hidden');
		}

		if (tabsEl) {
			tabsEl.querySelectorAll<HTMLElement>('.sh-excel-tab').forEach((tab) => {
				tab.toggleClass('is-active', tab.textContent === state.sheet);
			});
		}
	}

	paint();
}

function buildTable(sheet: SheetModel, doc: Document): HTMLTableElement {
	const table = doc.createElement('table');
	table.className = 'sh-excel-table';

	// 合并区域：锚点记录跨度，其余格子在渲染时跳过
	const anchorSpans = new Map<string, { rows: number; cols: number }>();
	const covered = new Set<string>();
	for (const m of sheet.merges) {
		anchorSpans.set(`${m.s.r}:${m.s.c}`, {
			rows: m.e.r - m.s.r + 1,
			cols: m.e.c - m.s.c + 1,
		});
		for (let r = m.s.r; r <= m.e.r; r++) {
			for (let c = m.s.c; c <= m.e.c; c++) {
				if (r === m.s.r && c === m.s.c) continue;
				covered.add(`${r}:${c}`);
			}
		}
	}

	const buildRow = (
		rowIndex: number,
		cells: string[],
		tag: 'th' | 'td',
	): HTMLTableRowElement => {
		const tr = doc.createElement('tr');
		for (let c = 0; c < cells.length; c++) {
			if (covered.has(`${rowIndex}:${c}`)) continue;
			const cell = doc.createElement(tag);
			const span = anchorSpans.get(`${rowIndex}:${c}`);
			if (span) {
				if (span.rows > 1) cell.rowSpan = span.rows;
				if (span.cols > 1) cell.colSpan = span.cols;
			}
			const text = cells[c] ?? '';
			cell.textContent = text;
			if (text.length > CELL_TRUNCATE) cell.title = text;
			tr.appendChild(cell);
		}
		return tr;
	};

	const hasHeader = sheet.hasHeader && sheet.rows.length > 0;
	if (hasHeader) {
		table.createTHead().appendChild(buildRow(0, sheet.rows[0], 'th'));
	}

	const body = table.createTBody();
	for (let r = hasHeader ? 1 : 0; r < sheet.rows.length; r++) {
		body.appendChild(buildRow(r, sheet.rows[r], 'td'));
	}

	return table;
}
