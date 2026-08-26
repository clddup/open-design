# ADR-0167：SVG 导入 Parse Family 所有权

## 状态

已接受。

## 背景

`@opendesign/import-export-service` 已把 Text、Filter、Mask/Clip、Editable Vector、Line Endpoint 和 Regular Shape 等语义迁入独立 family，但 `svg.ts` 仍同时承担不可信 XML 入口、视口解析、语义导入、保真报告和序列化。继续在聚合文件内扩展会让输入安全、结构预算与后续语义转换耦合，也无法独立证明恶意 XML 会在创建任何可编辑节点前被拒绝。

Phase 9 按完整业务所有权逐步收缩 SVG service；本切片只迁移 parse 边界，不借机重写 normalize、fidelity 或 serialize。

## 决策

1. `svg-parse.ts` 是 SVG 字符串进入 XML DOM 和源 viewport 的唯一 parse owner，负责：
   - SVG 字符预算与安全 `idPrefix`；
   - DOCTYPE/ENTITY、脚本、`foreignObject`、stylesheet、`use`、事件属性和引用属性拒绝；
   - XML parse error、`<svg>` 根元素、XML element/depth budget；
   - 有限正值 `viewBox` 或 `width`/`height` 解析。
2. Parse family 返回已验证的 root、owner document 和 source viewport；`svg.ts` 只消费该结果，不保留第二条 DOM parse、结构检查或 length parse 路径。
3. Parse family 不负责：
   - SVG 节点到 OpenDesign 节点的语义转换；
   - transform、style、paint、gradient、filter、mask、text 或 vector normalize；
   - fidelity issue accumulation；
   - SVG defs、document 和 XML serialization。
4. 本切片不改变公开 `importSvg`/`exportSvg` API、`SVG_INTERCHANGE_VERSION`、既有 issue code、预算数值或失败语义，也不增加兼容 facade。
5. `svg.ts` 暂时继续作为 import/export orchestration。Normalize、fidelity、appearance 与 serialize family 完成迁移后，才能关闭 Phase 9。

## 结果

- 不可信 XML 在进入语义 import 前由一个可独立测试的 owner 拒绝。
- 输入预算、root 和 viewport 不再与 2,000 余行语义导入/导出实现混杂。
- 既有 format family 保持独立，后续迁移不需要重新合并或复制 parse 规则。
- Phase 9 仍保持开放，不能把本切片描述为 SVG service 已完成收口。

## 验证

- Parse family 覆盖正常 SVG、`px` viewport、空输入、非法 prefix、DOCTYPE、错误 root、错误 viewport、脚本/style/use/event/reference 与深度预算。
- 既有 SVG import/export 回归证明公共结果、issue code 和语义未改变。
- Import/export package typecheck、定向 lint、格式与 Desktop build 通过。
