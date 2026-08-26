# ADR-0181：Provider 配置单一契约

状态：已接受

取代：ADR-0014 中仅用于开发期旧 Catalog 的迁移要求

## 背景

Conversation Provider Catalog、独立图片生成设置、保存/删除/连接测试请求与连接结果已经由同一 Main model service family 执行，但结构规则散落在 `desktop-api.ts`、`provider-connection.ts` 和 Host 迁移分支。字段、枚举、unknown-key、模型预算、reasoning capability、Provider/Model 唯一性、默认选择、URL、凭据动作与连接状态由多组手写判断重复维护；开发期 v1/v2/single-provider 迁移还继续扩大当前代码路径。产品尚未发布，不再保留这些旧开发格式的兼容读取。

## 决策

- `@opendesign/model-gateway/provider-config` 作为不加载 Provider runtime 的轻量入口，公开 canonical Model wire ID/text、API Format、Auth Mode、Reasoning Effort 与 Selection schemas；Model Gateway 主入口和 Provider 配置共同组合这些 schema，不复制协议枚举，也不把 `pi-ai` adapter 打进 Preload。
- `provider-config-contract-schemas.ts` 唯一拥有 Catalog/Profile/Model、保存/删除/测试请求、独立图片设置与 Provider connection result 的 executable shape。
- `provider-config-contract-domain.ts` 只处理 URL policy、timestamp、Provider/Model 唯一性、默认选择可用性、reasoning capability、凭据动作冲突、启用图片模型和 connection status/latency 关系。
- `provider-config-contract.ts` 是稳定 Contract facade；`desktop-api.ts` 只重导出类型与布尔 adapter，旧 `provider-connection.ts` 删除。
- Main 只读取当前 Catalog 和独立图片设置。删除 v1/v2 Catalog、single-provider settings 与旧图片选择的迁移分支及测试；当前配置 key、Main-only credential slots、Renderer 无凭据响应、三种模型协议 adapter、独立图片服务与 IPC channel 不变。

## 验证

Provider Contract、Desktop API、Main Model Service IPC、Model Provider Host 与 Image Generation Host 定向测试覆盖 sanitized response、Grok/GLM-compatible URL/model 配置、local HTTP、协议/auth、reasoning、默认选择、唯一性、凭据冲突、独立图片设置、连接状态、持久化、网络 adapter 和凭据隔离。Model Gateway/Desktop TypeScript、ESLint、Prettier 与 production build 覆盖公共 schema export 和 Main/Preload/Renderer bundle。
