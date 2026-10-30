import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = (process.env.TAG || "").replace(/^v/, "");

if (!version) {
	console.error("缺少 TAG 环境变量，无法定位 CHANGELOG 中的版本小节");
	process.exit(1);
}

const changelog = fs.readFileSync(path.join(root, "doc/CHANGELOG.md"), "utf8");
const lines = changelog.split(/\r?\n/);

const start = lines.findIndex((line) => /^##\s/.test(line) && line.includes(version));
if (start === -1) {
	console.error(`doc/CHANGELOG.md 中没有 ${version} 的小节，请先在文件顶部补充该版本`);
	process.exit(1);
}

const next = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
const body = lines.slice(start, next === -1 ? lines.length : next).join("\n").trim();

fs.writeFileSync(path.join(root, "RELEASE_NOTES.md"), `${body}\n`);
console.log(`已生成 RELEASE_NOTES.md（${version}，${body.split("\n").length} 行）`);
