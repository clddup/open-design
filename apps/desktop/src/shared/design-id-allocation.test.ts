import { describe, expect, it } from "vitest";
import {
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
  });
});
