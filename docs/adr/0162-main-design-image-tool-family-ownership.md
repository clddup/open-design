# ADR-0162：Main 设计图片工具族与编辑服务所有权

## 状态

已接受。

## 背景

`MainDesignToolRuntime` 已统一处理工具协议、授权、超时、取消和审计，`GlobalTaskCoordinator` 也已唯一持有 Plan、delivery、inspection、review 与 revision 规则。但 Main 入口仍直接实现 `read/generate/place/update/edit image` 的完整策略分发，以及去背景、提示词编辑、换背景、重打光、区域擦除/隔离、扩图和分辨率提升的像素准备与结果物化。

这使应用启动组合、Agent 工具策略和 Inspector 共用图片编辑能力挤在同一入口文件中。新增图片能力时必须同时理解 Electron 启动、Run 权限、Renderer 事务、Provider 调用和像素处理，无法由一个清晰 owner 独立测试。

## 决策

Main 图片能力分成两个完整 owner：

1. `DesignImageToolHandler` 拥有 Agent 图片工具族的策略编排：
   - 解析唯一公开 Contract；
   - 使用 Run-bound `AgentReferenceHost` 读取或物化图片；
   - 使用独立全局 `ImageGenerationHost` 调用外部图片服务；
   - 校验 Plan、Mutation Target、inspection、visual-review 与 delivery target；
   - 通过 internal typed tool 把 asset、Image node、derivation 和 supporting assets 写入唯一 Renderer/EditorRuntime；
   - 只在真实 revision 后推进 delivery。
2. `DesignImageEditService` 拥有 Agent 与 Inspector 共用的像素编辑流水线：
   - embedded raster 验证与尺寸解码；
   - Provider 输入规范化；
   - 区域 mask、扩图 canvas、原图保护合成与 upscale 尺寸；
   - 透明结果验证；
   - 内容寻址附件、`DesignAsset`、`ImageAssetDerivation` 与 supporting mask/reference asset 物化。
3. 两个 owner 通过窄依赖端口取得 Attachment、Reference 与 Image Generation host；不读取任意路径、凭据或 Renderer 状态。
4. `main/index.ts` 只构造服务、绑定依赖并把工具调用委托给 family handler，不再实现图片工具分支或像素算法。
5. 不改变 Provider tool 名称、schema、审批、Run 权限、图片服务配置、事务、revision、delivery 或错误语义；这是所有权迁移，不是兼容 facade 或第二条执行路径。

## 结果

- Main 入口从 2,330 行收缩到约 1,490 行；验收依据是图片策略和编辑生命周期已经有唯一 owner，而不是行数本身。
- Agent 与 Inspector 继续复用同一个图片编辑实现，不再通过入口级全局函数偶然共享。
- 图片工具仍复用 `MainDesignToolRuntime → GlobalTaskCoordinator → RendererDesignToolHost → EditorRuntime` 唯一链路。
- Main 其余 Page、Component、capture/review、import/export 等领域组合仍需继续迁出，因此 Phase 6 不标记完成。

## 验证

- 非图片工具不触发图片依赖。
- malformed image generation 在外部服务调用前返回准确 Contract 路径。
- image generation 经过 Plan 授权、Run attachment registration、Design File asset staging 和真实 revision 返回。
- image edit service 覆盖 Provider 路由、内容寻址结果、derivation、self-reference 与非 raster 拒绝。
- Desktop typecheck、定向 Vitest、ESLint、Prettier 与生产 Vite build 通过。
