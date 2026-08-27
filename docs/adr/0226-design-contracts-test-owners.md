# ADR-0226：Design Contracts Test Owners

## 状态

已接受。

## 背景

Design Contracts 生产入口和 owner 已完成分层，但 `index.test.ts` 仍聚集 3498 行 executable schema、Editor wire、版本迁移、节点外观、Vector、Layout、Transaction 和 Contract 测试。单一测试文件既超过项目 500 行边界，也使失败定位和 owner 变更范围不清晰。

## 决策

1. executable schema、Editor/version、Layout/Text、Style/Variable migration、Contract core、Vector、Appearance migration、Text/Component migration、Layout contract 与 Transaction contract 分别拥有独立测试文件。
2. `index-test-fixtures.ts` 只提供 actor、当前 Text document 与最小 operation 三个共享 fixture，不包含断言或建立第二份契约数据源。
3. 每个测试继续通过公共 `index.ts` 导入，验证外部消费者实际使用的稳定入口，而不是绕过 facade 测试内部实现。
4. 删除旧聚合文件，不保留重复套件；不新增源码数量、文件 hash 或测试数量门禁。

## 结果

- 3498 行聚合测试拆为十个 owner 测试文件和一个 90 行 fixture，最大文件 461 行。
- 加上既有 Design Quality 测试共 11 个测试文件、95 项测试，测试总数与拆分前一致。
- 测试失败可直接定位到 schema/contract owner，生产代码和公共 API 无变化。

## 验证

- `@opendesign/design-contracts` typecheck；
- 全部 Design Contracts tests：11 files、95 tests。
