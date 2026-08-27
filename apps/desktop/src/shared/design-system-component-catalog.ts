import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { Type, type Static } from "@sinclair/typebox";

export const MAX_DESIGN_SYSTEM_CATALOG_COMPONENTS = 64;
export const MAX_DESIGN_SYSTEM_CATALOG_PROPERTIES = 12;
export const MAX_DESIGN_SYSTEM_CATALOG_CHARACTERS = 12_000;

const CatalogIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const ComponentIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const HumanTextSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]+$",
});
const CountSchema = Type.Integer({
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
});

export const DesignSystemComponentCatalogPropertySchema = Type.Object(
  {
    name: CatalogIdSchema,
    type: Type.Union([
      Type.Literal("BOOLEAN"),
      Type.Literal("TEXT"),
      Type.Literal("INSTANCE_SWAP"),
      Type.Literal("SLOT"),
    ]),
  },
  { additionalProperties: false },
);

export const DesignSystemComponentCatalogEntrySchema = Type.Object(
  {
    componentId: ComponentIdSchema,
    name: Type.String({
      minLength: 1,
      maxLength: 256,
      pattern: "^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]+$",
    }),
    description: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 240,
        pattern: "^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]+$",
      }),
    ),
    descriptionTruncated: Type.Optional(Type.Literal(true)),
    availability: Type.Union([
      Type.Literal("current-scope"),
      Type.Literal("design-file"),
    ]),
    usageCount: CountSchema,
    scopeUsageCount: CountSchema,
    variantSetId: Type.Optional(ComponentIdSchema),
    variantProperties: Type.Record(CatalogIdSchema, HumanTextSchema, {
      maxProperties: 12,
    }),
    properties: Type.Array(DesignSystemComponentCatalogPropertySchema, {
      maxItems: MAX_DESIGN_SYSTEM_CATALOG_PROPERTIES,
    }),
    propertiesTruncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DesignSystemComponentCatalogSchema = Type.Object(
  {
    totalCount: CountSchema,
    truncated: Type.Boolean(),
    components: Type.Array(DesignSystemComponentCatalogEntrySchema, {
      maxItems: MAX_DESIGN_SYSTEM_CATALOG_COMPONENTS,
    }),
  },
  { additionalProperties: false },
);

export type DesignSystemComponentCatalogEntry = Static<
  typeof DesignSystemComponentCatalogEntrySchema
>;
export type DesignSystemComponentCatalog = Static<
  typeof DesignSystemComponentCatalogSchema
>;

export const DesignSystemComponentCatalogContract =
  defineContract<DesignSystemComponentCatalog>({
    schema: DesignSystemComponentCatalogSchema,
    code: "design.component_catalog_structure_invalid",
    subject: "Design File component catalog",
    refine: componentCatalogDomainIssues,
    clone: false,
  });

export function isDesignSystemComponentCatalog(
  value: unknown,
): value is DesignSystemComponentCatalog {
  return DesignSystemComponentCatalogContract.parse(value).ok;
}

function componentCatalogDomainIssues(
  catalog: DesignSystemComponentCatalog,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (catalog.totalCount < catalog.components.length) {
    issues.push(
      issue(
        "design.component_catalog_total_count_invalid",
        "/totalCount",
        "totalCount cannot be smaller than the returned component list",
      ),
    );
  }
  if (catalog.truncated !== catalog.totalCount > catalog.components.length) {
    issues.push(
      issue(
        "design.component_catalog_truncation_invalid",
        "/truncated",
        "truncated must describe whether components omit catalog entries",
      ),
    );
  }
  if (
    JSON.stringify(catalog.components).length >
    MAX_DESIGN_SYSTEM_CATALOG_CHARACTERS
  ) {
    issues.push(
      issue(
        "design.component_catalog_budget_exceeded",
        "/components",
        "Serialized component catalog exceeds the inspection context budget",
      ),
    );
  }
  issues.push(...componentEntryDomainIssues(catalog.components));
  return issues;
}

function componentEntryDomainIssues(
  components: readonly DesignSystemComponentCatalogEntry[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const componentIndexById = new Map<string, number>();
  components.forEach((component, index) => {
    const path = `/components/${index}`;
    const existing = componentIndexById.get(component.componentId);
    if (existing !== undefined) {
      issues.push(
        issue(
          "design.component_catalog_component_duplicate",
          `${path}/componentId`,
          `Component ID is already used at /components/${existing}/componentId`,
        ),
      );
    } else {
      componentIndexById.set(component.componentId, index);
    }
    if (component.scopeUsageCount > component.usageCount) {
      issues.push(
        issue(
          "design.component_catalog_scope_usage_invalid",
          `${path}/scopeUsageCount`,
          "scopeUsageCount cannot exceed the Design File usageCount",
        ),
      );
    }
    if (component.descriptionTruncated && !component.description) {
      issues.push(
        issue(
          "design.component_catalog_description_invalid",
          `${path}/descriptionTruncated`,
          "descriptionTruncated requires a returned description",
        ),
      );
    }
    issues.push(...propertyNameDomainIssues(component, path));
  });
  return issues;
}

function propertyNameDomainIssues(
  component: DesignSystemComponentCatalogEntry,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const propertyIndexByName = new Map<string, number>();
  component.properties.forEach((property, index) => {
    const existing = propertyIndexByName.get(property.name);
    if (existing !== undefined) {
      issues.push(
        issue(
          "design.component_catalog_property_duplicate",
          `${path}/properties/${index}/name`,
          `Property name is already used at ${path}/properties/${existing}/name`,
        ),
      );
    } else {
      propertyIndexByName.set(property.name, index);
    }
  });
  return issues;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery:
      "Regenerate the component catalog from the current exact-revision Design File inspection.",
  };
}
