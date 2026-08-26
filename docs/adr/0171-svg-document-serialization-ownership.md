# ADR-0171：SVG Document Serialization 所有权

## 状态

已接受。

## 背景

`svg-serialize.ts` 已统一 XML-safe ID、number 与 matrix attribute formatting，但公开 `exportSvg()` 仍直接创建 XML Document、写 root namespace/version/viewBox/width/height/title、插入 defs、调用 `XMLSerializer` 并检查输出预算。

这让 export orchestration 同时拥有文档结构和节点遍历。Appearance 与节点 family 只能假设 root/defs 的创建顺序，Document serialization 也无法在不执行完整 DesignDocument export 的情况下独立验证。

## 决策

1. `svg-serialize.ts` 是 SVG document serialization 的唯一 owner，负责：
   - 唯一 SVG namespace；
   - XML Document、root 与 detached defs 创建；
   - namespace、SVG 1.1 version、viewBox、width、height、OpenDesign interchange version 与 trimmed title；
   - defs 在输出前置插入；
   - `XMLSerializer` well-formed serialization、字符预算与结构化失败 issue。
2. `exportSvg()` 只验证公开 request、遍历已选 root 生成节点、检查累积 fidelity issue，并委托 serialize family 完成交付字符串。
3. Appearance 与 node orchestration 使用 serialize family 导出的同一 namespace 和标量 formatter，不复制 XML 常量或 formatter。
4. Serialize family 不读取 DesignDocument、不选择 root node、不生成 shape，也不解释 geometry、mask、paint 或 text。
5. 不改变公共 SVG API、版本、root/defs/title 顺序、viewBox、数字精度、字符预算或错误语义，不增加兼容 facade。

## 结果

- DOMImplementation、XMLSerializer、root metadata、defs insertion 与输出 budget 不再出现在聚合 `svg.ts`。
- Document serialization 可独立测试，Appearance 与节点导出共享同一 namespace。
- Phase 9 的 serialize family 收口完成；剩余节点/容器 import/export orchestration 仍需最终拆分。

## 验证

- Serialize 测试覆盖 root metadata、trimmed title、defs-first 顺序、XML 输出、安全 ID、数字和 matrix formatting。
- 完整 SVG 回归证明所有支持节点、defs、fidelity report 和 import/export 结果不变。
- Import/export package typecheck、定向 ESLint、Prettier 与 Desktop build 通过。
