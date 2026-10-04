/**
 * 系统文件夹选择与打开
 *
 * Obsidian 没有提供目录选择 API，这里走 Electron 的远程 dialog。
 * 新版 Electron 移除了内置 `remote`，拿不到时返回 null，
 * 由调用方降级提示用户在设置里手填绝对路径。
 */

const PICK_TIMEOUT = 180000;

function getDialog(): any {
	try {
		const electron = require('electron');
		const remote = electron.remote || require('@electron/remote');
		if (remote && remote.dialog && typeof remote.dialog.showOpenDialog === 'function') {
			return remote.dialog;
		}
	} catch (e) {
		// remote 不可用时静默降级
	}
	return null;
}

/** 兼容「返回 Promise」与「回调」两种签名 */
function callShowOpenDialog(dialog: any, options: any): Promise<string[] | null> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: string[] | null) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(value);
		};
		const handle = (result: any) => {
			if (!result) return finish(null);
			if (Array.isArray(result)) return finish(result);
			if (result.canceled) return finish(null);
			finish(result.filePaths || null);
		};
		const timer = window.setTimeout(() => finish(null), PICK_TIMEOUT);

		try {
			const ret = dialog.showOpenDialog(options, handle);
			if (ret && typeof ret.then === 'function') {
				ret.then(handle).catch(() => finish(null));
			}
		} catch (e) {
			try {
				const ret = dialog.showOpenDialog(null, options, handle);
				if (ret && typeof ret.then === 'function') {
					ret.then(handle).catch(() => finish(null));
				}
			} catch (err) {
				finish(null);
			}
		}
	});
}

/** 弹出系统文件夹选择框；不可用或用户取消时返回 null */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
	const dialog = getDialog();
	if (!dialog) return null;

	const options: any = { properties: ['openDirectory', 'createDirectory'] };
	if (defaultPath) options.defaultPath = defaultPath;

	try {
		const picked = await callShowOpenDialog(dialog, options);
		if (!picked || picked.length === 0) return null;
		return picked[0];
	} catch (e) {
		console.error('[Export] 选择文件夹失败:', e);
		return null;
	}
}

/** 用系统资源管理器打开一个绝对路径 */
export function openInSystemExplorer(absPath: string): void {
	try {
		const { shell } = require('electron');
		shell.openPath(absPath);
	} catch (e) {
		console.error('[Export] 打开文件夹失败:', e);
	}
}
