import { Type } from "@sinclair/typebox";
import { defineContract, type ValidationIssue } from "./contract-validation";

const WINDOWS_RESERVED_FILE_NAME =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;

export const PortableFileNameSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[^<>:"/\\\\|?*\\u0000-\\u001F\\u007F]+$',
});

export const PortableFileNameContract = defineContract<string>({
  schema: PortableFileNameSchema,
  code: "portable_file_name.schema_invalid",
  subject: "portable file name",
  clone: false,
  refine: portableFileNameIssues,
});

/**
 * Accepts a path-free file name that behaves consistently on macOS and
 * Windows. Native dialogs remain responsible for choosing the directory.
 */
export function isPortableFileName(value: unknown): value is string {
  return PortableFileNameContract.parse(value).ok;
}

function portableFileNameIssues(value: string): ValidationIssue[] {
  if (value.trim().length === 0 || value === "." || value === "..") {
    return [issue("portable_file_name.empty", "File name must contain text")];
  }
  if (/[. ]$/.test(value)) {
    return [
      issue(
        "portable_file_name.trailing_character",
        "File name must not end in a dot or space",
      ),
    ];
  }
  return WINDOWS_RESERVED_FILE_NAME.test(value)
    ? [issue("portable_file_name.reserved", "File name is reserved by Windows")]
    : [];
}

function issue(code: string, message: string): ValidationIssue {
  return {
    code,
    path: "/",
    message,
    recovery: "Choose a path-free file name valid on both macOS and Windows.",
  };
}
