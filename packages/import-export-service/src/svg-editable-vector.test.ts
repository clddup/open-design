import type { VectorNetwork } from "@opendesign/design-contracts";
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
    ).toEqual({ status: "valid", network });
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
