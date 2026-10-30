# Sidebar Home

一个为 Obsidian 打造的侧边栏主页插件：把左侧边栏变成你的工作台，快速新建笔记、收藏常用链接、查看状态概览，并内置 Excel 表格内嵌预览、文档导出、Edge-TTS 语音朗读和 Markdown 格式化引擎。

> 该插件尚未提交 Obsidian 社区插件审核，仅供个人使用。

[![CI](https://img.shields.io/github/actions/workflow/status/ZerosZhang/obsidian-sidebar-home/build.yml?branch=main&label=CI)](https://github.com/ZerosZhang/obsidian-sidebar-home/actions)
[![Release](https://img.shields.io/github/v/release/ZerosZhang/obsidian-sidebar-home?label=Release)](https://github.com/ZerosZhang/obsidian-sidebar-home/releases)
[![Downloads](https://img.shields.io/github/downloads/ZerosZhang/obsidian-sidebar-home/total?label=Downloads)](https://github.com/ZerosZhang/obsidian-sidebar-home/releases)

## 功能特性

- **侧边栏主页**：快速新建笔记、收藏常用链接、状态概览面板
- **标签页管理**：复用现有标签页、双击关闭标签页、关闭后跳转到前一个标签页
- **Markdown 格式化**：25+ 条正则规则流水线，支持保存时自动格式化
  - 标记转换、弯引号、中英文空格、列表、引用块、空行管理、多余空格清理、YAML 时间戳
  - 内置占位保护：wiki 链接、代码块、`<span>` 内容、markdown 链接 URL 在格式化时保持不变
- **语音朗读**：Edge-TTS + Web Speech 降级，支持全文/选中文本朗读、句子高亮
- **样式隐藏**：实时预览下隐藏 HTML 标签、可选显示空格标记
- **Excel 内嵌预览**：用 `![[表格.xlsx]]` 在笔记中预览只读表格（`.xlsx` / `.xlsm` / `.ods` / `.csv`）
  - 多 sheet 标签栏切换，支持 `![[表格.xlsx#sheet名]]` 直接定位
  - 大表默认只渲染前 100 行 × 20 列保证流畅，可一键「显示全部行列」
  - 「适应宽度」把宽表缩进预览框，不用左右滚动
- **文档导出**：把当前文档导出到库外文件夹，正文存为 `.md`，引用的图片与其他文件统一放进资源子文件夹
  - 链接改写成标准 Markdown 相对链接，脱离 Obsidian 也能正常显示
  - 支持 `![[嵌入]]`、`[[wiki 链接]]`、`[文字](路径)` 三种写法，代码块内的内容不会误判
  - 目标已有同名文件时弹窗询问覆盖或跳过

## 安装

### 通过 Releases 安装（推荐）

每次 Release 提供两个压缩包（另附 `main.js`、`manifest.json`、`styles.css` 三个单文件，供 BRAT / 插件更新使用）：

| 压缩包 | 内容 | 用法 |
|--------|------|------|
| `sidebar-home-<版本>.zip` | 插件本体（三个文件在压缩包根层） | 解压到 `.obsidian/plugins/sidebar-home/`，重启 Obsidian 后在「设置 → 第三方插件」启用 |
| `vault-template-<版本>.zip` | 完整模板库（含 `vault-template/` 目录及内置插件） | 解压后用 Obsidian「打开文件夹作为库」选中 `vault-template` 目录，关闭受限模式即可 |

### 从源码构建

```bash
git clone https://github.com/ZerosZhang/obsidian-sidebar-home.git
cd obsidian-sidebar-home
npm install
npm run build
```

构建产物 `main.js` 位于项目根目录。

## 配套模板库

`vault-template/` 是一套开箱即用的 Obsidian 库模板，已内置本插件及模板用到的其他插件，下载后打开即可使用。

- 获取方式：下载 Release 里的 `vault-template-<版本>.zip`，或直接克隆本仓库使用其中的 `vault-template/` 目录
- 用法：解压后用 Obsidian「打开文件夹作为库」选中 `vault-template` 目录，关闭受限模式即可
- 目录结构与各文件夹用途见 [`vault-template/README.md`](vault-template/README.md)
- 开发本插件时，构建后执行 `npm run sync:template` 可把 `main.js`、`manifest.json`、`styles.css` 同步进模板库，避免版本不一致
