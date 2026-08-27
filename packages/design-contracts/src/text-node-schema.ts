import { Type, type TProperties, type TSchema } from "@sinclair/typebox";

interface TextNodeSchemaDependencies {
  fontFaceIdentityProperties: TProperties;
  paintSchema: TSchema;
  strokeAlignSchema: TSchema;
  strokeCapSchema: TSchema;
  strokeJoinSchema: TSchema;
  dashPatternSchema: TSchema;
}

export function createTextNodeSchemas<
  const TDependencies extends TextNodeSchemaDependencies,
>(dependencies: TDependencies) {
  const fontFaceIdentityProperties = dependency(
    dependencies,
    "fontFaceIdentityProperties",
  );
  const paintSchema = dependency(dependencies, "paintSchema");
  const strokeAlignSchema = dependency(dependencies, "strokeAlignSchema");
  const strokeCapSchema = dependency(dependencies, "strokeCapSchema");
  const strokeJoinSchema = dependency(dependencies, "strokeJoinSchema");
  const dashPatternSchema = dependency(dependencies, "dashPatternSchema");
  const TextRunsSchema = Type.Optional(
    Type.Array(
      Type.Object(
        {
          start: Type.Integer({ minimum: 0 }),
          end: Type.Integer({ minimum: 1 }),
          style: Type.Object(
            {
              ...fontFaceIdentityProperties,
              fontSize: Type.Number({ exclusiveMinimum: 0 }),
              letterSpacing: Type.Number(),
              lineHeight: Type.Number({ exclusiveMinimum: 0 }),
              textCase: textCaseSchema(),
              textDecoration: textDecorationSchema(),
              fills: Type.Array(paintSchema, { maxItems: 64 }),
              textStyleId: Type.Optional(
                Type.String({ minLength: 1, maxLength: 512 }),
              ),
              fillStyleId: Type.Optional(
                Type.String({ minLength: 1, maxLength: 512 }),
              ),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 16_384 },
    ),
  );
  const TextSharedProperties = {
    content: Type.String(),
    paragraphRuns: Type.Optional(
      Type.Array(paragraphRunSchema(), { maxItems: 16_384 }),
    ),
    runs: TextRunsSchema,
    ...fontFaceIdentityProperties,
    fontSize: Type.Number({ exclusiveMinimum: 0 }),
    lineHeight: Type.Number({ exclusiveMinimum: 0 }),
    letterSpacing: Type.Number(),
    paragraphIndent: Type.Number({ minimum: 0 }),
    paragraphSpacing: Type.Number({ minimum: 0 }),
    listSpacing: Type.Number({ minimum: 0 }),
    hangingList: Type.Boolean(),
    textCase: textCaseSchema(),
    textDecoration: textDecorationSchema(),
    textAlignHorizontal: Type.Union([
      Type.Literal("left"),
      Type.Literal("center"),
      Type.Literal("right"),
      Type.Literal("justify"),
    ]),
    textAlignVertical: Type.Union([
      Type.Literal("top"),
      Type.Literal("center"),
      Type.Literal("bottom"),
    ]),
    fills: Type.Array(paintSchema),
    strokes: Type.Array(paintSchema),
    strokeWidth: Type.Number({ minimum: 0 }),
    strokeAlign: strokeAlignSchema,
    strokeCap: strokeCapSchema,
    strokeJoin: strokeJoinSchema,
    dashPattern: dashPatternSchema,
  };
  const TextPropertiesSchema = Type.Union([
    Type.Object(
      {
        ...TextSharedProperties,
        textResize: Type.Literal("fixed"),
        textWrap: Type.Union([
          Type.Literal("none"),
          Type.Literal("word"),
          Type.Literal("character"),
        ]),
        textOverflow: Type.Union([
          Type.Literal("visible"),
          Type.Literal("clip"),
        ]),
        textTruncation: Type.Literal("disabled"),
        maxLines: Type.Null(),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TextSharedProperties,
        textResize: Type.Literal("fixed"),
        textWrap: Type.Union([
          Type.Literal("none"),
          Type.Literal("word"),
          Type.Literal("character"),
        ]),
        textOverflow: Type.Literal("clip"),
        textTruncation: Type.Literal("ending"),
        maxLines: Type.Union([Type.Null(), Type.Integer({ minimum: 1 })]),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TextSharedProperties,
        textResize: Type.Literal("auto-width"),
        textWrap: Type.Literal("none"),
        textOverflow: Type.Literal("visible"),
        textTruncation: Type.Literal("disabled"),
        maxLines: Type.Null(),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TextSharedProperties,
        textResize: Type.Literal("auto-width"),
        textWrap: Type.Literal("none"),
        textOverflow: Type.Literal("visible"),
        textTruncation: Type.Literal("ending"),
        maxLines: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TextSharedProperties,
        textResize: Type.Literal("auto-height"),
        textWrap: Type.Union([Type.Literal("word"), Type.Literal("character")]),
        textOverflow: Type.Literal("visible"),
        textTruncation: Type.Literal("disabled"),
        maxLines: Type.Null(),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TextSharedProperties,
        textResize: Type.Literal("auto-height"),
        textWrap: Type.Union([Type.Literal("word"), Type.Literal("character")]),
        textOverflow: Type.Literal("visible"),
        textTruncation: Type.Literal("ending"),
        maxLines: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
  ]);
  return { TextRunsSchema, TextSharedProperties, TextPropertiesSchema };
}

function paragraphRunSchema() {
  return Type.Object(
    {
      start: Type.Integer({ minimum: 0 }),
      end: Type.Integer({ minimum: 1 }),
      style: Type.Object(
        {
          listOptions: listOptionsSchema(),
          indentation: Type.Integer({ minimum: 0, maximum: 5 }),
          listSpacing: Type.Number({ minimum: 0 }),
          paragraphIndent: Type.Number({ minimum: 0 }),
          paragraphSpacing: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  );
}

function listOptionsSchema() {
  return Type.Object(
    {
      type: Type.Union([
        Type.Literal("none"),
        Type.Literal("ordered"),
        Type.Literal("unordered"),
      ]),
    },
    { additionalProperties: false },
  );
}

function textCaseSchema() {
  return Type.Union([
    Type.Literal("original"),
    Type.Literal("uppercase"),
    Type.Literal("lowercase"),
    Type.Literal("title-case"),
    Type.Literal("small-caps"),
  ]);
}

function textDecorationSchema() {
  return Type.Union([
    Type.Literal("none"),
    Type.Literal("underline"),
    Type.Literal("strikethrough"),
  ]);
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
