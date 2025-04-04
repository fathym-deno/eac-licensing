import {
  EaCRuntimeHandlers,
  EaCStewardAPIState,
  EaCUserLicense,
} from '../../.deps.ts';

import {
  getStripeCustomer,
  recoverUserLicensesFromStripe,
} from '../../../utils/.export.ts';

export default {
  async GET(req, ctx) {
    debugger;
    const entLookup = ctx.Runtime.EaC.EnterpriseLookup!;
    const url = new URL(req.url);
    const username = url.searchParams.get('username') || ctx.State.Username!;

    const eacKv = await ctx.Runtime.IoC.Resolve<Deno.Kv>(Deno.Kv, 'eac');

    let licenses = (
      await eacKv.get<Record<string, EaCUserLicense>>([
        'EaC',
        'Current',
        entLookup,
        'Licenses',
        username,
      ])
    ).value;

    if (!licenses || Object.keys(licenses).length === 0) {
      licenses = await recoverUserLicensesFromStripe(
        entLookup,
        username,
        eacKv
      );
    }

    return Response.json(licenses || {});
  },
} as EaCRuntimeHandlers<EaCStewardAPIState>;
