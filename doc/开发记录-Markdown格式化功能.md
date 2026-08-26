# 开发记录：Markdown 格式化功能

## 需求概述

放弃 obsidian-linter 插件（功能臃肿、micromark 解析时有幻影 strong 节点 bug），在 Sidebar Home 中自建轻量 Markdown 格式化引擎。所有规则使用纯正则实现，不依赖 AST 解析。

### 功能清单

| 功能 | 说明 |
|------|------|
| 标记转换 | `**` → `<strong>`、`~~` → `<del>`、`[text](url)` → `[[url]]` |
| 弯引号替换 | `"text"` → `\u201ctext\u201d`（HTML 标签内不替换） |
| 未闭合标签移除 | 栈配对 `<tag>`/`</tag>`，删除孤立标签 |
| 标题层级递增 | `# → ## → ###`，幂等（仅存在 H1 时执行） |
| 前导空白清理 | 移除标题前的多余空格 |
| 中英文空格 | CJK + 英文/数字间自动插入空格 |
| 代码块默认语言 | 无语言标识的代码块开口 ` ``` ` 添加语言 |
| 列表 | 标记后空格、样式统一、移除列表间空行 |
| 引用块 | `>` → `> ` 统一加空格 |
| 空格清理 | 多余空格合并、全角符号空格、链接文本空格、段落前导空格 |
| 空行管理 | YAML 后空行、标题前后空行、块级结构后段落补空行、表格前后空行、合并连续空行 |
| 行尾处理 | 行尾空格、文档末尾换行 |
| YAML 时间戳 | 插入/更新创建和修改日期，无 YAML 时自动创建 |
| 占位保护 | wiki 链接 `[[...]]`、代码块、`<span>...</span>`、markdown 链接 URL 占位符保护，避免被后续规则修改 |
| 配置开关 | 设置页"格式化"Tab，每规则独立开关，保存时自动格式化 |

---

## 最终方案

### 架构设计

```
src/formatting/format.ts — 格式化引擎，27 条规则流水线 + 设置接口
src/settings.ts       — 扩展 FormatSettings 接口（27 个配置项）
src/ui/setting-tab.ts — 设置页「格式化」Tab，含每规则开关
src/main.ts            — 注册命令、保存时拦截（checkCallback 替换）、差异化文本替换
src/editor/format-hider.ts — HTML 标签隐藏 + 内容加格式（Decoration.mark + markerType）
src/tts/markdown-cleaner.ts — TTS 文本清洗器（修复 #tag 误伤 HTML 属性）
styles.css             — 新增 .sh-tag-bold/.sh-tag-strikethrough 等内联样式
```

### 规则流水线顺序

| 序号 | 字段 | 规则 | Phase |
|------|------|------|-------|
| 1 | markdownLinkToWiki | [text](url) → [[url]] | Phase 1 |
| 2 | wikiLinks 占位保护 | | Phase 1 |
| - | spanBlocks 占位保护 | `<span>...</span>` 内容不格式化（protectSpanText，默认开启） | Phase 1 前 |
| - | mdLinkUrls 占位保护 | 图片/外部链接 URL 不格式化 | Phase 1 前 |
| 3 | boldToStrong | ** → `<strong>` | Phase 1 |
| 4 | strikethroughToDel | ~~ → `<del>` | Phase 1 |
| 5 | smartQuotes | 弯引号替换 | Phase 1 |
| 6 | removeUnclosedTags | 移除未闭合 HTML | Phase 1 |
| 7 | headerIncrement | 标题层级+1 | Phase 2 |
| 8 | headingsStartLine | 标题前导空白 | Phase 2 |
| 9 | cjkSpacing | 中英文空格 | Phase 3 |
| 10 | codeFenceLanguage | 代码块默认语言 | Phase 4 |
| 11 | spaceAfterListMarkers | 列表标记后空格 | Phase 5 |
| 12 | unorderedListStyle | 无序列表样式 | Phase 5 |
| 13 | removeEmptyLinesBetweenListMarkers | 移除列表间空行 | Phase 5 |
| 14 | blockquoteStyle | 引用块样式 | Phase 6 |
| 15-21 | 空行管理 | YAML/标题/段落/表格/连续 | Phase 7 |
| 22-24 | 多余空格 | 多余空格/全角符号/链接文本/段落前导空格 | Phase 8 |
| 25-26 | 行尾处理 | 行尾空格/文档末尾换行 | Phase 9 |
| 27 | yamlTimestamp | YAML 时间戳 | Phase 10 |
| - | spanBlocks 还原 | 还原 span 占位符（外层先还原，内容可能含内层占位符） | Phase 9 后 |
| - | wikiLinks 还原 | 还原占位符 | Phase 9 后 |

### 保存时格式化

参照 obsidian-linter 实现（`obsidian-linter-master/src/main.ts:385-410`）：

```typescript
const saveCmd = (this.app as any).commands?.commands?.['editor:save-file'];
this.originalSaveCallback = saveCmd?.checkCallback;
saveCmd.checkCallback = (checking: boolean) => {
    if (checking) return this.originalSaveCallback(checking);
    this.originalSaveCallback(checking);
    // ... 格式化
};
```

### 差异化文本替换

参照 obsidian-linter 的 `diff-match-patch` 方式，找 old/new 文本的首尾公共前缀/后缀，只对中间差异部分做 CodeMirror `dispatch`，光标和滚动自然保留：

```typescript
let prefixLen = 0;
while (oldText[prefixLen] === newText[prefixLen]) prefixLen++;
let oldEnd = oldText.length, newEnd = newText.length;
while (oldText[oldEnd-1] === newText[newEnd-1]) { oldEnd--; newEnd--; }
cm.dispatch({
    changes: [{ from: prefixLen, to: oldEnd, insert: newText.slice(prefixLen, newEnd) }],
    filter: false,
});
```

---

## 踩坑记录

### 错误 1：段落空行被误删

**做法**：`removeSpaceAroundFullWidthChars` 使用 `\s+` 匹配全角符号周围的空白。

**问题**：`\s` 包含 `\n` 换行符，段落之间的 `\n\n` 被匹配后移除，整篇文档变成几个大段落。

**解决**：`\s` → `[ \t]`，并移至空行管理之后执行。

**教训**：空格清理规则不能匹配换行符。`[^\S\n]` 或 `[ \t]` 是安全替代。

---

### 错误 2：每格式化一次标题降一级

**做法**：`headerIncrement` 每次运行将所有标题行 `#` 数 +1。

