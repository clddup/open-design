import type { AgentRequest } from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { resolveDeliveryScopeReview } from "./delivery-scope-review-policy.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

const request = (prompt: string): RunStartRequest => ({
  type: "run.start",
  runId: "run_scope_policy",
  sessionId: "conversation_scope_policy",
  prompt,
  documentId: "document_1",
  revision: 0,
  modelSelection: { providerId: "provider", modelId: "model" },
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
});

describe("delivery scope review policy", () => {
  it("keeps a focused screen or edit request direct", () => {
    expect(resolveDeliveryScopeReview(request("设计一个登录页面"))).toBe(
      "direct",
    );
    expect(
      resolveDeliveryScopeReview(request("调整当前按钮的间距和颜色")),
    ).toBe("direct");
  });

  it("requires review for document briefs and explicitly broad delivery", () => {
    expect(
      resolveDeliveryScopeReview({
        ...request("根据附件完成产品设计"),
        attachments: [
          {
            attachmentId: `file_${"a".repeat(64)}`,
            name: "requirements.md",
            mimeType: "text/markdown",
            byteSize: 4_096,
          },
        ],
      }),
    ).toBe("required");
    expect(
      resolveDeliveryScopeReview(request("请设计 12 个页面并逐页完成")),
    ).toBe("required");
    expect(
      resolveDeliveryScopeReview(
        request("需要：\n1. 登录\n2. 首页\n3. 报告\n4. 个人中心"),
      ),
    ).toBe("required");
  });

  it("does not insert another review into automatic continuation", () => {
    expect(
      resolveDeliveryScopeReview({
        ...request("继续完成 12 个页面"),
        continuation: {
          parentRunId: "run_parent",
          rootRunId: "run_parent",
          attempt: 1,
          maxAttempts: 3,
          reason: "incomplete",
        },
      }),
    ).toBe("direct");
  });
});
