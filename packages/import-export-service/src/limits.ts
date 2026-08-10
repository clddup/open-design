/**
 * Public resource budgets shared by the pure SVG service and privileged file
 * bridge. The byte ceiling is deliberately the UTF-8 upper bound for the
 * character budget, so Main can reject unreasonable files before reading them
 * without imposing a smaller product limit than the parser itself.
 */
export const SVG_MAX_CHARACTERS = 2_000_000;
export const SVG_MAX_FILE_BYTES = SVG_MAX_CHARACTERS * 4;
