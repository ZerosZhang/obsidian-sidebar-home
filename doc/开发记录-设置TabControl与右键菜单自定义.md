# 开发记录：设置面板 TabControl + 右键菜单自定义

## 需求概述

1. 将插件设置界面从单页滚动改为 TabControl 双页布局
2. 新增右键菜单自定义功能，支持三个区域（文件资源管理器、编辑器、标签页标题）的菜单子项显示/隐藏

## 最终方案

### 设置界面 TabControl

- Tab 1「基础设置」：缓存/日记文件夹、页面路径、收藏夹管理
- Tab 2「标签页与菜单」：复用标签页、双击关闭、右键菜单配置

### 右键菜单拦截

- 使用 `MutationObserver` 监听 `document.body`，等待 `.menu` 元素出现
- 直接查询文档中的 `.menu-item` 元素进行发现和隐藏
- 隐藏后在同一回调中清理多余的分隔线

---

## 踩坑记录

### 错误 1：用 `requestAnimationFrame` + `menu.items` 操作 DOM

**做法**：在 `file-menu` 事件回调中用 `requestAnimationFrame` 延迟，然后遍历 `menu.items` 数组，通过 `item.dom` 设置 `style.display = 'none'`。

**问题**：`item.dom` 是**孤立的 DOM 节点**，尚未挂载到文档中。设置其 `style` 对文档中实际渲染的菜单无效。

**验证方式**：检查 `item.dom.parentElement` 返回 `undefined`，证明节点未挂载。

**解决**：放弃 `menu.items`，改用 `MutationObserver` 等菜单出现在文档后，直接查询文档中的 `.menu-item` 元素操作。

**教训**：`menu.items` 中的 `dom` 属性指向的是菜单内部创建的元素引用，但在 `showAtMouseEvent` 调用前，这些元素并未 append 到文档树中。不能假设 `requestAnimationFrame` 时菜单已挂载。

---

### 错误 2：用 `(menu as any).dom` 定位菜单容器

**做法**：通过 `menu.dom` 获取菜单的根 DOM 元素，再查找 `.menu-scroll` 清理分隔线。

**问题**：`menu.dom` 指向的元素并非文档中的 `.menu` 元素。调试日志显示 `menu.dom` 的 `children` 为空数组，而文档中的菜单有 9 个子元素。

**解决**：改为 `document.querySelectorAll('.menu')` 取最后一个（最新的菜单）。

**教训**：Menu 对象的内部属性和文档 DOM 是分离的。不要假设 `menu.dom` 等于文档中渲染的元素。

---

### 错误 3：只处理了 `file-explorer` 的 `source`

**做法**：`file-menu` 事件只检查 `source === 'file-explorer'`。

**问题**：标签页标题右键也触发 `file-menu` 事件，但 `source` 是 `'tab-header'`，导致标签页菜单不被拦截。

**调试方式**：添加 `console.log` 打印 `source` 参数，发现标签页右键时 `source` 为 `'tab-header'`。

**解决**：增加 `else if (source === 'tab-header')` 分支。

**教训**：`file-menu` 事件的 `source` 参数不仅限于 `'file-explorer'`，还可能是 `'tab-header'`、`'link-context-menu'` 等。需要测试不同场景。

---

### 错误 4：`onPaneMenu` 只对自身视图生效

**做法**：在 `SidebarHomeView` 中 override `onPaneMenu` 来拦截标签页菜单。

**问题**：`onPaneMenu` 是实例方法，只对当前 View 实例的面板菜单生效。右键 Markdown 编辑器的标签页时，调用的是 MarkdownView 的 `onPaneMenu`，不会触发 SidebarHomeView 的 override。

**解决**：改用 `file-menu` 事件 + `source === 'tab-header'` 来全局拦截。

**教训**：View 的 `onPaneMenu` 不是全局钩子，它只处理该 View 自身的面板菜单。要拦截所有标签页菜单，必须用 workspace 级别的事件。

---

### 错误 5：分隔线清理时 `isGroupEmpty` 检查直接子元素

**做法**：`isGroupEmpty` 用 `el.children` 检查 group 的直接子元素是否都隐藏。

**问题**：菜单结构是 `.menu-group > .menu-item`，但检查的是 `el.children`，其中可能包含非 `.menu-item` 的元素（如嵌套的 wrapper），导致 `every()` 逻辑错误。

**解决**：改为 `el.querySelectorAll('.menu-item')` 确保只检查菜单项。

**教训**：DOM 结构可能比预期更深。用 `querySelectorAll` 比 `children` 更可靠。

---

## 关键技术点

### Obsidian 菜单 DOM 结构

