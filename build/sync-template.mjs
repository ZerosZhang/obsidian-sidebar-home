import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "vault-template/.obsidian/plugins/obsidian-sidebar-home");

fs.mkdirSync(target, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
	fs.copyFileSync(path.join(root, file), path.join(target, file));
	console.log(`copied ${file} -> vault-template/.obsidian/plugins/obsidian-sidebar-home`);
}
