declare module "pathkit-wasm/bin/pathkit.js" {
  export interface PathKitInitOptions {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer | ArrayBufferView;
  }

  export interface PathKitRect {
    fLeft: number;
    fTop: number;
    fRight: number;
    fBottom: number;
  }

  export interface PathKitEnumValue {
    readonly value: number;
  }

  export interface PathKitPath {
    addPath(path: PathKitPath): PathKitPath;
    computeTightBounds(): PathKitRect;
    copy(): PathKitPath;
    delete(): void;
    getFillTypeString(): "evenodd" | "nonzero";
    op(path: PathKitPath, operation: PathKitEnumValue): PathKitPath | null;
    setFillType(fillType: PathKitEnumValue): void;
    simplify(): PathKitPath | null;
    stroke(options: {
      width: number;
      cap: PathKitEnumValue;
      join: PathKitEnumValue;
      miter_limit: number;
    }): PathKitPath | null;
    toSVGString(): string;
  }

  export interface PathKitModule {
    FromSVGString(path: string): PathKitPath | null;
    FillType: {
      WINDING: PathKitEnumValue;
      EVENODD: PathKitEnumValue;
    };
    PathOp: {
      DIFFERENCE: PathKitEnumValue;
      INTERSECT: PathKitEnumValue;
      UNION: PathKitEnumValue;
      XOR: PathKitEnumValue;
    };
    StrokeCap: {
      BUTT: PathKitEnumValue;
      ROUND: PathKitEnumValue;
      SQUARE: PathKitEnumValue;
    };
    StrokeJoin: {
      MITER: PathKitEnumValue;
      ROUND: PathKitEnumValue;
      BEVEL: PathKitEnumValue;
    };
  }

  export default function PathKitInit(
    options?: PathKitInitOptions,
  ): Promise<PathKitModule>;
}
