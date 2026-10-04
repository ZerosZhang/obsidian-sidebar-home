# Sidebar Home

一个为 Obsidian 打造的侧边栏主页插件：把左侧边栏变成你的工作台，快速新建笔记、收藏常用链接、查看状态概览，并内置 Excel 表格内嵌预览、文档导出、Edge-TTS 语音朗读和 Markdown 格式化引擎。

> 该插件尚未提交 Obsidian 社区插件审核，仅供个人使用。

[![CI](https://img.shields.io/github/actions/workflow/status/ZerosZhang/obsidian-sidebar-home/build.yml?branch=main&label=CI)](https://github.com/ZerosZhang/obsidian-sidebar-home/actions)
[![Release](https://img.shields.io/github/v/release/ZerosZhang/obsidian-sidebar-home?label=Release)](https://github.com/ZerosZhang/obsidian-sidebar-home/releases)
[![Downloads](https://img.shields.io/github/downloads/ZerosZhang/obsidian-sidebar-home/total?label=Downloads)](https://github.com/ZerosZhang/obsidian-sidebar-home/releases)
[![License](https://img.shields.io/github/license/ZerosZhang/obsidian-sidebar-home?label=License)](https://github.com/ZerosZhang/obsidian-sidebar-home/blob/main/LICENSE)

## 功能特性

- **侧边栏主页**：快速新建笔记、收藏常用链接、状态概览面板
- **标签页管理**：复用现有标签页、双击关闭标签页、关闭后跳转到前一个标签页
- **Markdown 格式化**：25+ 条正则规则流水线，支持保存时自动格式化
  - 标记转换、弯引号、中英文空格、列表、引用块、空行管理、多余空格清理、YAML 时间戳
  - 内置占位保护：wiki 链接、代码块、`<span>` 内容、markdown 链接 URL 在格式化时保持不变
- **语音朗读**：Edge-TTS + Web Speech 降级，支持全文/选中文本朗读、句子高亮
- **样式隐藏**：实时预览下隐藏加粗/斜体/删除线等格式标记符号，光标移入时自动显示
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

1. 前往 [Releases](https://github.com/ZerosZhang/obsidian-sidebar-home/releases) 页面
2. 下载 `main.js`、`manifest.json`、`styles.css` 三个文件
3. 将它们放入 Obsidian 仓库的 `.obsidian/plugins/sidebar-home/` 目录
4. 重启 Obsidian，在「设置 → 第三方插件」中启用

### 从源码构建

```bash
git clone https://github.com/ZerosZhang/obsidian-sidebar-home.git
cd obsidian-sidebar-home
npm install
npm run build
```

构建产物 `main.js` 位于项目根目录。

## 使用说明

设置页包含 7 个 Tab：

| Tab | 说明 |
|-----|------|
| 侧边栏 | 主页面板的显示项与快捷链接管理 |
| 标签页 | 标签页复用、双击关闭、关闭跳转等行为 |
| 格式化 | 每条格式化规则独立开关 + 保存时自动格式化 |
| 样式隐藏 | 实时预览下隐藏格式标记符号 |
| 语音朗读 | 音色、语速、朗读高亮颜色设置 |
| Excel 预览 | 内嵌预览开关、默认渲染行列数、预览框高度 |
| 导出 | 导出目标文件夹、资源文件夹名 |

格式化通过命令面板（`Ctrl+P` → 格式化当前文档）触发；文档导出通过命令面板（`Ctrl+P` → 导出文档（Markdown + 资源））触发。

## 项目结构

```text
obsidian-sidebar-home/
├── src/                    # TypeScript 源码
│   ├── main.ts             # 插件入口
│   ├── settings.ts         # 设置类型与默认值
│   ├── ui/                 # 侧边栏视图、设置页
│   ├── editor/             # 编辑器扩展（格式隐藏、空格可视化）
│   ├── formatting/         # Markdown 格式化引擎
│   ├── workspace/          # 标签页与链接工作区工具
│   ├── tts/                # 语音朗读（Edge-TTS、分句、高亮）
│   ├── preview/            # Excel 内嵌预览（解析、缓存、表格渲染、嵌入挂载）
│   └── export/             # 文档导出（引用扫描、路径规划、链接重写、落盘）
├── manifest.json           # 插件清单
├── styles.css              # 插件样式
└── .github/workflows/      # CI 自动构建与发布
```

## 开发与构建

```bash
npm install        # 安装依赖
npm run dev        # watch 模式（仅 esbuild，不做类型检查）
npm run build      # 类型检查 + 生产打包（tsc --noEmit && esbuild）
```

## 自动发布

推送到 `main` 分支会自动执行构建验证；推送 `v*` 格式的 tag 会自动构建并创建 GitHub Release：

```bash
git tag v2.2.0
git push origin v2.2.0
```

Release 的 `manifest.json` 版本号会自动与 tag 同步。

## 贡献

欢迎提交 issue 和 pull request。改动代码前请先确保 `npm run build` 通过。

## 许可证

[MIT](LICENSE)