**问题**：重复格式化导致标题无限递增（`# → ## → ### → ####`）。

**解决**：执行前 `hasH1` 检查文档是否存在 `# `（H1），不存在则跳过（说明已递增过）。

**教训**：涉及修改文档结构的规则必须幂等。用文档特征判断"是否已执行过"是最简单的方法。

---

### 错误 3：YAML 分隔符被破坏

**做法**：`spaceAfterListMarkers` 正则 `/^(\s*[-*+]|\s*\d+[.)])([^\s])/gm`。

**问题**：`---` 被当成减号列表，变成 `- --`。

**解决**：无序列表正则改为 `/^(\s*)([-*+])(?![ \t]*\2)([^\s])/gm`，`(?![ \t]*\2)` 排除水平线。

**教训**：正则匹配应该考虑上下文。列表标记的 `-`/`*` 和水平线的 `---`/`***` 用同一个字符，需要额外判断。

---

### 错误 4：YAML 内容被格式化

**做法**：所有规则对全文生效。

**问题**：YAML 日期 `2026年07月21日` 被 CJK 空格变成 `2026 年 07 月 21 日`。

**解决**：`formatMarkdown()` 开头提取 YAML frontmatter 隔离——正文走全套规则，YAML 仅走时间戳更新。

**教训**：元数据区域（YAML）不应被内容规则处理。提取-处理-合并模式是最佳实践。

---

### 错误 5：代码块闭合标签也被加语言

**做法**：正则 `/^```\s*$/gm` 匹配所有 ` ``` ` 行。

