import { describe, expect, it } from "vitest";
import {
  AgentDesignIdAllocationContract,
  agentDesignNodeIdPrefix,
  createAgentDesignIdAllocation,
  isAgentDesignIdAllocation,
} from "./design-id-allocation";

describe("Agent design ID allocation", () => {
  it("derives one bounded stable new-node namespace per Run", () => {
    expect(agentDesignNodeIdPrefix("run_1787034969837_4")).toBe(
      "odr_run_1787034969837_4_",
    );
    expect(createAgentDesignIdAllocation("run_1")).toEqual({
      version: 1,
      scope: "run",
      newNodeIdPrefix: "odr_run_1_",
    });
  });

  it("rejects a namespace copied from another Run", () => {
    const allocation = createAgentDesignIdAllocation("run_1");
    expect(isAgentDesignIdAllocation(allocation, "run_1")).toBe(true);
    expect(isAgentDesignIdAllocation(allocation, "run_2")).toBe(false);
    expect(
      AgentDesignIdAllocationContract.issues(allocation, { runId: "run_2" }),
    ).toContainEqual(
      expect.objectContaining({
        code: "agent_design_id_allocation.run_mismatch",
        path: "/newNodeIdPrefix",
      }),
    );
  });

  it("rejects unknown structure before Run identity refinement", () => {
    expect(
      AgentDesignIdAllocationContract.issues(
        {
          ...createAgentDesignIdAllocation("run_1"),
          owner: "model",
        },
        { runId: "run_1" },
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/owner" })]),
    );
  });
});
