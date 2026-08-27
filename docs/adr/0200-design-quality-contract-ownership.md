# ADR-0200：设计质量证据单一契约所有权

## 状态

已接受。

## 背景

设计目标质量策略、文字布局证据和最终布局质量报告组成同一条 Renderer capture → Main 校验 → Agent 交付链，但此前分别维护手写对象遍历、精确字段判断、union 分支和 Desktop Provider Schema。结构规则散落在 design-contracts、text-service、editor-runtime 与 Desktop，导致 Provider 可见输入、Renderer 产物和 Main 接收规则可能漂移，错误也无法稳定定位到具体 measurement 字段。

## 决策

1. design-contracts 唯一拥有 DesignTargetQualityProfileSchema/Contract。平台、交互模式、safe-area 字段、ID 数量和唯一性由 Schema 负责；相对目标 Frame 的 inset 几何关系是唯一 domain refinement。
2. Desktop 的 Plan 与 capture Provider Schema 直接复用上述权威 Schema，不再复制 graphic/ui union、枚举、字段和描述。
3. text-service 唯一拥有 TextLayoutQualityEvidenceSchema/Contract。measurement 按 status 选择 measured/unavailable 分支；结构由 Schema 负责，只保留跨数组 node ID 唯一性 refinement。
4. editor-runtime 的独立 layout-quality-contract.ts 唯一拥有 Layout Quality Report、Issue、Geometry 与 Measurement Schema。文字 measurement 直接组合 Text Service 的 measured Schema，quality profile 直接组合 Design Contracts Schema。
5. Layout Report 只保留 errorCount/warningCount 与 issue severity 一致性的 domain refinement。isDesignLayoutQualityReport() 和其他 isXxx 公共入口只能是 Contract 的薄布尔投影。
6. 删除三条链路中的 isRecord/exactKeys/safeText/isMeasurement 等重复结构遍历。现有报告与文字证据协议常量、capture identity、Main 权限和 exact-revision guard 不变，不建立兼容双写。

## 结果

- Provider、Renderer、Main 与 Agent 消费同一组可执行结构事实。
- measured/unavailable、measurement kind 和嵌套 geometry 的错误可定位到具体字段路径。
- 设计质量算法仍只负责生成事实，Contract 负责边界结构，Main 继续负责文档、Page、Frame、profile 与 revision 身份。
- 本切片删除旧结构代码，不增加 hash、源码数量、fixture 数量或其他仓库门禁。

## 验证

- Quality Profile 非法平台和 frame inset 关系返回准确路径。
- Text Evidence measured 分支缺字段与重复 node ID 返回准确路径。
- Layout Report 嵌套 measurement 缺字段与 error/warning count 漂移返回准确路径。
- 既有 Component projection、overflow、safe area、interaction、text clipping 与 128 条 issue 上限行为回归。
- Main capture 继续拒绝错误 document/revision/Page/Frame/profile 身份。
