import {
  EaCRuntimeHandlers,
  EaCStewardAPIState,
  EaCUserLicense,
} from "../../.deps.ts";

export default {
  async GET(req, ctx) {
    const entLookup = ctx.Runtime.EaC.EnterpriseLookup!;

    const url = new URL(req.url);

    const username = url.searchParams.get("username") || ctx.State.Username!;

    const eacKv = await ctx.Runtime.IoC.Resolve<Deno.Kv>(Deno.Kv, "eac");

    const licenses = await eacKv.get<Record<string, EaCUserLicense>>([
      "EaC",
      "Current",
      entLookup,
      "Licenses",
      username,
    ]);

    return Response.json(licenses.value || {});
  },
} as EaCRuntimeHandlers<EaCStewardAPIState>;
