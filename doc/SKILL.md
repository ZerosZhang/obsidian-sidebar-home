# Obsidian 插件开发

本技能汇总了从官方文档、中文文档及社区经验中提炼的 Obsidian 插件开发知识，帮助你快速上手并高效开发插件。

---

## 1. 插件概述

Obsidian 插件是第三方扩展，可让你：

- 扩展或修改用户界面（Ribbon、状态栏、设置面板等）
- 编辑库中的文件和目录
- 增强编辑器以获得更好的笔记体验

---

## 2. 开发环境配置

### 2.1 必备工具（官方方式）

| 工具 | 用途 |
|------|------|
| **Git** | 版本控制，克隆示例插件和发布插件 |
| **Node.js** | JavaScript 运行时，用于编译插件 |
| **TypeScript** | 插件开发语言（需基础了解） |
| **VS Code** | 推荐的代码编辑器（支持 Windows/Linux/macOS） |

### 2.2 快速上手（无环境方式）

对于不想配置 Node.js 环境的新手，可以使用社区提供的精简方案：

1. 下载社区提供的 `obsidian-sample.zip`（约 45KB）
2. 解压到 Obsidian 插件目录 `<vault>/.obsidian/plugins/`
3. 目录结构包含预提取的 `node_modules/obsidian`（约 175KB，用于代码提示）
4. 直接编辑 `main.js` 即可开发，无需 TypeScript 编译

**优缺点：**

- ✅ 占用空间小（无需几百 MB 的 node_modules）
- ✅ 新手友好，仅需会 JS 和 CSS
- ❌ 不支持 TypeScript（可通过 IDE 插件解决）
- ❌ 不方便导入外部模块（模块修改不会热加载）

> **适用场景：** 小型插件、学习开发、快速原型验证。

---

## 3. 创建第一个插件（官方流程）

### 3.1 准备工作

**重要：** 永远不要在你的主库中开发插件！请创建一个**专用的开发库**以防数据丢失。

### 3.2 下载示例插件

```bash
cd path/to/vault
mkdir -p .obsidian/plugins
cd .obsidian/plugins
git clone https://github.com/obsidianmd/obsidian-sample-plugin.git
cd obsidian-sample-plugin
```

> 示例插件仓库是 GitHub 模板仓库，你可以基于此创建自己的仓库。

### 3.3 构建插件

```bash
# 安装依赖
npm install

# 开发模式（持续监听文件变化并重新编译）
npm run dev

# 生产模式构建
npm run build
```

构建后会生成 `main.js`，这是 Obsidian 实际加载的文件。

### 3.4 启用插件

1. 打开 Obsidian → **设置** → **社区插件**
2. 打开**启用社区插件**
3. 在**已安装插件**中找到 **Sample Plugin** 并启用

---

## 4. 插件结构解析

### 4.1 目录结构

```
my-plugin/
├── manifest.json      # 插件清单（元数据）
├── main.ts            # 主入口（TypeScript 源码）
├── main.js            # 编译后的 JavaScript（Obsidian 加载）
├── styles.css         # 自定义样式（可选）
├── esbuild.config.mjs # 构建配置
├── package.json       # 项目依赖
└── tsconfig.json      # TypeScript 配置
```

### 4.2 manifest.json

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "description": "这是我的第一个插件",
  "author": "你的名字",
  "authorUrl": "https://your-website.com",
  "fundingUrl": "https://buymeacoffee.com/yourname",
  "isDesktopOnly": false
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识符，只能包含小写字母、数字和连字符 |
| `name` | 显示名称 |
| `version` | 版本号，需符合语义化版本规范 |
| `minAppVersion` | 最低支持的 Obsidian 版本 |
| `description` | 简短描述 |
| `author` | 作者名 |
| `authorUrl` | 作者网站 |
| `fundingUrl` | 赞助链接 |
| `isDesktopOnly` | 是否仅桌面端可用 |

> **注意：** 修改 `manifest.json` 后需要**重启 Obsidian** 才能生效。

### 4.3 main.ts 基础结构

```typescript
import { Plugin, Notice } from 'obsidian';

export default class MyPlugin extends Plugin {
  // 插件加载时调用
  async onload() {
    console.log('插件已加载');
  }

  // 插件禁用时调用
  onunload() {
    console.log('插件已卸载');
  }
}
```

---

## 5. 核心 API 与功能

### 5.1 Ribbon 图标

在左侧功能区添加图标按钮：

```typescript
this.addRibbonIcon('dice', '提示文本', () => {
  new Notice('Hello, Obsidian!');
});
```

- 第一个参数：Lucide 图标名称
- 第二个参数：悬停提示文本
- 第三个参数：点击回调函数

### 5.2 命令

向命令面板注册命令：

```typescript
this.addCommand({
  id: 'open-sample-modal',
  name: '打开示例模态框',
  hotkeys: [{ modifiers: ['Ctrl'], key: 'k' }], // 可选：默认快捷键
  callback: () => {
    new Notice('命令已执行!');
  }
});
```

### 5.3 编辑器操作

```typescript
import { Editor, MarkdownView } from 'obsidian';

this.addCommand({
  id: 'editor-action',
  name: '编辑器操作',
  editorCallback: (editor: Editor, view: MarkdownView) => {
    const selected = editor.getSelection();
    editor.replaceSelection(`**${selected}**`);
  }
});
```

