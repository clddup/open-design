# ADR-0179：Media Input IPC 单一契约

状态：已接受

## 背景

Agent 附件选择/导入/预览与 Inspector Design Image 选择/编辑/取消已由 Main 的 `MediaInputIpcHost` 统一执行，但其 wire types 与全部结构/领域判断仍散落在 `desktop-api.ts`。附件 MIME/preview、内嵌 DesignAsset、图片编辑 action union、selection/expansion geometry、derivation 与 supporting asset 对应关系由大段手写分支维护，只能返回布尔结果，并持续放大通用 Desktop API 文件。

## 决策

- `media-input-contract-schemas.ts` 唯一拥有附件、预览、Design Image、编辑 request/result 与 cancel 的 executable wire shapes；图片编辑 request 只以 `action` 展开真实分支。
- `media-input-contract-domain.ts` 只处理跨字段/跨实体关系：preview MIME、内嵌可编辑 raster、source/reference identity、非空 prompt/expansion、result action/derivation/source/result identity，以及 supporting reference/mask 的数量、顺序和资产对应。
- `media-input-contract.ts` 是稳定 Contract facade；现有 `isAgentAttachmentXxx` 与 `isDesignImageXxx` 只作为布尔适配。`desktop-api.ts` 只重导出，不再拥有 media shape 或业务分支。
- DesignAsset、ImagePlacement、ImageLightingPreset、ImageAssetDerivation、NormalizedPoint 与 Size 直接组合 `@opendesign/design-contracts` canonical schemas，不复制文档模型。
- 不改变附件大小、内容寻址 ID、支持 MIME、图片 Provider、Main mask/reference 生成、编辑事务、IPC channel、sender 校验或 Renderer API，不增加路径、原始凭据或兼容双写。

## 验证

Desktop API、Media Input IPC、Agent Attachment Host、Design Image Edit Service 与 mask 定向测试覆盖附件 family、preview MIME、全部编辑 action、prompt/reference、selection/expansion、source/result/derivation/supporting identities、未知字段和稳定 issue path。Desktop TypeScript、ESLint、Prettier 与 production build 覆盖 Main/Preload/Renderer bundle。