```html
<div class="menu" style="left: Xpx; top: Ypx;">
  <div class="menu-grabber"></div>
  <div class="menu-scroll">
    <div class="menu-group">
      <div class="menu-item tappable" data-section="...">
        <div class="menu-item-icon">...</div>
        <div class="menu-item-title">菜单项标题</div>
      </div>
    </div>
    <div class="menu-separator"></div>
    <div class="menu-group">...</div>
  </div>
</div>
```

### Menu 对象关键属性

- `menu.items`：MenuItem 数组，每个有 `dom` 属性（孤立 DOM 节点）
- `menu.dom`：Menu 的根元素引用（不一定等于文档中的元素）
- 菜单在 `showAtMouseEvent` 调用后才挂载到文档

### 事件 source 参数值

| 事件 | source 值 | 说明 |
|------|----------|------|
| `file-menu` | `'file-explorer'` | 文件资源管理器右键 |
| `file-menu` | `'tab-header'` | 标签页标题右键 |
| `file-menu` | `'link-context-menu'` | 链接右键 |
| `editor-menu` | - | 编辑器内容区右键 |

### 分隔线清理逻辑

需要处理的情况：
1. 首部/尾部的分隔线
2. 相邻的两个分隔线（保留一个）
3. 前后是隐藏项或空 group 的分隔线

检查方式：遍历 `.menu-scroll` 的直接子元素，对每个 `.menu-separator` 检查前后的兄弟元素状态。

---

### 错误 6：隐藏菜单项后菜单位置偏移（多次迭代）

**问题**：在屏幕偏下方右键时，Obsidian 将菜单向上翻转（底部对齐鼠标）。隐藏菜单项后高度变小，但 `top` 没变，导致菜单远离鼠标。

#### 尝试 1：强制 reflow

```typescript
menuStyle.style.display = 'none';
menuStyle.offsetHeight;
menuStyle.style.display = '';
```

**失败原因**：`top` 是显式内联样式，reflow 不会重新计算显式设置的 CSS 属性。

#### 尝试 2：MutationObserver + 手动调整 top

**失败原因**：MutationObserver 在菜单 append 到 DOM 时触发，但此时 Obsidian 尚未调用 `showAtPosition` 设置 `top/left`。调整被后续的定位覆盖。

#### 尝试 3：patch menu.showAtPosition

```typescript
const origShow = menu.showAtPosition.bind(menu);
menu.showAtPosition = (position) => {
    origShow(position);
    // 隐藏项 + 调整位置
};
```

**失败原因**：`showAtPosition` 可能不是实际的定位入口，或 `menu.dom` 在调用时还未就绪。

#### 尝试 4：MutationObserver + 50ms setTimeout

```typescript
setTimeout(() => doFilter(menuEl), 50);
```

**结果**：能正确工作，但有 50ms 延迟导致菜单闪烁，且翻转检测逻辑有 bug（`originalTop > originalBottom - height` 永远为 false）。

#### 最终方案：attributes observer + 鼠标位置追踪

**关键洞察**：
1. `childList` observer 触发太早（菜单未定位），需要等 Obsidian 设置 `style` 属性
2. 翻转检测不能靠位置推算，需要直接记录鼠标位置

```typescript
// 1. 持续记录鼠标位置
document.addEventListener('mousemove', (evt) => {
    this.lastMouseY = evt.clientY;
});

// 2. 监听 style 属性变化（Obsidian 设置 top/left 时立即触发，无延迟）
const observer = new MutationObserver(() => {
    const menuEl = document.querySelector('.menu');
    if (!menuEl?.style.top) return;
    observer.disconnect();

    // 3. 通过鼠标到菜单两端的距离判断翻转
    const flipped = Math.abs(lastMouseY - originalBottom) < Math.abs(lastMouseY - originalTop);

    // 4. 隐藏项 + 清理分隔线
    // ...

    // 5. 根据翻转模式重新定位
    if (flipped) {
        newTop = Math.max(0, lastMouseY - newHeight);  // 底部对齐鼠标
    } else {
        newTop = lastMouseY;  // 顶部对齐鼠标
        if (newTop + newHeight > viewportH) {
            newTop = Math.max(0, viewportH - newHeight);
        }
    }
    menuEl.style.top = `${newTop}px`;
});
observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });
```

**教训**：
1. `MutationObserver` 的 `childList` 在 DOM append 时触发，但框架可能在之后才设置定位属性。用 `attributes` + `attributeFilter: ['style']` 可以精确定位到样式设置的时机。
2. 不要用数学关系推算状态（`top > bottom - height` 永远为 false），直接从业务角度获取原始数据（鼠标位置）。
3. 绝对定位元素的 `top` 是显式样式，reflow 不会重新计算，必须手动设置。
