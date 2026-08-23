import type { DesignOperation } from "@opendesign/design-contracts";
import {
  planAddVariantProperty,
  planRemoveVariantProperty,
  planRenameVariantProperty,
  planRenameVariantValue,
  planReorderVariantProperties,
  planReorderVariantValues,
  planSetVariantProperties,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useVariantMatrixActions({
  activePageId,
  applyCommands,
  runtime,
  setEditorError,
  t,
  transactionCounter,
}: {
  activePageId: string;
  applyCommands: (label: string, commands: DesignOperation[]) => boolean;
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}) {
  const execute = useCallback(
    (label: string, plan: ReturnType<typeof planAddVariantProperty>) => {
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(label, plan.commands);
    },
    [applyCommands, setEditorError],
  );

  const withSet = useCallback(
    <T>(
      create: (
        document: ReturnType<EditorRuntime["getSnapshot"]>["document"],
        variantSetId: string,
        operationId: string,
      ) => T,
    ): T | undefined => {
      const current = runtime.getSnapshot();
      const nodeId =
        current.state.selection.nodeIds.length === 1
          ? current.state.selection.nodeIds[0]
          : undefined;
      const set = nodeId
        ? Object.values(current.document.variantSetsById).find(
            (candidate) => candidate.rootNodeId === nodeId,
          )
        : undefined;
      return set
        ? create(
            current.document,
            set.id,
            `${Date.now()}_${++transactionCounter.current}`,
          )
        : undefined;
    },
    [runtime, transactionCounter],
  );

  return {
    onAddVariantProperty: (name: string) =>
      withSet((document, variantSetId, operationId) => {
        const members = Object.values(document.componentsById).filter(
          (component) => component.variantSetId === variantSetId,
        );
        execute(
          t("history.addVariantProperty"),
          planAddVariantProperty(document, {
            pageId: activePageId,
            variantSetId,
            propertyName: name,
            valuesByComponentId: Object.fromEntries(
              members.map((component) => [
                component.id,
                t("properties.defaultVariantValue"),
              ]),
            ),
            commandPrefix: `variant_property_add_${operationId}`,
          }),
        );
      }),
    onRenameVariantProperty: (propertyName: string, name: string) =>
      withSet((document, variantSetId, operationId) =>
        execute(
          t("history.renameVariantProperty"),
          planRenameVariantProperty(document, {
            pageId: activePageId,
            variantSetId,
            propertyName,
            name,
            commandPrefix: `variant_property_rename_${operationId}`,
          }),
        ),
      ),
    onReorderVariantProperties: (propertyOrder: readonly string[]) =>
      withSet((document, variantSetId, operationId) =>
        execute(
          t("history.reorderVariantProperties"),
          planReorderVariantProperties(document, {
            pageId: activePageId,
            variantSetId,
            propertyOrder,
            commandPrefix: `variant_property_reorder_${operationId}`,
          }),
        ),
      ),
    onRemoveVariantProperty: (propertyName: string) =>
      withSet((document, variantSetId, operationId) =>
        execute(
          t("history.removeVariantProperty"),
          planRemoveVariantProperty(document, {
            pageId: activePageId,
            variantSetId,
            propertyName,
            commandPrefix: `variant_property_remove_${operationId}`,
          }),
        ),
      ),
    onRenameVariantValue: (propertyName: string, value: string, name: string) =>
      withSet((document, variantSetId, operationId) =>
        execute(
          t("history.renameVariantValue"),
          planRenameVariantValue(document, {
            pageId: activePageId,
            variantSetId,
            propertyName,
            value,
            name,
            commandPrefix: `variant_value_rename_${operationId}`,
          }),
        ),
      ),
    onReorderVariantValues: (propertyName: string, values: readonly string[]) =>
      withSet((document, variantSetId, operationId) =>
        execute(
          t("history.reorderVariantValues"),
          planReorderVariantValues(document, {
            pageId: activePageId,
            variantSetId,
            propertyName,
            values,
            commandPrefix: `variant_value_reorder_${operationId}`,
          }),
        ),
      ),
    onSetVariantProperties: (
      componentId: string,
      variantProperties: Readonly<Record<string, string>>,
    ) =>
      withSet((document, variantSetId, operationId) =>
        execute(
          t("history.setVariantProperties"),
          planSetVariantProperties(document, {
            pageId: activePageId,
            variantSetId,
            componentId,
            variantProperties,
            commandPrefix: `variant_values_set_${operationId}`,
          }),
        ),
      ),
  };
}
