import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeWorkspacePath,
  relativeWorkspacePath,
} from "./workspace-path.mjs";

describe("workspace path normalization", () => {
  it("normalizes Windows separators to canonical baseline paths", () => {
    assert.equal(
      normalizeWorkspacePath(
        "apps\\desktop\\src\\main\\agent\\global-task-coordinator.ts",
      ),
      "apps/desktop/src/main/agent/global-task-coordinator.ts",
    );
  });

  it("returns POSIX-style relative paths on every host", () => {
    assert.equal(
      relativeWorkspacePath(
        "/workspace/open-design",
        "/workspace/open-design/apps/desktop/src/main/index.ts",
      ),
      "apps/desktop/src/main/index.ts",
    );
  });
});
