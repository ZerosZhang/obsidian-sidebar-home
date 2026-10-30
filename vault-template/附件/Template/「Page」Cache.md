---
创建日期: 2026年04月03日 12:54:26
修改日期: 2026年05月12日 10:41:16
---

<%*
// 文件创建后自动切换到编辑模式
setTimeout(async () => {
    // 遍历所有叶子找到当前文件对应的视图
    const leaves = app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
        if (leaf.view?.file?.path === tp.file.path(true)) {
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
%>
