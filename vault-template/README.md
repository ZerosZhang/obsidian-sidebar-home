# Obsidian 模板库

配合 [Sidebar Home](https://github.com/ZerosZhang/obsidian-sidebar-home) 插件使用的 Obsidian 库模板，下载后可直接打开使用。

## 使用步骤

1. 点仓库右上角 **Use this template** → **Create a new repository**，或直接下载 ZIP 解压
2. 打开 Obsidian → **打开文件夹作为库**（Open folder as vault），选中本目录
3. 首次打开会进入「受限模式」，点击 **关闭受限模式**（Turn off restricted mode）
4. 进入 **设置 → 第三方插件**，确认插件已启用；`sidebar-home` 已在启用列表中，若未启用请手动打开

## 目录说明

| 目录 | 用途 |
|------|------|
| `主题/` | 主题主页；`主题/时光/` 是日历式日记（初见 / 往日 / 案头 / 拾语） |
| `附件/Template/` | Templater 模板与按钮定义（`按钮库.md`） |
| `附件/Todo/` | 待办、未完成、剪藏清单 |
| `缓存/` | 临时缓存笔记 |
| `.obsidian/snippets/` | 自定义 CSS 片段 |

## 注意

- 侧边栏主页的个人配置保存在 `.obsidian/plugins/obsidian-sidebar-home/data.json`，模板里已预置一套默认配置，改坏可直接删除该文件重置。
- `.obsidian/plugins/` 已内置所需插件，更新插件请用 Obsidian 自带的插件更新，或用 Release 里的 `main.js` / `manifest.json` / `styles.css` 覆盖。
- `fast-note-sync` 默认未配置同步服务器，需要时填入自己的地址和 Token。
