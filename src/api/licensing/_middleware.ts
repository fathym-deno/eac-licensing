import { buildUserEaCMiddleware, EaCRuntimeHandlerSet } from "../.deps.ts";

export default [buildUserEaCMiddleware()] as EaCRuntimeHandlerSet;