**问题**：开口和闭合的 ` ``` ` 都被添加语言标识。

**解决**：改为逐行状态机检测——`inCodeBlock` 标记进出，只给开口标签加语言。

**教训**：正则匹配时需要考虑结构性上下文，单行正则无法区分开口/闭合标记时，用状态机遍历更可靠。

---

### 错误 6：表格内被插入空行

**做法**：`emptyLineAroundTables` 在表格分隔行（`| --- | --- |`）上方插入空行。

**问题**：表头行（`| A | B |`）也是表格行，分隔行被错误识别为表格开始，在表头和分隔行之间插入空行。

**解决**：改为检测整个表格区块（连续 `|` 行）的边界，只在表格首行上方和末行下方添加空行。

**教训**：表格是连续多行的结构，行级判断要上升到区块级。

---

### 错误 7：wiki 链接被 CJK 空格破坏

**做法**：CJK 空格规则对全文生效。

**问题**：`[[MIBT 人格_xxx]]` 被插入空格，链接失效。

**解决**：格式化前将所有 `[[...]]` 替换为 `\u0000WIKI{n}\u0000` 占位符，跑完管道后还原。且占位保护必须在 `markdownLinkToWiki` 之后执行，以覆盖新产生的 wiki 链接。

**教训**：类似 YAML 隔离的思路，任何不应被格式化的结构化内容都需要占位保护。

---

### 错误 8：格式化后光标/页面跳动

**做法**：`editor.setValue(newText)` 全文替换。

**问题**：光标和滚动位置重置到文档开头。

**解决**：找 old/new 首尾公共前缀/后缀，只对中间差异部分做 CodeMirror `dispatch({ changes, filter: false })`。

**教训**：全文替换触发完整的编辑器重渲染。差异化替换只改变需要改的部分，性能更好、视觉更无感。

---

### 错误 9：Ctrl+S 不能触发格式化

**做法**：CodeMirror keymap 拦截 `Mod-s`（`Prec.high(keymap.of([...]))`）。

**问题**：Obsidian 内部也拦截该快捷键，按键被 Obsidian 先捕获。

**解决**：改为拦截 Obsidian 命令系统的 `editor:save-file` 命令的 `checkCallback` 属性（参照 obsidian-linter 的实现）。

**教训**：Obsidian 的键盘快捷键由内部命令系统控制，CodeMirror 层的按键拦截可能被跳过。直接 hook 命令的 `checkCallback` 是更可靠的方式。

---

### 错误 10：HTML 标签内容不显示格式

**做法**：`Decoration.replace({})` 隐藏标签，但标签内文字不加样式。

**问题**：`<strong>text</strong>` 标签隐藏了但 `text` 还是普通样式，没有粗体效果。

**解决**：用栈配对 `<tag>`/`</tag>`，对结对标签：
- 开标签：`Decoration.replace({ markerType: 'open' })`
- 闭标签：`Decoration.replace({ markerType: 'close' })`
- 内容：`Decoration.mark({ class: 'sh-tag-bold' })`

**教训**：`Decoration.replace` 只能隐藏/替换，不能加样式。给内容加样式需要用 `Decoration.mark`。`markerType` 指定后，CodeMirror 理解标签结构，光标可以正确穿入/选区可以跨越。

---

### 错误 11：smartQuotes 替换 HTML 属性内的引号

**做法**：弯引号正则 `/"([^"]*)"/g` 全局替换。

**问题**：`<font color="#ff0000">` 内的双引号被替换为弯引号，破坏了 HTML 标签属性。

**解决**：替换前先将所有 `<...>` HTML 标签替换为 `\u0000HTML{n}\u0000` 占位符，处理完引号后还原。

**教训**：内容格式化要保护结构化标记（HTML、wiki 链接等），先用占位符隔离、处理后还原。

---

### 错误 12：TTS 跳过 `<font>` 标签内文字

**做法**：`markdown-cleaner.ts` 先移除 `#tag` 再移除 HTML 标签。

**问题**：`<font color="#ff0000">text</font>` 中 `#ff0000"` 被 `#tag` 正则匹配，因 `>` 不在排除集中，匹配延伸到 `</font>` 后的 `。` 才停，吞掉全部内容。

