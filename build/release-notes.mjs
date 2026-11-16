import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = (process.env.TAG || "").replace(/^v/, "");

if (!version) {
	console.error("缺少 TAG 环境变量，无法定位 doc/ChangeLog.md 中的版本小节");
	process.exit(1);
}

const changelogPath = path.join(root, "doc/ChangeLog.md");
const heading = new RegExp(`^##\\s+v?${version.replace(/\./g, "\\.")}(?:\\s|$)`);

const lines = fs.readFileSync(changelogPath, "utf8").split(/\r?\n/);
const start = lines.findIndex((line) => heading.test(line));

let body = "";
if (start === -1) {
	console.warn(`doc/ChangeLog.md 中没有 ${version} 的小节，发布说明留空`);
} else {
	let end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
	if (end === -1) end = lines.length;
	body = lines.slice(start + 1, end).join("\n").trim();
}

fs.writeFileSync(path.join(root, "RELEASE_NOTES.md"), body ? `${body}\n` : "");
console.log(body ? `已生成 RELEASE_NOTES.md（${version}，${body.split("\n").length} 行）` : "已生成空的 RELEASE_NOTES.md");
