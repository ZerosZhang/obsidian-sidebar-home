/**
 * 导出输出名规划
 *
 * 一次导出里，来自不同目录的同名文件会挤进同一个 `assets/`，
 * 这里统一改名消解冲突。纯逻辑，可离线断言。
 */

const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Windows 下单段路径名的长度限制是 255，这里留足余量给「 (1)」后缀 */
const MAX_NAME_LENGTH = 120;

/** 清理文件名中的非法字符，并去掉结尾的点与空格 */
export function sanitizeName(name: string): string {
	let out = name.replace(ILLEGAL_CHARS, '_').replace(/\s+/g, ' ').trim();
	out = out.replace(/[. ]+$/, '');
	if (out.length > MAX_NAME_LENGTH) {
		const dot = out.lastIndexOf('.');
		if (dot > 0 && out.length - dot <= 12) {
			const ext = out.slice(dot);
			out = out.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
		} else {
			out = out.slice(0, MAX_NAME_LENGTH);
		}
	}
	return out;
}

/** 拆成主名 + 扩展名；`.excalidraw.md` 拆出 `图.excalidraw` + `.md` */
export function splitName(name: string): { base: string; ext: string } {
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return { base: name, ext: '' };
	return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/** 按出现顺序给文件名去重，冲突的追加 ` (1)`、` (2)`…（忽略大小写） */
export function assignUniqueNames(names: string[]): string[] {
	const used: { [key: string]: boolean } = {};
	return names.map((raw) => {
		const safe = sanitizeName(raw) || 'file';
		let candidate = safe;
		if (used[candidate.toLowerCase()]) {
			const parts = splitName(safe);
			let index = 1;
			do {
				candidate = parts.base + ' (' + index + ')' + parts.ext;
				index++;
			} while (used[candidate.toLowerCase()]);
		}
		used[candidate.toLowerCase()] = true;
		return candidate;
	});
}