**解决**：HTML 标签移除和 `#tag` 移除互换顺序——先删标签再删 tag。

**教训**：正则替换的顺序敏感。先用宽泛的规则清理结构化标记（如 HTML），再用精细规则处理内容（如 tag）。

---

### 错误 13：全角符号规则误删列表标记后的空格

**做法**：`removeSpaceAroundFullWidthChars` 用 `[ \t]+` 匹配全角符号前的空格并移除。

**问题**：`- "我最近有点累"` 中 `"` 是全角弯引号 `\u201c`，`-` 和 `"` 之间的空格被删除，导致列表结构 `- "xxx"` 变成 `-"xxx"`。

**解决**：先正常清理全角符号周围空格，再用单独的规则 `^([\t ]*(?:[-*+]|\d+[.)]))(全角符号)` 恢复列表标记后的空格。

**教训**：全角字符可能出现在结构化位置。清理规则后必须加保护性修复，按"先普遍清理、后针对恢复"策略。

---

### 错误 14：代码块内容被格式化

**做法**：格式化流水线对全文生效。

**问题**：多列布局（` ```col-md ` 块）、代码示例等所有 ` ``` ` 和 `~~~` 内的内容都被 CJK 空格、弯引号等规则修改。

**解决**：在 wiki 链接保护后，用 `(`{3,}|~{3,})([\s\S]*?)\1` 匹配所有代码块（支持 3+ 个反引号），替换为 `\u0000CODE{n}\u0000` 占位符，管道跑完再还原。

**教训**：代码块是 Markdown 中必须原样保留的结构，和 YAML、wiki 链接一样需要占位保护。正则 `{3,}` 确保 4+ 个反引号的多层嵌入场景也能正确处理。

---

### 错误 15：YAML 跳过标签在数组中不匹配

**做法**：`hasYamlTag` 正则 `(?:^|\s)tag(?:\s|$)` 要求标签前后必须是空格或行边界。

**问题**：`tags: [no-format, other]` 中 `[` 不是空格，`no-format` 前面的单词边界检测失败。

**解决**：`\s` 边界改为 `\b` 单词边界。`\b` 在 `[`（非单词符）和 `n`（单词符）之间成立，在 `t`（单词符）和 `,`（非单词符）之间也成立。

**教训**：YAML 数组语法 `[...]` 中标签可以紧邻方括号或逗号，用 `\b` 比 `\s` 更准确。

---

### 错误 16：格式化后仍有小概率跳页

**做法**：差异化替换用 `cm.dispatch` 替换 old/new 差异部分。

**问题**：格式化通常涉及全文多个位置变化，prefixLen/suffixLen 可能极短，中间差异覆盖几乎整个文档，CM6 的 dispatch 仍会触发视图重排。即使设了 `scrollIntoView: false`，事件循环中也可能有异步重排覆盖滚动。

**解决**：加双帧 `requestAnimationFrame` 恢复滚动。`dispatch` 前存 `scrollTop`，两帧后（等布局+绘制完成）设回 `cm.scrollDOM.scrollTop`。

**教训**：CM6 的视图更新是异步的，单帧或同步恢复滚动可能被后续渲染覆盖。双帧 `rAF` 是可靠的兜底方案。

---

### 错误 17：代码块反引号数量可变

**做法**：代码块保护正则 `(```|~~~)` 只匹配恰好 3 个标记。

**问题**：Obsidian 支持 4+ 个反引号和波浪线（如 ```` ```` `、```` ```col ````），这些被遗漏了。

**解决**：正则改为 `` (`{3,}|~{3,}) ``，配合 `\1` 回引确保开口闭口同类型同数量。

**教训**：Markdown 代码块的开口和闭口标记长度可变，保护规则要覆盖完整语法。

---

### 错误 18：markdown 链接 URL 被 CJK 空格破坏

**做法**：CJK 空格规则对全文生效；wiki 链接（`[[...]]`）已有占位保护，但 markdown 链接 `[text](url)` 不在保护范围内。

**问题**：`![](./assets/2026年08月17日_548.webp)` 被格式化为 `![](./assets/2026 年 08 月 17 日_548.webp)`，图片路径带空格导致引用失效。

**原因**：`markdownLinkToWiki` 用 `(?<!!)` 负向后行断言刻意跳过图片链接（不转换图片），因此图片/外部链接的 URL 裸露在管道中，被 CJK 空格规则（中文与数字间插入空格）改写。wiki 链接无此问题——`[[...]]` 和 `![[...]]` 从格式化开始就被整体占位保护。

**解决**：在代码块保护之后新增 markdown 链接 URL 占位保护，仅保护 `[text](` 与 `)` 之间的 URL 部分（`\u0000MDLINK{n}\u0000`），`[text]` 部分仍可被 `removeLinkSpacing` 处理；管道结束后还原。

```typescript
// 保护剩余 markdown 链接（图片、外部链接）的 URL 部分
const mdLinkUrls: string[] = [];
body = body.replace(/(\[[^\]]*\]\()([^)\s]+)/g, (_, prefix, url) => {
    mdLinkUrls.push(url);
    return prefix + `\u0000MDLINK${mdLinkUrls.length - 1}\u0000`;
});
```

**验证**：图片链接、带 alt 的图片链接、外部链接中文路径均原样保留；正文中"中文ABC"的空格插入不受影响；`[[]]` 系列本就被 WIKI 占位保护，无需改动。

**教训**：占位保护（错误 7 的思路）不应只覆盖 wiki 链接，凡含路径/引用的结构化语法（markdown 链接 URL 等）都要纳入。判断标准：**格式化不能改变任何会影响文档解析结果的内容**。

---

### 错误 19：粘贴文本的行首空格未被处理

**做法**：原以为格式化能自动清理从富文本/邮件复制的文本（每行前带 1 个空格）。

**问题**：格式化后行首空格保留——无任何规则处理"段落行首空格"，`headingsStartLine` 只管标题，`removeMultipleSpaces` 只合并连续 2+ 个空格，行首单个空格无人问津。

**解决**：新增规则 `removeLeadingSpaces`（清理段落前导空格，设置页可开关），只移除普通段落行首的 1-3 个空格，不干预空行：

```typescript
function removeLeadingSpaces(text: string): string {
	const lines = text.split('\n');
	const result: string[] = [];
	for (const line of lines) {
		// 列表/引用/标题/表格行保留行首缩进
		const isSpecial = /^\s*(?:[-*+]|\d+[.)])/.test(line) ||
			/^\s*>/.test(line) || /^\s*#{1,6}\s/.test(line) || line.includes('|');
		// 行首 1-3 个空格 + 非空白
		const m = line.match(/^ {1,3}(?=\S)/);
		if (!isSpecial && m) {
			result.push(line.slice(m[0].length));
		} else {
			result.push(line);
		}
	}
	return result.join('\n');
}
```

**为什么不顺带补空行**：初版曾对"行首有空格的段落行"自动补空行分段，但用户明确要求去掉该行为——段落是否分隔应由用户自己控制（`paragraphBlankLines` 只负责标题/列表等特殊块边界的空行，普通段落间留不留空行是用户的语义决策）。若规则自动补空行，用户便无法在特定位置保留连续段落。

**验证**：6 段粘贴文本 → 行首空格全部移除、空行保持不变；`<strong>` 标签保留；正常文档（无行首空格）不受影响。

**教训**：格式化规则只做"清理"，不替用户做"分段"这种语义决策。行首空格是粘贴痕迹，清理无副作用；空行是段落语义，应交给用户控制。

---



### 错误 20：代码块默认语言失效（被占位保护遮蔽）

**做法**：`codeFenceLanguage` 在 Phase 4 执行，给无语言代码块添加默认语言。

**问题**：功能失效——无语言代码块不再添加默认语言。

**原因**：错误 17 引入的代码块占位保护在 Phase 1 之前就把所有 ```` ``` ```` 代码块替换成 `\u0000CODE{n}\u0000` 占位符。`codeFenceLanguage` 在 Phase 4 扫描正文时，代码块早已是占位符，匹配不到 ```` ``` ````。

**解决**：将 `codeFenceLanguage` 调用移到代码块占位保护**之前**执行（wiki 链接保护之后、代码块保护之前）。占位保护的通用时序是"先转换、再保护、最后还原"，凡是在保护期需要看到的真实内容，都必须在保护前处理。

**验证**：无语言 ```` ``` ```` → 添加默认语言；已有语言 ```` ```js ```` → 不覆盖；默认语言为空 → 代码块内容保持原样不被格式化。

**教训**：占位保护是双刃剑——保护了不该改的内容，也让后续规则"看不见"它们。审查流水线时，任何处理目标在保护范围内的规则（如代码块默认语言）都要前移到保护之前。

---



### 错误 21：codeFenceLanguage 破坏 obsidian-columns 嵌套代码块

**做法**：codeFenceLanguage 用布尔状态（`inCodeBlock`）判断代码块开口/闭合。

**问题**：obsidian-columns 插件的 ```` ```col ```` 嵌套语法被破坏——内层子块闭合的 ```` ``` ```` 被误判为"无语言开口"，被加上默认语言变成 ```` ```csharp ````。

**原因**：```` ```col ```` 是嵌套代码块（外层 `col` 包内层 `col-md`），布尔状态机无法区分"有语言块自成一体"与"嵌套闭合"。有语言的行被当成开口/闭合切换状态后状态错位，内层的 ```` ``` ```` 被当成新开口。

**解决**：改用栈追踪嵌套层级——有语言标识的行压栈，无语言的 ```` ``` ```` 行闭合栈顶；栈空时无语言的 ```` ``` ```` 才视为新的无语言开口并添加默认语言。

**验证**：obsidian-columns 嵌套结构保持原样；普通无语言代码块仍加默认语言；已有语言块不覆盖；默认语言为空时不变。

**教训**：代码块的开口/闭合配对必须理解嵌套。布尔状态机只适合无嵌套场景，遇到扩展语法（如 obsidian-columns）要改用栈。

---

## 关键技术点

### YAML 隔离模式

```
原始文本
  → 提取 YAML（---...---）
  → 正文 = 格式化流水线(正文)
  → YAML = yamlTimestamp(YAML)
  → 合并返回
```

### 占位保护模式

```
正文
  → wikiLinks.replace(/\[\[.+?\]\]/g, '\u0000WIKI{n}\u0000')
  → codeBlocks.replace(/(`{3,}|~{3,})([\s\S]*?)\1/g, '\u0000CODE{n}\u0000')
  → 格式化流水线(正文)
  → codeBlocks.restore()
  → wikiLinks.restore()
