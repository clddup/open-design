import type { VectorNetwork } from "@opendesign/design-contracts";
import { vectorNetworkPointEditability } from "./vector-edit.js";
import { vectorNetworkSubset } from "./vector-network-subset.js";

export type SplitVectorNetworkResult =
  | {
      ok: true;
      networks: readonly VectorNetwork[];
      pathIds: readonly string[];
    }
  | {
      ok: false;
      code: "invalid-network" | "no-op" | "unsupported-topology";
      message: string;
    };

/** Splits one authored Vector Network into document-ordered path runs. */
export function splitVectorNetwork(
  network: VectorNetwork,
): SplitVectorNetworkResult {
  const editability = vectorNetworkPointEditability(network);
  if (!editability.editable) {
    return {
      ok: false,
      code: "invalid-network",
      message: editability.reason,
    };
  }
  if (network.paths.length < 2) {
    return {
      ok: false,
      code: "no-op",
      message: "Split vector requires at least two path runs",
    };
  }
  const compoundRegion = network.regions.find(
    (region) => new Set(region.loops.map((loop) => loop.pathId)).size > 1,
  );
  if (compoundRegion) {
    return {
      ok: false,
      code: "unsupported-topology",
      message: `Split vector cannot preserve compound region ${compoundRegion.id} across separate layers`,
    };
  }
  const pathIds = network.paths.map((path) => path.id);
  return {
    ok: true,
    pathIds,
    networks: pathIds.map((pathId) => vectorNetworkSubset(network, [pathId])),
  };
}
