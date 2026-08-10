const WINDOWS_RESERVED_FILE_NAME =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;
const WINDOWS_FORBIDDEN_FILE_NAME_CHARACTER = /[<>:"/\\|?*]/;

/**
 * Accepts a path-free file name that behaves consistently on macOS and
 * Windows. Native dialogs remain responsible for choosing the directory.
 */
export function isPortableFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    value.trim().length > 0 &&
    value !== "." &&
    value !== ".." &&
    !WINDOWS_FORBIDDEN_FILE_NAME_CHARACTER.test(value) &&
    !/[. ]$/.test(value) &&
    !WINDOWS_RESERVED_FILE_NAME.test(value) &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  );
}
