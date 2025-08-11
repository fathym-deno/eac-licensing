import { esbuildResolutionToURL } from "jsr:@luca/esbuild-deno-loader@0.10.3";
import { buildEaCAPIMiddleware, EaCRuntimeHandlerSet } from "../.deps.ts";

export default [buildEaCAPIMiddleware()] as EaCRuntimeHandlerSet;
