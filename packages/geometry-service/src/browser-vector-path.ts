// Vite's dependency `?url` contract is declared beside this isolated entry.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./pathkit-wasm-url.d.ts" />

import pathKitWasmUrl from "pathkit-wasm/bin/pathkit.wasm?url";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "./vector-path.js";

let providerPromise: Promise<VectorGeometryProvider> | undefined;

/**
 * Browser-only PathKit loader. Keeping this entry behind a dynamic import lets
 * ordinary documents avoid downloading or initializing the WASM provider.
 */
export function loadBrowserVectorGeometryProvider(): Promise<VectorGeometryProvider> {
  providerPromise ??= createPathKitGeometryProvider({
    locateFile: () => pathKitWasmUrl,
  }).catch((error: unknown) => {
    providerPromise = undefined;
    throw error;
  });
  return providerPromise;
}