```

同一个模式在 smartQuotes 中保护 HTML 标签：

```
正文
  → text.replace(/<[^>]+>/g, '\u0000HTML{n}\u0000')
  → 弯引号替换
  → text.replace(/\u0000HTML{n}\u0000/g, 还原)
```

### HTML 标签内容格式化（CM6）

```
┌──────────────────────────────────────────────────┐
│  全文扫描 <strong> 和 </strong> 等标签位置       │
│                    ↓                              │
│  栈匹配：<strong> 压栈，</strong> 配对出栈       │
│                    ↓                              │
│  配对成功 →                                    │
│    开标签: Decoration.replace({markerType:'open'})│
│    闭标签: Decoration.replace({markerType:'close'})│
│    内容:   Decoration.mark({class:'sh-tag-bold'}) │
│  配对失败 →                                    │
│    孤标签: Decoration.replace({}) 移除           │
└──────────────────────────────────────────────────┘
```

### Edge-TTS 返回帧解析

WebSocket 接收帧后先解析 X-RequestId/Path headers，然后：
- `Path:turn.start` → 标记 TTS 开始
- `Path:audio` → 二进制音频帧，headerLen 字节头部后是 mp3 数据
- `Path:turn.end` → 标记 TTS 结束，合并所有音频块

每个二进制帧前 128 字节是元数据 headers，之后为纯音频。使用 `Buffer.concat` 累积后生成 ArrayBuffer 传给 Web Audio API 播放。


