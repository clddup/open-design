export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function transformToAffine(
  transform: readonly [number, number, number, number, number, number],
): AffineMatrix {
  return {
    a: transform[0],
    b: transform[1],
    c: transform[2],
    d: transform[3],
    e: transform[4],
    f: transform[5],
  };
}

export function matrixRelativeToParent(
  parent: AffineMatrix,
  desired: AffineMatrix,
  epsilon: number,
): AffineMatrix | undefined {
  const determinant = parent.a * parent.d - parent.b * parent.c;
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= epsilon ||
    !matrixIsFinite(parent) ||
    !matrixIsFinite(desired)
  ) {
    return undefined;
  }
  const inverse = {
    a: parent.d / determinant,
    b: -parent.b / determinant,
    c: -parent.c / determinant,
    d: parent.a / determinant,
    e: (parent.c * parent.f - parent.d * parent.e) / determinant,
    f: (parent.b * parent.e - parent.a * parent.f) / determinant,
  };
  return {
    a: normalizeAffineNumber(inverse.a * desired.a + inverse.c * desired.b),
    b: normalizeAffineNumber(inverse.b * desired.a + inverse.d * desired.b),
    c: normalizeAffineNumber(inverse.a * desired.c + inverse.c * desired.d),
    d: normalizeAffineNumber(inverse.b * desired.c + inverse.d * desired.d),
    e: normalizeAffineNumber(
      inverse.a * desired.e + inverse.c * desired.f + inverse.e,
    ),
    f: normalizeAffineNumber(
      inverse.b * desired.e + inverse.d * desired.f + inverse.f,
    ),
  };
}

export function sameAffineMatrix(
  left: AffineMatrix,
  right: AffineMatrix,
  epsilon: number,
): boolean {
  return (
    nearlyEqual(left.a, right.a, epsilon) &&
    nearlyEqual(left.b, right.b, epsilon) &&
    nearlyEqual(left.c, right.c, epsilon) &&
    nearlyEqual(left.d, right.d, epsilon) &&
    nearlyEqual(left.e, right.e, epsilon) &&
    nearlyEqual(left.f, right.f, epsilon)
  );
}

function matrixIsFinite(matrix: AffineMatrix): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
    Number.isFinite,
  );
}

function nearlyEqual(left: number, right: number, epsilon: number): boolean {
  return Math.abs(left - right) <= epsilon;
}

function normalizeAffineNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
