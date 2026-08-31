# ADR-0235：首个真实画面直接使用规范外观语义

- 状态：Accepted
- 日期：2026-08-31
- DesignDocument：不变
- Agent 首切片契约：开发期破坏性更新
- 关联：ADR-0010、ADR-0073、ADR-0127、ADR-0143、ADR-0224、ADR-0233、ADR-0234

## 背景

OpenDesign 文档已经支持纯色、线性/径向/角度渐变、多填充与多描边、混合模式、阴影、光晕和模糊。但 compact first-slice 仍使用只含单个纯色 `fill/stroke` 的私有简化输入，再由 compiler 转成文档属性。模型因此无法在首个真实 revision 中直接表达已有的材料能力，只能堆叠多个纯色矩形模拟层次，既增加节点数量，也容易形成生硬的方块和渐变拼贴。

继续依赖后续完整工具补外观会增加 Provider 往返，让用户先等待一个低质量首稿，再等待 refinement。为每种效果增加独立工具则会扩大 catalog，并制造新的互斥入口，不符合统一事务方向。

## 决策

### 首切片复用文档外观事实

`opendesign_generate_first_slice` 的 Frame、Rectangle、Ellipse、Path 与 Text 直接使用节点级：

- `fills`、`strokes` 与 `strokeWidth`；
- `opacity` 与 `blendMode`；
- drop/inner shadow、outer glow、layer/background blur。

Paint 与 Effect 的首切片结构从 `@opendesign/design-contracts` 的规范 Schema 派生，而不是手写第二份字段、枚举或 union。Provider 投影只省略首稿不需要的变量绑定、单个 Paint/Effect 自身的可见性和局部混合模式；Runtime 仍通过同一个 Contract 入口解析并编译为完整 `DesignOperation`。

首切片不新增工具、不增加 Provider turn，也不要求先生成纯色稿再补材质。Image Paint 仍通过现有图片授权、内容寻址 asset 与 placement 工具进入文档，不能绕过资源边界塞入 compact payload。

### Group 不伪装 Shape

Group 继续只表达层级，不持有 Shape properties。为保持各节点公共输入紧凑，Provider 仍提交空 `fills/strokes` 与零 `strokeWidth`；domain refinement 对非空值返回准确字段路径，不允许 compiler 静默丢弃。Group 可以保留节点级 opacity、blend mode 与 effects。

### 可见材料必须实际可见

Frame、Shape、Path 与 Text 只有存在 fill 或 stroke 才算首切片材料。空 Group、空容器以及无 Paint 的 Text 不能满足“首个有意义可编辑内容”，避免结构合法但画布仍无变化。

## 后果

- 首个真实 revision 可以直接使用文档已有的规范材料能力，不再受纯色简化方言限制；
- 模型可用更少图层表达深度、光感与层次，但外观能力本身不保证构图、品牌概念或审美质量；
- Provider Schema 比纯色输入更大，因此使用从规范 Schema 派生的紧凑投影，并继续受生产固定协议预算约束；
- 图片、组件提升、独立视觉 Critic 与最终人工样张评估仍是独立阶段，不由本决策冒充完成。

## 验证

- Provider Schema 明确暴露 `fills/strokes/strokeWidth/blendMode/effects`，并与 Runtime 使用同一派生结构；
- 线性渐变、描边、节点混合模式、阴影、背景模糊和渐变文字编译后仍通过完整 Apply Contract；
- Group 的 fill、stroke 与非零 stroke width 在准确字段路径失败，节点级 effect 不被误拒绝；
- 无 Paint 的 Text 不再被当作可见材料；
- first-slice、Main handler、生产上下文预算测试以及 Desktop 类型检查、lint 和普通 build 通过。

## 参考

- Figma Plugin API `fills`：<https://developers.figma.com/docs/plugins/api/properties/nodes-fills/>
- Figma Plugin API `effects`：<https://developers.figma.com/docs/plugins/api/properties/nodes-effects/>
