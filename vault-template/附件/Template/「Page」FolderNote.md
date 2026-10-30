---
cssclasses:
  - wide-note
---

> [!done]+ 创建新主题
> 点击 `button-topic` 按钮可以创建一个新的主题文件夹。
>
> 2026 年 10 月 21 日更新，版本 1.1.2

```dataviewjs
// ==================== 配置区域 ====================

// 每行卡片数量
const CARDS_PER_ROW = 6;

// 自定义分组（按顺序从上到下渲染）
// 类型自动推断，无需手动指定
// 常用 emoji：🚌💈🛸🐼🤿🥘🐳🦆🐡🦚🦘🦍🍍🍉🍈🍇🥅⛸️🦩🎾⚽🥎🎳🏏
const customGroups = [
{
    name: "已整理",
    items: [
        { name: "零碎阅读", emoji: "🐼" },
        { name: "Folo阅读存档", emoji: "🪸" },
    ]
},

    // {
    //     name: "已整理",
    //     items: [
    //         { name: "项目", emoji: "🚀" },
    //         { name: "日记" }
    //     ]
    // }
];

// 未整理分组的标题
const UNCATEGORIZED_NAME = "📦 未整理";

// 各类型的默认 Emoji（未整理分组中用于区分三种情况）
const TYPE_EMOJI = {
    folderNote: "📑",
    normalFolder: "🗂️",
    markdownFile: "📄"
};

// 卡片固定高度（px）
const CARD_HEIGHT = 120;

// =================================================

const currentFolder = dv.current().file.folder;
const container = dv.container;
const currentFileName = dv.current().file.name;

// ── 1. 收集当前目录下的所有直接子文件夹 ──
let allFolders = [];
try {
    const listResult = await app.vault.adapter.list(currentFolder);
    allFolders = listResult.folders
        .map(f => {
            const relative = f.replace(currentFolder + "/", "");
            return relative.includes("/") ? null : relative;
        })
        .filter(f => f !== null);
} catch (e) {
    const folders = new Set();
    for (const p of dv.pages(`"${currentFolder}"`)) {
        const folder = p.file.folder;
        if (folder && folder.startsWith(currentFolder + "/")) {
            const sub = folder.replace(currentFolder + "/", "").split("/")[0];
            if (sub) folders.add(sub);
        }
    }
    allFolders = Array.from(folders);
}

// ── 2. 分类文件夹：FolderNote vs 普通文件夹 ──
const folderNoteSet = new Set();
const normalSet = new Set();

for (const name of allFolders) {
    const mdPath = `${currentFolder}/${name}/${name}.md`;
    if (app.vault.getAbstractFileByPath(mdPath)) {
        folderNoteSet.add(name);
    } else {
        normalSet.add(name);
    }
}

// ── 3. 收集单 markdown 文件（排除已有同名文件夹的，排除当前文件自身） ──
let allMarkdownFiles = [];
try {
    const listResult = await app.vault.adapter.list(currentFolder);
    allMarkdownFiles = listResult.files
        .map(f => {
            const relative = f.replace(currentFolder + "/", "");
            if (relative.includes("/")) return null;
            if (!relative.endsWith(".md")) return null;
            if (relative === currentFileName + ".md") return null;
            return relative.replace(/\.md$/, "");
        })
        .filter(f => f !== null)
        .filter(name => !allFolders.includes(name));
} catch (e) {
    allMarkdownFiles = [];
}

// ── 4. 辅助函数：自动推断类型 ──
function detectType(name) {
    if (folderNoteSet.has(name)) return "folderNote";
    if (normalSet.has(name)) return "normalFolder";
    if (allMarkdownFiles.includes(name)) return "markdownFile";
    return null;
}

// ── 5. 辅助函数：创建卡片 ──
function createCard(name, type, emojiOverride) {
    const card = document.createElement("div");
    card.style.borderRadius = "10px";
    card.style.padding = "16px";
    card.style.textAlign = "center";
    card.style.transition = "transform 0.15s ease, box-shadow 0.15s ease";
    card.style.cursor = "pointer";
    card.style.userSelect = "none";
    card.style.width = "100%";
    card.style.height = CARD_HEIGHT + "px";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.justifyContent = "center";
    card.style.alignItems = "center";
    card.style.boxSizing = "border-box";
    card.style.overflow = "hidden";

    if (type === "folderNote") {
        card.style.border = "2px solid var(--interactive-accent)";
        card.style.background = "var(--background-primary-alt)";
    } else if (type === "normalFolder") {
        card.style.border = "1px dashed var(--background-modifier-border)";
        card.style.background = "var(--background-secondary)";
    } else {
        card.style.border = "1px solid var(--background-modifier-border)";
        card.style.background = "var(--background-secondary-alt)";
    }

    const emoji = emojiOverride || TYPE_EMOJI[type] || "📄";
    const displayName = name.length > 16 ? name.substring(0, 15) + "…" : name;

    card.innerHTML = `
        <div style="font-size: 2em; margin-bottom: 6px; line-height: 1;">${emoji}</div>
        <div style="font-size: 0.9em; font-weight: 500; word-break: break-word; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${displayName}</div>
    `;

    card.addEventListener("mouseenter", () => {
        card.style.transform = "translateY(-3px)";
        card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    });
    card.addEventListener("mouseleave", () => {
        card.style.transform = "translateY(0)";
        card.style.boxShadow = "none";
    });

    card.addEventListener("click", async () => {
        if (type === "folderNote") {
            await app.workspace.openLinkText(`${currentFolder}/${name}/${name}.md`, "");
        } else if (type === "markdownFile") {
            await app.workspace.openLinkText(`${currentFolder}/${name}.md`, "");
        } else {
            try {
                const { exec } = require("child_process");
                const fullPath = app.vault.adapter.getFullRealPath(`${currentFolder}/${name}`);
                exec(`start "" "${fullPath.replace(/\\/g, '/')}"`);
            } catch (err) {
                new Notice("打开文件夹失败: " + err.message);
            }
        }
    });

    return card;
}

// ── 6. 辅助函数：渲染一个分组 ──
function renderGroup(name, items) {
    if (!items || items.length === 0) return;

    const section = document.createElement("div");
    section.style.marginBottom = "28px";

    const header = document.createElement("div");
    header.style.fontSize = "1.1em";
    header.style.fontWeight = "600";
    header.style.marginBottom = "12px";
    header.style.color = "var(--text-normal)";
    header.style.borderBottom = "1px solid var(--background-modifier-border)";
    header.style.paddingBottom = "6px";
    header.textContent = `${name} (${items.length})`;
    section.appendChild(header);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `repeat(${CARDS_PER_ROW}, 1fr)`;
    grid.style.gap = "12px";

    for (const item of items) {
        grid.appendChild(createCard(item.name, item.type, item.emoji));
    }

    section.appendChild(grid);
    container.appendChild(section);
}

// ── 7. 渲染自定义分组 ──
const listed = new Set();

for (const group of customGroups) {
    const matched = group.items
        .filter(item => detectType(item.name) !== null)
        .map(item => {
            const type = detectType(item.name);
            listed.add(item.name);
            return { name: item.name, type, emoji: item.emoji };
        });
    renderGroup(group.name, matched);
}

// ── 8. 收集未整理内容 ──
const uncategorized = [];

for (const name of folderNoteSet) {
    if (!listed.has(name)) uncategorized.push({ name, type: "folderNote" });
}
for (const name of normalSet) {
    if (!listed.has(name)) uncategorized.push({ name, type: "normalFolder" });
}
for (const name of allMarkdownFiles) {
    if (!listed.has(name)) uncategorized.push({ name, type: "markdownFile" });
}

uncategorized.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
renderGroup(UNCATEGORIZED_NAME, uncategorized);

// ── 9. 空状态 ──
if (folderNoteSet.size === 0 && normalSet.size === 0 && allMarkdownFiles.length === 0) {
    container.innerHTML = "<p style='color: var(--text-muted); text-align: center; padding: 24px 0;'>暂无子文件夹或文件</p>";
}
```