### 5.4 设置面板

创建插件设置界面：

```typescript
import { PluginSettingTab, Setting } from 'obsidian';

interface MyPluginSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: '默认值'
};

class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('设置项名称')
      .setDesc('设置项描述')
      .addText(text => text
        .setPlaceholder('输入内容')
        .setValue(this.plugin.settings.mySetting)
        .onChange(async (value) => {
          this.plugin.settings.mySetting = value;
          await this.plugin.saveSettings();
        }));
  }
}

// 在插件主类中：
async onload() {
  await this.loadSettings();
  this.addSettingTab(new MySettingTab(this.app, this));
}

async loadSettings() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
}

async saveSettings() {
  await this.saveData(this.settings);
}
```

### 5.5 状态栏

在底部状态栏添加信息：

```typescript
const statusBarItem = this.addStatusBarItem();
statusBarItem.setText('状态信息');
```

### 5.6 文件系统操作

```typescript
// 读取文件
const file = this.app.vault.getAbstractFileByPath('笔记.md');
if (file instanceof TFile) {
  const content = await this.app.vault.read(file);
}

// 创建文件
await this.app.vault.create('新笔记.md', '# 标题\n\n内容');

// 修改文件
await this.app.vault.modify(file, '新内容');

// 监听文件事件
this.registerEvent(this.app.vault.on('create', (file) => {
  console.log('文件已创建:', file.name);
}));
```

### 5.7 事件系统

```typescript
// 注册事件（插件卸载时会自动清理）
this.registerEvent(this.app.workspace.on('file-open', (file: TFile) => {
  console.log('打开文件:', file?.name);
}));

// 定时器
this.registerInterval(window.setInterval(() => {
  console.log('定时执行');
}, 1000));
```

**常用事件：**

| 事件 | 触发时机 |
|------|----------|
| `create` | 创建文件/文件夹 |
| `delete` | 删除文件/文件夹 |
| `rename` | 重命名文件/文件夹 |
| `modify` | 修改文件内容 |
| `file-open` | 打开文件 |
| `active-leaf-change` | 活动面板变化 |

### 5.8 模态框

```typescript
import { Modal, App } from 'obsidian';

class SampleModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.setText('模态框内容');
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// 打开模态框
new SampleModal(this.app).open();
```

### 5.9 提示通知

```typescript
import { Notice } from 'obsidian';

// 简单提示
new Notice('这是一条提示');

// 设置显示时长（毫秒）
new Notice('5秒后消失', 5000);
```

---

## 6. 开发技巧

### 6.1 热重载（Hot Reload）

安装 **Hot Reload** 插件，实现代码修改后自动重载：

1. 在 Obsidian 社区插件中安装 Hot Reload
2. 在插件目录下创建 `.hotreload` 空文件
3. 修改代码后插件会自动重载

### 6.2 开发者工具

| 平台 | 快捷键 |
|------|--------|
| Windows/Linux | `Ctrl + Shift + I` |
| macOS | `Cmd + Option + I` |

### 6.3 快速重启

在控制台执行：

```javascript
location.reload()
```

### 6.4 调试技巧

```javascript
// 暂停调试
await sleep(5000);
debugger;

// 切换移动端模拟
this.app.emulateMobile(!this.app.isMobile);
```

### 6.5 代码提示

如果使用无 Node.js 环境的方式开发，将 `obsidian.d.ts` 放入 `node_modules/obsidian/` 目录即可获得 TypeScript 代码提示。

---

## 7. 发布插件

### 7.1 发布要求

1. 在 GitHub 创建公开仓库
2. 包含 `manifest.json`、`main.js` 和 `README.md`
3. 遵循语义化版本控制
4. 通过 GitHub Release 发布新版本

### 7.2 发布流程

```bash
# 更新 manifest.json 中的 version
# 提交代码
git add .
git commit -m "v1.0.0"
git tag 1.0.0
git push origin main --tags
```

然后在 GitHub 上创建 Release，Obsidian 社区插件列表会自动抓取。

---

## 8. 常用资源

| 资源 | 链接 |
|------|------|
| 官方开发者文档（英文） | https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin |
| 中文开发者文档（社区维护） | https://luhaifeng666.github.io/obsidian-plugin-docs-zh/zh2.0/ |
| 示例插件仓库 | https://github.com/obsidianmd/obsidian-sample-plugin |
| Obsidian API 类型定义 | https://github.com/obsidianmd/obsidian-api |
| 官方 Discord（plugin-dev 频道） | Obsidian 官方 Discord 服务器 |
| 中文论坛 | https://forum-zh.obsidian.md/ |

---

## 9. 最佳实践

1. **使用专用开发库**：永远不要直接在主库中开发和测试插件
2. **使用 TypeScript**：类型安全减少运行时错误
3. **使用 `registerEvent()`**：确保事件在插件卸载时正确清理
4. **使用 `registerInterval()`**：确保定时器在插件卸载时清理
5. **版本控制**：使用 Git 管理代码
6. **语义化版本**：遵循 `主版本.次版本.补丁版本` 规范
7. **错误处理**：关键操作添加 try-catch
8. **国际化**：考虑多语言支持
