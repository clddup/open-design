import type { DesignDocument } from "@opendesign/design-contracts";
import {
  componentDefinition,
  componentSourceNode,
  componentSourceNodeIds,
  componentVariantSet,
  resolveComponentInstance,
} from "@opendesign/component-service";
import { validateVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import { validateVariableDocument } from "@opendesign/variable-service";
import { validateStyleDocument } from "@opendesign/style-service";
import {
  validateNodeLayoutInvariants,
  type DocumentInvariantIssue,
} from "./layout-document-invariants.js";
import { validateComponentPropertyOrder } from "./component-property-order.js";
import { hasSlotAncestor } from "./component-slot-support.js";
import { isBooleanOperandNode, isContainerNode } from "./node-semantics.js";
import { validateVariantSetInvariants } from "./variant-set-invariants.js";
import { validateLibrarySourceInvariants } from "./library-source-invariants.js";
import { hasOwn, jsonPointerToken, ownValue } from "./document-map-utils.js";
import { validateImageAssetDerivationInvariants } from "./image-asset-derivation-invariants.js";

export function validateDocumentInvariants(
  document: DesignDocument,
): DocumentInvariantIssue[] {
  const issues: DocumentInvariantIssue[] = [];
  const pageIds = new Set(document.pageOrder);

  for (const [pageId, page] of Object.entries(document.pagesById)) {
    if (page.id !== pageId) {
      issues.push({
        path: `/pagesById/${pageId}/id`,
        message: "page id must match its map key",
      });
    }
    if (!pageIds.has(pageId)) {
      issues.push({
        path: `/pagesById/${pageId}`,
        message: "page must be present in pageOrder",
      });
    }
  }

  for (const pageId of document.pageOrder) {
    if (!hasOwn(document.pagesById, pageId)) {
      issues.push({
        path: "/pageOrder",
        message: `page ${pageId} does not exist`,
      });
    }
  }

  for (const [assetId, asset] of Object.entries(document.assetsById)) {
    if (asset.id !== assetId) {
      issues.push({
        path: `/assetsById/${assetId}/id`,
        message: "asset id must match its map key",
      });
    }
  }
  issues.push(...validateImageAssetDerivationInvariants(document));

  const componentRoots = new Map<string, string>();
  for (const [componentId, component] of Object.entries(
    document.componentsById,
  )) {
    if (component.id !== componentId) {
      issues.push({
        path: `/componentsById/${componentId}/id`,
        message: "component id must match its map key",
      });
    }
    const root = ownValue(document.nodesById, component.rootNodeId);
    if (!root) {
      issues.push({
        path: `/componentsById/${componentId}/rootNodeId`,
        message: `component root ${component.rootNodeId} does not exist`,
      });
      continue;
    }
    if (root.kind !== "frame" && root.kind !== "group") {
      issues.push({
        path: `/componentsById/${componentId}/rootNodeId`,
        message: "component roots must be Frames or Groups",
      });
    }
    const existing = componentRoots.get(component.rootNodeId);
    if (existing) {
      issues.push({
        path: `/componentsById/${componentId}/rootNodeId`,
        message: `component root is already owned by ${existing}`,
      });
    }
    componentRoots.set(component.rootNodeId, componentId);
    issues.push(...validateComponentPropertyOrder(componentId, component));
    for (const [propertyName, definition] of Object.entries(
      component.componentPropertyDefinitions,
    )) {
      const markerIndex = propertyName.lastIndexOf("#");
      if (markerIndex <= 0 || markerIndex === propertyName.length - 1) {
        issues.push({
          path: `/componentsById/${componentId}/componentPropertyDefinitions/${propertyName}`,
          message:
            "Figma-compatible component property names require a label and stable # suffix",
        });
      }
      if (
        definition.type === "INSTANCE_SWAP" &&
        !componentDefinition(document, definition.defaultValue)
      ) {
        issues.push({
          path: `/componentsById/${componentId}/componentPropertyDefinitions/${propertyName}/defaultValue`,
          message: `component ${definition.defaultValue} does not exist`,
        });
      }
      if (definition.type === "INSTANCE_SWAP" || definition.type === "SLOT") {
        for (const [index, preferred] of (
          definition.preferredValues ?? []
        ).entries()) {
          const exists =
            preferred.type === "COMPONENT"
              ? componentDefinition(document, preferred.key)
              : componentVariantSet(document, preferred.key);
          if (!exists) {
            issues.push({
              path: `/componentsById/${componentId}/componentPropertyDefinitions/${propertyName}/preferredValues/${index}/key`,
              message: `preferred ${preferred.type} ${preferred.key} does not exist`,
            });
          }
        }
      }
      if (definition.type === "SLOT") {
        const slot = ownValue(document.nodesById, definition.defaultValue);
        if (
          slot?.kind !== "slot" ||
          slot.properties.sourceSlotId !== null ||
          !componentSourceNodeIds(document, componentId).has(slot.id) ||
          slot.id === component.rootNodeId
        ) {
          issues.push({
            path: `/componentsById/${componentId}/componentPropertyDefinitions/${propertyName}/defaultValue`,
            message:
              "SLOT defaultValue must reference a source Slot below the Component root",
          });
        }
        const { minChildren, maxChildren } = definition.slotSettings ?? {};
        if (
          minChildren != null &&
          maxChildren != null &&
          minChildren > maxChildren
        ) {
          issues.push({
            path: `/componentsById/${componentId}/componentPropertyDefinitions/${propertyName}/slotSettings`,
            message: "Slot minimum children must not exceed maximum children",
          });
        }
      }
    }
  }

  issues.push(...validateVariantSetInvariants(document));
  issues.push(...validateLibrarySourceInvariants(document));
  issues.push(...validateVariableDocument(document));
  issues.push(...validateStyleDocument(document));

  const sourceOwner = new Map<string, string>();
  for (const componentId of Object.keys(document.componentsById)) {
    for (const nodeId of componentSourceNodeIds(document, componentId)) {
      const existing = sourceOwner.get(nodeId);
      if (existing && existing !== componentId) {
        issues.push({
          path: `/componentsById/${componentId}/rootNodeId`,
          message: `component source ${nodeId} is already owned by ${existing}`,
        });
      }
      sourceOwner.set(nodeId, componentId);
    }
  }

  for (const [nodeId, node] of Object.entries(document.nodesById)) {
    if (node.id !== nodeId) {
      issues.push({
        path: `/nodesById/${nodeId}/id`,
        message: "node id must match its map key",
      });
    }
    if (!isContainerNode(node) && node.childIds.length > 0) {
      issues.push({
        path: `/nodesById/${nodeId}/childIds`,
        message: `${node.kind} nodes cannot contain children`,
      });
    }
    issues.push(...validateNodeLayoutInvariants(document, nodeId, node));
    if (node.componentPropertyReferences) {
      const componentId = sourceOwner.get(nodeId);
      const component = componentId
        ? ownValue(document.componentsById, componentId)
        : undefined;
      if (!component) {
        issues.push({
          path: `/nodesById/${nodeId}/componentPropertyReferences`,
          message: "component property references require a component sublayer",
        });
      } else {
        for (const [field, propertyName] of Object.entries(
          node.componentPropertyReferences,
        )) {
          const definition =
            component.componentPropertyDefinitions[propertyName];
          if (!definition) {
            issues.push({
              path: `/nodesById/${nodeId}/componentPropertyReferences/${field}`,
              message: `component property ${propertyName} does not exist on ${component.id}`,
            });
            continue;
          }
          const valid =
            (field === "visible" &&
              definition.type === "BOOLEAN" &&
              node.visible === definition.defaultValue) ||
            (field === "characters" &&
              node.kind === "text" &&
              definition.type === "TEXT" &&
              node.properties.content === definition.defaultValue) ||
            (field === "mainComponent" &&
              node.kind === "instance" &&
              definition.type === "INSTANCE_SWAP" &&
              node.properties.componentId === definition.defaultValue);
          if (!valid) {
            issues.push({
              path: `/nodesById/${nodeId}/componentPropertyReferences/${field}`,
              message: `component property ${propertyName} does not match ${field} or its default value`,
            });
          }
        }
      }
    }
    if (node.kind === "boolean") {
      if (node.childIds.length < 2) {
        issues.push({
          path: `/nodesById/${nodeId}/childIds`,
          message: "boolean nodes require at least two operands",
        });
      }
      for (const [index, childId] of node.childIds.entries()) {
        const child = ownValue(document.nodesById, childId);
        if (child && !isBooleanOperandNode(child)) {
          issues.push({
            path: `/nodesById/${nodeId}/childIds/${index}`,
            message: `${child.kind} nodes cannot be boolean operands`,
          });
        }
      }
    }
    if (node.kind === "image") {
      const asset = ownValue(document.assetsById, node.properties.assetId);
      if (!asset || asset.kind !== "image") {
        issues.push({
          path: `/nodesById/${nodeId}/properties/assetId`,
          message: `image asset ${node.properties.assetId} does not exist`,
        });
      }
    }
    if (node.kind === "instance") {
      for (const [index, childId] of node.childIds.entries()) {
        const child = ownValue(document.nodesById, childId);
        if (child?.kind !== "slot" || child.properties.sourceSlotId === null) {
          issues.push({
            path: `/nodesById/${nodeId}/childIds/${index}`,
            message:
              "Instance children must be explicit Slot override containers",
          });
        }
      }
      const duplicateOverridePaths = new Set<string>();
      for (const [index, override] of node.properties.overrides.entries()) {
        const key = JSON.stringify(override.sourcePath);
        if (duplicateOverridePaths.has(key)) {
          issues.push({
            path: `/nodesById/${nodeId}/properties/overrides/${index}/sourcePath`,
            message: "instance override source paths must be unique",
          });
        }
        duplicateOverridePaths.add(key);
      }
      const resolution = resolveComponentInstance(document, node.id);
      if (!resolution.ok) {
        for (const issue of resolution.issues) {
          issues.push({
            path: `/nodesById/${nodeId}/properties`,
            message: issue.message,
          });
        }
      }
    }
    if (node.kind === "slot") {
      if (node.properties.sourceSlotId === null) {
        const componentId = sourceOwner.get(node.id);
        const component = componentId
          ? ownValue(document.componentsById, componentId)
          : undefined;
        const definitions = component
          ? Object.values(component.componentPropertyDefinitions).filter(
              (definition) =>
                definition.type === "SLOT" &&
                definition.defaultValue === node.id,
            )
          : [];
        if (!component || definitions.length !== 1) {
          issues.push({
            path: `/nodesById/${nodeId}/properties/sourceSlotId`,
            message:
              "A source Slot must belong to exactly one Component SLOT property",
          });
        }
        if (hasSlotAncestor(document, node)) {
          issues.push({
            path: `/nodesById/${nodeId}/parentId`,
            message:
              "A source Slot cannot be nested inside another Slot; use a nested component Instance for composable Slot content",
          });
        }
      } else {
        const parent = node.parentId
          ? ownValue(document.nodesById, node.parentId)
          : undefined;
        const source =
          parent?.kind === "instance"
            ? componentSourceNode(
                document,
                parent.properties.componentId,
                node.properties.sourceSlotId,
              )
            : undefined;
        if (parent?.kind !== "instance") {
          issues.push({
            path: `/nodesById/${nodeId}/parentId`,
            message: "A Slot override must be a direct child of an Instance",
          });
        }
        if (
          source?.kind !== "slot" ||
          source.properties.sourceSlotId !== null
        ) {
          issues.push({
            path: `/nodesById/${nodeId}/properties/sourceSlotId`,
            message: `Slot source ${node.properties.sourceSlotId} does not exist`,
          });
        }
      }
    }
    if (
      (node.kind === "path" || node.kind === "vector") &&
      "network" in node.properties
    ) {
      for (const issue of validateVectorNetwork(node.properties.network)) {
        issues.push({
          path: `/nodesById/${nodeId}/properties/network${issue.path}`,
          message: issue.message,
        });
      }
    }
    if (
      node.kind === "frame" ||
      node.kind === "slot" ||
      node.kind === "rectangle" ||
      node.kind === "ellipse" ||
      node.kind === "line" ||
      node.kind === "polygon" ||
      node.kind === "star" ||
      node.kind === "text" ||
      node.kind === "path" ||
      node.kind === "vector" ||
      node.kind === "boolean"
    ) {
      for (const [paintIndex, paint] of [
        ...node.properties.fills,
        ...node.properties.strokes,
        ...(node.kind === "text"
          ? (node.properties.runs ?? []).flatMap((run) => run.style.fills)
          : []),
      ].entries()) {
        if (paint.type !== "image") continue;
        const asset = ownValue(document.assetsById, paint.assetId);
        if (!asset || asset.kind !== "image") {
          issues.push({
            path: `/nodesById/${nodeId}/properties/paints/${paintIndex}/assetId`,
            message: `image paint asset ${paint.assetId} does not exist`,
          });
        }
      }
    }
  }

  for (const [styleId, style] of Object.entries(document.stylesById)) {
    if (style.styleType !== "PAINT") continue;
    for (const [paintIndex, paint] of style.paints.entries()) {
      if (paint.type !== "image") continue;
      const asset = ownValue(document.assetsById, paint.assetId);
      if (!asset || asset.kind !== "image") {
        issues.push({
          path: `/stylesById/${jsonPointerToken(styleId)}/paints/${paintIndex}/assetId`,
          message: `image paint asset ${paint.assetId} does not exist`,
        });
      }
    }
  }

  const occurrences = new Map<string, string[]>();
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (
    nodeId: string,
    pageId: string,
    expectedParentId: string | null,
    path: string,
  ): void => {
    const node = ownValue(document.nodesById, nodeId);
    if (!node) {
      issues.push({ path, message: `node ${nodeId} does not exist` });
      return;
    }

    const locations = occurrences.get(nodeId) ?? [];
    locations.push(path);
    occurrences.set(nodeId, locations);
    if (visiting.has(nodeId)) {
      issues.push({ path, message: `node ${nodeId} creates a cycle` });
      return;
    }
    if (locations.length > 1) return;

    if (node.parentId !== expectedParentId) {
      issues.push({
        path: `/nodesById/${nodeId}/parentId`,
        message: `expected parent ${expectedParentId ?? "null"}`,
      });
    }
    if (visited.has(nodeId)) return;

    visiting.add(nodeId);
    for (const [index, childId] of node.childIds.entries()) {
      visit(
        childId,
        pageId,
        nodeId,
        `/pagesById/${pageId}/nodes/${nodeId}/childIds/${index}`,
      );
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const pageId of document.pageOrder) {
    const page = ownValue(document.pagesById, pageId);
    if (!page) continue;
    for (const [index, nodeId] of page.rootNodeIds.entries()) {
      visit(nodeId, pageId, null, `/pagesById/${pageId}/rootNodeIds/${index}`);
    }
  }

  for (const nodeId of Object.keys(document.nodesById)) {
    const locations = occurrences.get(nodeId) ?? [];
    if (locations.length === 0) {
      issues.push({
        path: `/nodesById/${nodeId}`,
        message: "node is not reachable from a page",
      });
    } else if (locations.length > 1) {
      issues.push({
        path: `/nodesById/${nodeId}`,
        message: "node appears more than once in the document tree",
      });
    }
  }

  return issues;
}
