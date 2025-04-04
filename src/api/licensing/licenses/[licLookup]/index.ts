import {
  EaCLicenseStripeDetails,
  EaCRuntimeHandlers,
  EaCStewardAPIState,
  EaCUserLicense,
  EverythingAsCodeLicensing,
  loadEaCStewardSvc,
  STATUS_CODE,
  Stripe,
} from '../../../.deps.ts';
import {
  getStripeCustomer,
  loadStripe,
  recoverUserLicensesFromStripe,
} from '../../../../utils/.export.ts';

export default {
  async GET(req, ctx) {
    debugger;
    const entLookup = ctx.State.UserEaC!.EnterpriseLookup;

    const url = new URL(req.url);

    const username = url.searchParams.get('username')!;

    const licLookup = ctx.Params.licLookup as string;

    const eacKv = await ctx.Runtime.IoC.Resolve<Deno.Kv>(Deno.Kv, 'eac');

    let licenses = (
      await eacKv.get<Record<string, EaCUserLicense>>([
        'EaC',
        'Current',
        entLookup,
        'Licenses',
        username,
      ])
    )?.value;

    if (!licenses || Object.keys(licenses).length === 0) {
      licenses = await recoverUserLicensesFromStripe(
        entLookup,
        username,
        eacKv
      );
    }

    const userLicense = licenses?.[licLookup];

    if (userLicense) {
      const eacSvc = await loadEaCStewardSvc(entLookup, username);

      const eac: EverythingAsCodeLicensing = await eacSvc.EaC.Get();

      const eacLicense = eac?.Licenses?.[licLookup];

      if (eacLicense) {
        const stripe = await loadStripe(
          eacLicense.Details as EaCLicenseStripeDetails
        )!;

        let customer = await getStripeCustomer(stripe, username);

        if (customer) {
          const subResp = await stripe.subscriptions.retrieve(
            userLicense.SubscriptionID
          );

          let sub = subResp as Stripe.Subscription;

          if (!sub) {
            const subs = await stripe.subscriptions.search({
              query: [
                `metadata["customer"]:"${customer.id}"`,
                `metadata["license"]:"${licLookup}"`,
              ].join(' AND '),
              limit: 1,
              expand: ['data.latest_invoice.payment_intent'],
            });

            sub = subs?.data[0];
          }

          const validStati = ['trialing', 'active'];

          const res = {
            Active: sub && validStati.some((vs) => vs === sub.status),
            License: userLicense,
            Subscription: sub,
          };

          return Response.json(res);
        }
      }
    }

    return Response.json({ Active: false });
  },

  async POST(req, ctx) {
    debugger;
    const logger = ctx.Runtime.Logs;

    const entLookup = ctx.Runtime.EaC.EnterpriseLookup!;
    // const entLookup = ctx.State.UserEaC!.EnterpriseLookup;

    const url = new URL(req.url);

    const username = url.searchParams.get('username')!;

    const licLookup = ctx.Params.licLookup as string;

    const licReq: EaCUserLicense = await req.json();

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

    if (!licenses) {
      licenses = {};
    }

    const eacSvc = await loadEaCStewardSvc(entLookup, username);

    const eac: EverythingAsCodeLicensing = await eacSvc.EaC.Get();

    const eacLicense = eac?.Licenses?.[licLookup];

    if (eacLicense) {
      const stripe = await loadStripe(
        eacLicense.Details as EaCLicenseStripeDetails
      )!;

      try {
        const userLicense = licenses?.[licLookup];

        let customer = await getStripeCustomer(stripe, username);

        if (!customer) {
          customer = await stripe.customers.create({
            email: username,
          });
        }

        let sub: Stripe.Subscription | undefined;

        if (userLicense) {
          sub = await stripe.subscriptions.retrieve(userLicense.SubscriptionID);

          //  TODO(AI): Verify sub is paid and active?
          const verified = false;

          if (!verified) {
            sub = undefined;
          }
        }

        if (!sub) {
          const subs = await stripe.subscriptions.search({
            query: [
              `metadata["customer"]:"${customer.id}"`,
              `metadata["license"]:"${licLookup}"`,
              `-status:"incomplete_expired"`,
              `-status:"canceled"`,
            ].join(' AND '),
            limit: 1,
          });

          // TODO(ttrichar): Handle all of the different statis to deterimine what happens next,,,

          sub = subs?.data[0];
        }

        const eacPrice =
          eac!.Licenses![licLookup]!.Plans![licReq.PlanLookup]!.Prices![
            licReq.PriceLookup
          ]!;

        const priceKey = Math.round(eacPrice.Details!.Value * 100).toString(); // `${licLookup}-${licReq.PlanLookup}-${licReq.PriceLookup}`;

        const productId = `${licLookup}-${licReq.PlanLookup}`;

        const prices = await stripe.prices.search({
          query: `lookup_key:"${priceKey}" AND product:"${productId}"`,
          limit: 1,
        });

        const priceId = prices.data[0].id;

        if (
          sub?.status === 'incomplete' &&
          priceId !== sub.items.data[0].price.id
        ) {
          await stripe.subscriptions.cancel(sub.id);

          sub = undefined;
          // } else if (
          //   sub.status === 'canceled' &&
          //   priceId !== sub.items.data[0].price.id
          // ) {
          //   sub = await stripe.subscriptions.resume(sub.id, {});

          //   sub = undefined;
        }

        if (!sub) {
          sub = await stripe.subscriptions.create({
            customer: customer.id,
            items: [
              {
                price: priceId,
              },
            ],
            payment_behavior: 'default_incomplete',
            payment_settings: {
              save_default_payment_method: 'on_subscription',
            },
            expand: ['latest_invoice.payment_intent'],
            metadata: {
              customer: customer.id,
              license: licLookup,
            },
          });
        } else {
          sub = await stripe.subscriptions.update(sub.id, {
            items: [
              {
                id: sub.items.data[0].id,
                price: priceId,
              },
            ],
            expand: ['latest_invoice.payment_intent'],
          });
        }

        if (sub) {
          licReq.SubscriptionID = sub.id;

          licenses[licLookup] = licReq;

          await eacKv.set(
            ['EaC', 'Current', entLookup, 'Licenses', username],
            licenses
          );

          return Response.json({
            License: licenses[licLookup],
            Subscription: sub,
          });
        }
      } catch (error) {
        logger.Package.error(
          `There was an error configuring the license '${licLookup}'`,
          error
        );

        return Response.json(error, {
          status: STATUS_CODE.BadRequest,
        });
      }
    }

    return Response.json(
      {},
      {
        status: STATUS_CODE.BadRequest,
      }
    );
  },

  async DELETE(req, ctx) {
    const entLookup = ctx.Runtime.EaC.EnterpriseLookup!;

    const url = new URL(req.url);

    const username = url.searchParams.get('username')!;

    const licLookup = ctx.Params.licLookup as string;

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

    if (licenses) {
      const userLicense = licenses?.[licLookup];

      const eacSvc = await loadEaCStewardSvc(entLookup, username);

      const eac: EverythingAsCodeLicensing = await eacSvc.EaC.Get();

      const eacLicense = eac?.Licenses?.[licLookup];

      if (eacLicense) {
        const stripe = await loadStripe(
          eacLicense.Details as EaCLicenseStripeDetails
        )!;

        try {
          let customer = await getStripeCustomer(stripe, username);

          let subResp = await stripe.subscriptions.retrieve(
            userLicense.SubscriptionID
          );

          let sub = subResp as Stripe.Subscription;

          if (!sub) {
            const subs = await stripe.subscriptions.search({
              query: [
                `metadata["customer"]:"${customer!.id}"`,
                `metadata["license"]:"${licLookup}"`,
              ].join(' AND '),
              limit: 1,
            });

            sub = subs?.data[0];
          }

          if (sub) {
            sub = await stripe.subscriptions.cancel(sub.id, {});
          }

          if (sub) {
            delete licenses[licLookup];

            await eacKv.set(
              ['EaC', 'Current', entLookup, 'Licenses', username],
              licenses
            );

            return Response.json({});
          }
        } catch (error) {
          return Response.json(error, {
            status: STATUS_CODE.BadRequest,
          });
        }
      }
    }

    return Response.json(
      {},
      {
        status: STATUS_CODE.BadRequest,
      }
    );
  },
} as EaCRuntimeHandlers<EaCStewardAPIState>;
