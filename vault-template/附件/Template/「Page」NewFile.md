---
创建日期: 2026年04月07日 11:32:01
修改日期: 2026年04月07日 11:32:33
---

<%*
/**
 * 创建新笔记执行器 - 只执行逻辑，不输出内容到文档
 * 
 * 功能：
 * 1. 弹出对话框让用户输入新笔记标题
 * 2. 在当前目录下创建空白笔记文件
 * 3. 自动打开新笔记并切换到编辑模式
 */

// 获取当前活动的文件（即点击按钮所在的文件）
const activeFile = app.workspace.getActiveFile();

if (!activeFile) {
    new Notice("❌ 没有找到活动文件");
    // 清空输出，不插入任何内容
    tR = "";
    return;
}

// 弹出对话框获取标题
const title = await tp.system.prompt("请输入新笔记的标题");

// 如果用户取消或输入为空，则退出
if (!title || title.trim() === "") {
    new Notice("❌ 未输入标题，已取消创建");
    tR = "";
    return;
}

// 清理标题（移除不合法的文件名字符）
const cleanTitle = title.trim().replace(/[<>:"/\\|?*]/g, "");

// 获取当前文件所在目录
const currentFolder = activeFile.parent.path;
const folderPath = currentFolder === "" ? "" : currentFolder + "/";

// 构造文件名
const fileName = cleanTitle + ".md";
const filePath = folderPath + fileName;

// 检查文件是否已存在
const existingFile = app.vault.getAbstractFileByPath(filePath);
if (existingFile) {
    new Notice(`❌ 文件 "${fileName}" 已存在！`);
    tR = "";
    return;
}

// 新文件的空白内容
const newFileContent = "";

try {
    // 创建新文件
    const newFile = await app.vault.create(filePath, newFileContent);
    
    new Notice(`✅ 成功创建笔记：${fileName}`);
    
    // 打开新创建的笔记文件
    await app.workspace.openLinkText(filePath, "");
    
    // 文件创建后自动切换到编辑模式
    setTimeout(async () => {
        // 遍历所有叶子找到当前文件对应的视图
        const leaves = app.workspace.getLeavesOfType("markdown");
        for (const leaf of leaves) {
            if (leaf.view?.file?.path === filePath) {
                await leaf.setViewState({
                    type: "markdown",
                    state: {
                        file: leaf.view.file.path,
                        mode: "source"
                    }
                });
                break;
            }
        }
    }, 300);
    
} catch (error) {
    new Notice(`❌ 创建失败：${error.message}`);
    console.error(error);
}

// 清空输出，不插入任何内容到当前文档
tR = "";
-%>
