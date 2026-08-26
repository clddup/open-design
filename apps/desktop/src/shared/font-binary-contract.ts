import { Type } from "@sinclair/typebox";
import { defineContract, type ValidationIssue } from "./contract-validation";

const FontBinaryIdSchema = Type.String({
  pattern: "^font_[a-f0-9]{64}$",
});
const FontBinaryNameSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const FontBinaryByteSizeSchema = Type.Integer({
  minimum: 12,
  maximum: 32 * 1024 * 1024,
});
const FontBinaryFormatSchema = Type.Union([
  Type.Literal("otf"),
  Type.Literal("ttc"),
  Type.Literal("ttf"),
]);

export const FontBinaryDescriptorSchema = Type.Object(
  {
    byteSize: FontBinaryByteSizeSchema,
    fontId: FontBinaryIdSchema,
    format: FontBinaryFormatSchema,
    name: FontBinaryNameSchema,
  },
  { additionalProperties: false },
);

export const FontBinaryPayloadSchema = Type.Object(
  {
    ...FontBinaryDescriptorSchema.properties,
    bytes: Type.Uint8Array(),
  },
  { additionalProperties: false },
);

export const FontBinaryReadRequestSchema = Type.Object(
  { fontId: FontBinaryIdSchema },
  { additionalProperties: false },
);

export type FontBinaryDescriptor = {
  byteSize: number;
  fontId: `font_${string}`;
  format: "otf" | "ttc" | "ttf";
  name: string;
};

export type FontBinaryPayload = FontBinaryDescriptor & {
  bytes: Uint8Array;
};

export type FontBinaryReadRequest = { fontId: `font_${string}` };

export const FontBinaryDescriptorContract =
  defineContract<FontBinaryDescriptor>({
    schema: FontBinaryDescriptorSchema,
    code: "font_binary_descriptor.schema_invalid",
    subject: "font binary descriptor",
    clone: false,
  });

export const FontBinaryPayloadContract = defineContract<FontBinaryPayload>({
  schema: FontBinaryPayloadSchema,
  code: "font_binary_payload.schema_invalid",
  subject: "font binary payload",
  clone: false,
  refine: (value) =>
    value.bytes.byteLength === value.byteSize
      ? []
      : [
          issue(
            "font_binary_payload.byte_size_mismatch",
            "/bytes",
            "Font binary byte length must match the declared byteSize",
            value.byteSize,
            value.bytes.byteLength,
          ),
        ],
});

export const FontBinaryReadRequestContract =
  defineContract<FontBinaryReadRequest>({
    schema: FontBinaryReadRequestSchema,
    code: "font_binary_read_request.schema_invalid",
    subject: "font binary read request",
    clone: false,
  });

export function isFontBinaryDescriptor(
  value: unknown,
): value is FontBinaryDescriptor {
  return FontBinaryDescriptorContract.parse(value).ok;
}

export function isFontBinaryPayload(
  value: unknown,
): value is FontBinaryPayload {
  return FontBinaryPayloadContract.parse(value).ok;
}

export function isFontBinaryReadRequest(
  value: unknown,
): value is FontBinaryReadRequest {
  return FontBinaryReadRequestContract.parse(value).ok;
}

function issue(
  code: string,
  path: string,
  message: string,
  expected: number,
  actual: number,
): ValidationIssue {
  return {
    code,
    path,
    message,
    expected,
    actual,
    recovery:
      "Return the complete font bytes together with their exact byte length.",
  };
}
