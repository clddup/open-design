import type { VectorNetwork } from "@opendesign/design-contracts";
import { serializeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import {
  reverseVectorPath,
  setVectorPathClosed,
} from "@opendesign/geometry-service/vector-edit";
import { DOMImplementation } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  readSvgEditableVector,
  writeSvgEditableVector,
} from "./svg-editable-vector.js";

const network: VectorNetwork = {
  vertices: [
    { id: "vertex_a", x: 0, y: 0 },
    { id: "vertex_b", x: 100, y: 0 },
    { id: "vertex_c", x: 50, y: 100 },
  ],
  segments: [
    {
      id: "segment_ab",
      startVertexId: "vertex_a",
      endVertexId: "vertex_b",
      tangentStart: { x: 25, y: 0 },
      tangentEnd: { x: -25, y: 0 },
    },
    {
      id: "segment_bc",
      startVertexId: "vertex_b",
      endVertexId: "vertex_c",
    },
    {
      id: "segment_ca",
      startVertexId: "vertex_c",
      endVertexId: "vertex_a",
    },
  ],
  paths: [
    {
      id: "path_1",
      closed: true,
      segments: [
        { segmentId: "segment_ab", reversed: false },
        { segmentId: "segment_bc", reversed: false },
        { segmentId: "segment_ca", reversed: false },
      ],
    },
  ],
  regions: [
    {
      id: "region_1",
      windingRule: "nonzero",
      loops: [{ pathId: "path_1", reversed: false }],
    },
  ],
};

function pathElement(): Element {
  const document = new DOMImplementation().createDocument(
    "http://www.w3.org/2000/svg",
    "svg",
    null,
  );
  const element = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  element.setAttribute("data-opendesign-kind", "vector");
  return element;
}

