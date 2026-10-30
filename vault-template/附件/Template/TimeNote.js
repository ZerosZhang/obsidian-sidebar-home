async function openInEdit(file) {
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await leaf.setViewState({
        type: "markdown",
        state: { file: file.path, mode: "source" },
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
}

async function openOrCreateDaily(tp, category) {
    const BASE = "主题/时光";
    const KNOWN = ["初见", "往日", "案头", "拾语"];

    if (!KNOWN.includes(category)) {
        new Notice(`❌ 未知分类：${category}`);
        return;
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const folder = `${BASE}/${category}`;
    const filePath = `${folder}/${y}年${m}月${d}日.md`;

    const existing = app.vault.getAbstractFileByPath(filePath);
    if (existing) {
        await openInEdit(existing);
        new Notice(`↩️ 已存在：${category}/${y}年${m}月${d}日`);
        return;
    }

    try {
        await app.vault.createFolder(folder);
    } catch (e) {
        // 文件夹已存在时忽略
    }

    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const content = [
        "---",
        `创建日期: ${y}年${m}月${d}日 ${time}`,
        `修改日期: ${y}年${m}月${d}日 ${time}`,
        "---",
        "",
        "",
    ].join("\n");

    try {
        const file = await app.vault.create(filePath, content);
        new Notice(`✅ 已创建：${category}/${y}年${m}月${d}日`);
        await openInEdit(file);
    } catch (error) {
        new Notice(`❌ 创建失败：${error.message}`);
        console.error(error);
    }
}

module.exports = openOrCreateDaily;
