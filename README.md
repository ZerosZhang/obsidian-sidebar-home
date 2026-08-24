# Sidebar Home

一个 Obsidian 侧边栏主页插件：快速创建笔记、常用链接、状态概览，集成 Edge-TTS 语音朗读和 Markdown 格式化。

## 功能特性

- **侧边栏主页**：快速新建笔记、收藏常用链接、状态概览面板
- **标签页管理**：复用现有标签页、双击关闭、关闭后跳转到前一个标签页
- **Markdown 格式化**：25+ 条正则规则流水线，支持保存时自动格式化
  - 标记转换、弯引号、中英文空格、列表、引用块、空行管理、多余空格清理、YAML 时间戳
  - 内置占位保护：wiki 链接、代码块、`<span>` 内容、markdown 链接 URL 在格式化时保持不变
- **语音朗读**：Edge-TTS + Web Speech 降级，全文/选中文本朗读，句子高亮
- **样式隐藏**：实时预览下隐藏加粗/斜体/删除线等格式标记符号

## 安装

1. 在 Releases 页面下载最新的 `main.js`、`manifest.json`、`styles.css`
2. 在 Obsidian 仓库的 `.obsidian/plugins/sidebar-home/` 目录下创建同名文件夹
3. 将三个文件复制进去
4. 重启 Obsidian，在「设置 → 第三方插件」中启用

## 开发与构建

```bash
npm install        # 安装依赖
npm run dev        # watch 模式（仅 esbuild，不做类型检查）
npm run build      # 类型检查 + 生产打包（tsc --noEmit && esbuild）
```

- TypeScript 源码位于 `src/`
- 构建产物为根目录下的 `main.js`（已 gitignore，由构建生成）

## 自动发布

推送到 `main` 分支会自动执行构建验证；推送 `v*` 格式的 tag 会自动构建并创建 GitHub Release：

```bash
git tag v2.2.0
git push origin v2.2.0
```

Release 的 `manifest.json` 版本号会自动与 tag 同步。

## 许可证

[MIT](LICENSE)
