async function createProjectPage(tp) {
    const rawTitle = await tp.system.prompt("请输入项目标题");
    if (!rawTitle) { new Notice("未输入标题"); return; }

    const title = rawTitle.trim();
    if (!title) { new Notice("标题不能为空"); return; }

    const currentFile = app.workspace.getActiveFile();
    if (!currentFile) { new Notice("没有打开的文件"); return; }

    const currentFolder = currentFile.parent ? currentFile.parent.path : "";
    const targetFolder = currentFolder ? `${currentFolder}/${title}` : title;

    const templateFile = tp.file.find_tfile("「Page」TopicHome");
    if (!templateFile) {
        new Notice("❌ 未找到模板：「Page」TopicHome.md");
        return;
    }

    try {
        // 1. 创建文件夹
        try { await app.vault.createFolder(targetFolder); } catch (e) {}

        // 2. 获取文件夹对象，用 Obsidian 标准 API 创建文件
        const folder = app.vault.getAbstractFileByPath(targetFolder);
        if (!folder) {
            new Notice("❌ 文件夹创建失败");
            return;
        }

        const newFile = await app.fileManager.createNewMarkdownFile(folder, title);

        // 3. 读取模板并写入内容
        let content = await app.vault.read(templateFile);
        content = content.replace(/<%\s*tp\.file\.title\s*%>/g, title);

        await app.vault.modify(newFile, content);

        // 4. 立即打开（无需 setTimeout，避免与 Folder Notes 产生竞争）
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(newFile);
        app.workspace.setActiveLeaf(leaf, { focus: true });

        new Notice(`✅ 已创建并打开：${title}`);
    } catch (e) {
        new Notice("❌ 创建失败：" + e.message);
        console.error(e);
    }
}

module.exports = createProjectPage;