describe("controlled editable-vector SVG metadata", () => {
  it("round-trips a schema-valid network whose path remains unchanged", () => {
    const element = pathElement();
    expect(writeSvgEditableVector(element, network)).toBe(true);

    expect(
      readSvgEditableVector(
        element,
        "M 0 0 C 25 0 75 0 100 0 L 50 100 L 0 0 Z",
      ),
    ).toEqual({ status: "valid", fallbackFills: [], network });
    expect(element.getAttribute("data-opendesign-vector-network-version")).toBe(
      "6",
    );
  });

  it("round-trips radius and smoothing without persisting projected points", () => {
    const rounded = structuredClone(network);
    rounded.vertices[2]!.cornerRadius = 8;
    const serialized = serializeVectorNetwork(rounded, 6, 0.6);
    if (!serialized.ok) throw new Error("Rounded path did not serialize");
    const element = pathElement();

    expect(writeSvgEditableVector(element, rounded, [], 6, 0.6)).toBe(true);
    expect(readSvgEditableVector(element, serialized.path)).toEqual({
      status: "valid",
      cornerRadius: 6,
      cornerSmoothing: 0.6,
      fallbackFills: [],
      network: rounded,
    });
    expect(
      element.getAttribute("data-opendesign-vector-network"),
    ).not.toContain("__corner_");
  });

  it("continues to read version 5 radius metadata with zero smoothing", () => {
    const rounded = structuredClone(network);
    rounded.vertices[2]!.cornerRadius = 8;
    const serialized = serializeVectorNetwork(rounded, 6);
    if (!serialized.ok) throw new Error("Rounded path did not serialize");
    const element = pathElement();
    expect(writeSvgEditableVector(element, rounded, [], 6)).toBe(true);
    element.setAttribute("data-opendesign-vector-network-version", "5");
    element.removeAttribute("data-opendesign-vector-corner-smoothing");

    expect(readSvgEditableVector(element, serialized.path)).toEqual({
      status: "valid",
      cornerRadius: 6,
      fallbackFills: [],
      network: rounded,
    });
  });

  it("exports resolved region Paints without persisting document-local Style links", () => {
    const styled = structuredClone(network);
    styled.regions[0]!.fillStyleId = "brand-accent";
    styled.regions[0]!.fills = [
      { type: "solid", color: "#7c3aed", opacity: 1 },
    ];
    const element = pathElement();

    expect(writeSvgEditableVector(element, styled)).toBe(true);
    const result = readSvgEditableVector(
      element,
      "M 0 0 C 25 0 75 0 100 0 L 50 100 L 0 0 Z",
    );

    expect(result).toMatchObject({
      status: "valid",
      network: {
        regions: [
          {
            fills: [{ type: "solid", color: "#7c3aed", opacity: 1 }],
          },
        ],
      },
    });
    if (result.status !== "valid") throw new Error("Missing vector metadata");
    expect(result.network.regions[0]).not.toHaveProperty("fillStyleId");
    expect(
      element.getAttribute("data-opendesign-vector-network"),
    ).not.toContain("fillStyleId");
  });

  it("round-trips vertex-local stroke appearance metadata", () => {
    const styled = structuredClone(network);
    styled.vertices[0]!.strokeCap = "round";
    styled.vertices[1]!.strokeJoin = "bevel";
    const element = pathElement();

    expect(writeSvgEditableVector(element, styled)).toBe(true);
    expect(
      readSvgEditableVector(
        element,
        "M 0 0 C 25 0 75 0 100 0 L 50 100 L 0 0 Z",
      ),
    ).toEqual({ status: "valid", fallbackFills: [], network: styled });
  });

  it("continues to read version 1 metadata without inventing handle modes", () => {
    const element = pathElement();
    expect(writeSvgEditableVector(element, network)).toBe(true);
    element.setAttribute("data-opendesign-vector-network-version", "1");

    expect(
      readSvgEditableVector(
        element,
        "M 0 0 C 25 0 75 0 100 0 L 50 100 L 0 0 Z",
      ),
    ).toEqual({ status: "valid", fallbackFills: [], network });
  });

  it("continues to read version 2 metadata without requiring fallback fills", () => {
    const element = pathElement();
    expect(writeSvgEditableVector(element, network)).toBe(true);
    element.setAttribute("data-opendesign-vector-network-version", "2");
    element.removeAttribute("data-opendesign-vector-fallback-fills");

    expect(
      readSvgEditableVector(
        element,
        "M 0 0 C 25 0 75 0 100 0 L 50 100 L 0 0 Z",
      ),
    ).toEqual({ status: "valid", fallbackFills: [], network });
  });

  it("round-trips open/closed and reversed traversal semantics exactly", () => {
    const reversed = reverseVectorPath(network);
    if (!reversed.ok) throw new Error(reversed.message);
    const reversedPath = serializeVectorNetwork(reversed.network);
    if (!reversedPath.ok) throw new Error("Reversed path did not serialize");
    const reversedElement = pathElement();
    expect(writeSvgEditableVector(reversedElement, reversed.network)).toBe(
      true,
    );
    expect(readSvgEditableVector(reversedElement, reversedPath.path)).toEqual({
      status: "valid",
      fallbackFills: [],
      network: reversed.network,
    });
    expect(reversed.network.regions[0]?.loops[0]?.reversed).toBe(true);

    const opened = setVectorPathClosed(network, false);
    if (!opened.ok) throw new Error(opened.message);
    const openPath = serializeVectorNetwork(opened.network);
    if (!openPath.ok) throw new Error("Open path did not serialize");
    const openElement = pathElement();
    expect(writeSvgEditableVector(openElement, opened.network)).toBe(true);
    expect(readSvgEditableVector(openElement, openPath.path)).toEqual({
      status: "valid",
      fallbackFills: [],
      network: opened.network,
    });
    expect(opened.network.paths[0]?.closed).toBe(false);
    expect(opened.network.regions).toEqual([]);
  });

  it("removes stale controlled metadata when the current network exceeds the limit", () => {
    const element = pathElement();
    expect(writeSvgEditableVector(element, network)).toBe(true);
    const oversized = structuredClone(network);
    oversized.vertices[0]!.id = "vertex_" + "x".repeat(1_000_000);

    expect(writeSvgEditableVector(element, oversized)).toBe(false);
    expect(element.hasAttribute("data-opendesign-vector-network-version")).toBe(
      false,
    );
    expect(element.hasAttribute("data-opendesign-vector-network")).toBe(false);
    expect(element.hasAttribute("data-opendesign-vector-fallback-fills")).toBe(
      false,
    );
    expect(element.hasAttribute("data-opendesign-vector-corner-radius")).toBe(
      false,
    );
  });

  it("rejects missing versions, malformed topology, and changed path data", () => {
    const element = pathElement();
    expect(writeSvgEditableVector(element, network)).toBe(true);
    element.removeAttribute("data-opendesign-vector-network-version");
    const missingVersion = readSvgEditableVector(element, "M 0 0");
    expect(missingVersion.status).toBe("invalid");
    if (missingVersion.status === "invalid") {
      expect(missingVersion.message).toContain("version");
    }

    expect(writeSvgEditableVector(element, network)).toBe(true);
    const changedPath = readSvgEditableVector(element, "M 0 0 L 100 0");
    expect(changedPath.status).toBe("invalid");
    if (changedPath.status === "invalid") {
      expect(changedPath.message).toContain("does not match");
    }

    const invalidNetwork = structuredClone(network);
    invalidNetwork.paths[0]!.segments[1]!.segmentId = "missing_segment";
    expect(writeSvgEditableVector(element, invalidNetwork)).toBe(true);
    const invalidTopology = readSvgEditableVector(element, "M 0 0");
    expect(invalidTopology.status).toBe("invalid");
    if (invalidTopology.status === "invalid") {
      expect(invalidTopology.message).toContain("topology");
    }
  });
});
