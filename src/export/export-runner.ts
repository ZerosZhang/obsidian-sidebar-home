/**
 * 导出编排
 *
 * 读正文 → 解析引用 → 规划输出名 → 落盘 → 重写链接。
 * 只处理当前文档直接引用的文件，不递归展开被引用的文档。
 */

import { App, Notice, TFile } from 'obsidian';
import { promises as fsp } from 'fs';
import { join } from 'path';
import type SidebarHomePlugin from '../main';
import {
	DEFAULT_ASSETS_FOLDER,
	exportConfig,
	getBasename,
	getExtension,
} from './export-config';
import { LinkMatch, scanLinks } from './link-scanner';
import { assignUniqueNames, sanitizeName } from './export-planner';
import { RewriteEntry, rewriteLinks } from './link-rewriter';
import { pickFolder } from './folder-picker';
import { ConflictChoice, ExportConflictModal } from './conflict-modal';

async function pathExists(target: string): Promise<boolean> {
	try {
		await fsp.access(target);
		return true;
	} catch (e) {
		return false;
	}
}

function resolveTarget(app: App, match: LinkMatch, sourcePath: string): TFile | null {
	if (!match.target) return null;

	const direct = app.metadataCache.getFirstLinkpathDest(match.target, sourcePath);
	if (direct instanceof TFile) return direct;

	// Excalidraw 的链接写作 `![[图.excalidraw]]`，实际文件是 `图.excalidraw.md`
	if (getExtension(match.target) !== 'md') {
		const withMd = app.metadataCache.getFirstLinkpathDest(match.target + '.md', sourcePath);
		if (withMd instanceof TFile) return withMd;
	}
	return null;
}

async function resolveExportRoot(): Promise<string | null> {
	const configured = (exportConfig.exportTargetFolder || '').trim();
	if (configured) {
		try {
			await fsp.mkdir(configured, { recursive: true });
			return configured;
		} catch (e) {
			new Notice(`导出目标文件夹不可用：${e.message}`);
			return null;
		}
	}

	const picked = await pickFolder();
	if (!picked) {
		new Notice('未选择导出文件夹。可在「设置 → 导出」里固定一个目标文件夹。');
		return null;
	}
	return picked;
}

function askConflict(app: App, count: number): Promise<ConflictChoice> {
	return new Promise((resolve) => {
		new ExportConflictModal(app, count, resolve).open();
	});
}

function getVaultBasePath(app: App): string {
	try {
		const adapter: any = app.vault.adapter;
		if (typeof adapter.getBasePath === 'function') return adapter.getBasePath();
	} catch (e) {
		// 非文件系统适配器（如移动端）取不到
	}
	return '';
}

function isInsidePath(child: string, parent: string): boolean {
	const normalize = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
	const c = normalize(child);
	const p = normalize(parent);
	if (!p) return false;
	return c === p || c.startsWith(p + '\\') || c.startsWith(p + '/');
}

export async function exportMarkdownFile(plugin: SidebarHomePlugin, file: TFile): Promise<void> {
	const app = plugin.app;
	if (getExtension(file.path) !== 'md') {
		new Notice('只能导出 Markdown 文档');
		return;
	}

	const text = await app.vault.cachedRead(file);
	const matches = scanLinks(text);
	const targets: Array<TFile | null> = matches.map((match) =>
		match.external ? null : resolveTarget(app, match, file.path),
	);

	// 同一个文件可能被引用多次，按库内路径去重后统一分配资源名
	const vaultPaths: string[] = [];
	for (const target of targets) {
		if (target && vaultPaths.indexOf(target.path) < 0) vaultPaths.push(target.path);
	}
	const names = assignUniqueNames(vaultPaths.map((path) => getBasename(path)));
	const nameByPath: { [key: string]: string } = {};
	vaultPaths.forEach((path, index) => {
		nameByPath[path] = names[index];
	});

	const root = await resolveExportRoot();
	if (!root) return;

	const assetsFolder =
		sanitizeName(exportConfig.exportAssetsFolder || DEFAULT_ASSETS_FOLDER) ||
		DEFAULT_ASSETS_FOLDER;
	const docName = sanitizeName(file.basename) || '未命名文档';
	const outDir = join(root, docName);
	const assetsDir = join(outDir, assetsFolder);
	const docPath = join(outDir, docName + '.md');

	const existing: string[] = [];
	if (await pathExists(docPath)) existing.push(docName + '.md');
	for (const path of vaultPaths) {
		if (await pathExists(join(assetsDir, nameByPath[path]))) existing.push(nameByPath[path]);
	}

	let choice: ConflictChoice = 'overwrite';
	if (existing.length > 0) {
		choice = await askConflict(app, existing.length);
		if (choice === 'cancel') {
			new Notice('已取消导出');
			return;
		}
	}

	try {
		await fsp.mkdir(outDir, { recursive: true });
		// 没有引用文件时不建空的资源文件夹
		if (vaultPaths.length > 0) await fsp.mkdir(assetsDir, { recursive: true });
	} catch (e) {
		new Notice(`无法创建导出目录：${e.message}`);
		return;
	}

	let written = 0;
	let skipped = 0;
	const failures: string[] = [];

	for (const path of vaultPaths) {
		const name = nameByPath[path];
		const dest = join(assetsDir, name);
		if (choice === 'skip' && (await pathExists(dest))) {
			skipped++;
			continue;
		}
		try {
			const source = app.vault.getAbstractFileByPath(path);
			if (!(source instanceof TFile)) throw new Error('源文件不存在');
			const data = await app.vault.readBinary(source);
			await fsp.writeFile(dest, Buffer.from(data));
			written++;
		} catch (e) {
			console.error(`[Export] 导出 ${path} 失败:`, e);
			failures.push(name);
		}
	}

	const entries: RewriteEntry[] = matches.map((match, index) => {
		const target = targets[index];
		return {
			match,
			targetPath: target ? target.path : '',
			outName: target ? nameByPath[target.path] || null : null,
		};
	});

	if (choice === 'skip' && (await pathExists(docPath))) {
		skipped++;
	} else {
		try {
			await fsp.writeFile(docPath, rewriteLinks(text, entries, assetsFolder), 'utf8');
			written++;
		} catch (e) {
			console.error('[Export] 写入主文档失败:', e);
			failures.push(docName + '.md');
		}
	}

	let summary = `导出完成：写入 ${written} 个文件`;
	if (skipped > 0) summary += `，跳过 ${skipped} 个`;
	if (failures.length > 0) summary += `，失败 ${failures.length} 个`;
	new Notice(summary, 6000);

	if (failures.length > 0) {
		const shown = failures.slice(0, 5).join('、');
		new Notice(`导出失败：${shown}${failures.length > 5 ? ' 等' : ''}`, 8000);
	}

	const basePath = getVaultBasePath(app);
	if (basePath && isInsidePath(root, basePath)) {
		new Notice('导出目标位于库内，新文件需 Obsidian 重新扫描后才会出现在文件列表。', 8000);
	}
}
