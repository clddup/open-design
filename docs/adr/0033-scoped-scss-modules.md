# ADR-0033：Renderer 组件级 SCSS Modules 与全局样式收口

- 状态：已接受（新组件执行；历史全局样式按垂直切片迁移）
- 日期：2026-08-12

## 背景

Renderer 历史上把工作台、画布、Agent、属性面板和业务组件样式集中在一个超过三千行的 `styles.css` 中，只靠全局 BEM 命名避免碰撞。继续追加会放大覆盖顺序、删除影响面、组件所有权和窄窗口回归问题。Sass 预处理能力、CSS Modules 作用域和 CSS-in-JS 运行时方案解决的是不同问题，不能把是否使用其中一个简化为同一选择。

## 决策

新建或实质修改的 Renderer 业务组件采用 Vite 原生 CSS Modules 与固定 Dart Sass 编译器，即 `Component.module.scss`：

- CSS Modules 提供编译期 class 隔离和组件所有权；
- Sass 提供嵌套、partial、mixin 和编译期函数，不引入 Renderer 样式运行时；
- `@opendesign/ui` 继续拥有全局语义 design tokens、基础 primitive 和主题变量；
- 应用级 reset、窗口 shell、跨组件布局契约和确实全局的状态可留在小型全局入口；
- 高频画布几何、splitter 尺寸和动态坐标通过内联 CSS custom properties 传入 module，不通过 CSS-in-JS 重建样式表；
- 不同时引入另一套运行时 CSS-in-JS 方案。若后续需要强类型 recipe/variant，应单独以基准、包体和迁移 ADR 评估编译期方案。

历史 `styles.css` 不做高风险一次性重写。每个功能垂直切片迁出它实际修改的组件样式，并删除对应全局规则；最终全局文件只保留上述允许内容。禁止为了形式拆分成多个仍互相覆盖的全局 `.scss` 文件后宣称完成模块化。

## 结果与验证

- AssetsPanel 和 Canvas 新增拖放态作为首批 `*.module.scss`，没有继续向全局文件追加业务规则。
- `sass` 固定为 `1.102.0`，仅用于 Vite 编译期；许可记录进入第三方声明。
- TypeScript 通过 `vite/client` 读取 module 类型，Vite 生产构建验证 SCSS Modules 可编译和合并。
- 后续迁移需保持键盘/焦点、主题、窄窗口、Reduced Motion 和视觉状态测试；仅减少全局行数不构成完成证据。
