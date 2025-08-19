// deno-lint-ignore-file no-explicit-any
import {
  EaCLicenseStripeDetails,
  EaCRuntimeHandlers,
  EaCState,
  EaCStewardAPIState,
  EaCUserLicense,
  EverythingAsCodeLicensing,
  loadEaCStewardSvc,
  STATUS_CODE,
  Stripe,
} from "../../../.deps.ts";
import {
  getStripeCustomer,
  loadStripe,
  recoverUserLicensesFromStripe,
} from "../../../../utils/.export.ts";

// ---------- Logging helpers ----------
function getReqId(req: Request) {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}
function startTimer() {
  const t0 = performance.now();
  return () => Math.round(performance.now() - t0);
}
function safeError(e: unknown) {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  try {
    return { message: JSON.stringify(e) };
  } catch {
    return { message: String(e) };
  }
}
function redactCustomer(c?: Stripe.Customer | Stripe.DeletedCustomer | null) {
  if (!c || (typeof (c as any).deleted === "boolean" && (c as any).deleted)) {
    return c;
  }
  const cust = c as Stripe.Customer;
  return { id: cust.id, email: cust.email, created: cust.created };
}
function redactSub(s?: Stripe.Subscription | null) {
  if (!s) return s;
  return {
    id: s.id,
    status: s.status,
    canceled_at: s.canceled_at,
    itemsCount: s.items?.data?.length ?? 0,
    priceId: s.items?.data?.[0]?.price?.id,
    latest_invoice: typeof s.latest_invoice === "string" ? s.latest_invoice : {
      id: s.latest_invoice?.id,
      payment_intent: typeof s.latest_invoice?.payment_intent === "string"
        ? s.latest_invoice?.payment_intent
        : {
          id: (s.latest_invoice?.payment_intent as any)?.id,
          status: (s.latest_invoice?.payment_intent as any)?.status,
        },
    },
    metadata: s.metadata
      ? { license: s.metadata["license"], customer: s.metadata["customer"] }
      : undefined,
  };
}
// -------------------------------------

export default {
  async GET(req, ctx) {
    const log = ctx.Runtime.Logs.Package;
    const reqId = getReqId(req);
    const done = startTimer();

    const entLookup = ctx.State.EnterpriseLookup!;
    const url = new URL(req.url);
    const username = url.searchParams.get("username")!;
    const licLookup = ctx.Params.licLookup as string;

    log.info(
      `[GET licenses] reqId=${reqId} ent=${entLookup} user=${username} lic=${licLookup}`,
    );

    try {
      const eacKv = await ctx.Runtime.IoC.Resolve<Deno.Kv>(Deno.Kv, "eac");

      let licenses = (
        await eacKv.get<Record<string, EaCUserLicense>>([
          "EaC",
          "Current",
          entLookup,
          "Licenses",
          username,
        ])
      )?.value;

      if (!licenses || Object.keys(licenses).length === 0) {
        log.debug(`[GET] reqId=${reqId} KV miss; attempting Stripe recovery`);
        licenses = await recoverUserLicensesFromStripe(
          entLookup,
          username,
          eacKv,
        );
        log.info(
          `[GET] reqId=${reqId} Stripe license recovery ${
            licenses ? "succeeded" : "returned empty"
          }`,
        );
      } else {
        log.debug(
          `[GET] reqId=${reqId} KV hit; license keys: ${
            Object.keys(
              licenses,
            ).join(",")
          }`,
        );
      }

      const userLicense = licenses?.[licLookup];

      if (!userLicense) {
        log.warn(
          `[GET] reqId=${reqId} no userLicense found for lic=${licLookup}`,
        );
        log.info(`[GET] reqId=${reqId} done in ${done()}ms`);
        return Response.json({ Active: false });
      }

      const eacSvc = ctx.State.Steward!;
      const eac: EverythingAsCodeLicensing = await eacSvc.EaC.Get();
      const eacLicense = eac?.Licenses?.[licLookup];

      if (!eacLicense) {
        log.warn(
          `[GET] reqId=${reqId} eacLicense not found for lic=${licLookup}`,
        );
        log.info(`[GET] reqId=${reqId} done in ${done()}ms`);
        return Response.json({ Active: false });
      }

      const stripe = await loadStripe(
        eacLicense.Details as EaCLicenseStripeDetails,
      )!;

      let customer = await getStripeCustomer(stripe, username);
      log.debug(
        `[GET] reqId=${reqId} Stripe customer ${
          JSON.stringify(
            redactCustomer(customer),
          )
        }`,
      );

      if (!customer) {
        log.warn(
          `[GET] reqId=${reqId} Stripe customer not found for user=${username}`,
        );
        log.info(`[GET] reqId=${reqId} done in ${done()}ms`);
        return Response.json({ Active: false });
      }

      let sub: Stripe.Subscription | undefined;

      try {
        sub = await stripe.subscriptions.retrieve(userLicense.SubscriptionID);
      } catch (err) {
        if ((err as any).code === "resource_missing") {
          delete licenses[licLookup];
          await eacKv.set(
            ["EaC", "Current", entLookup, "Licenses", username],
            licenses,
          );
        } else {
          throw err;
        }
      }

      if (!sub) {
        log.debug(
          `[GET] reqId=${reqId} subscription id lookup empty; searching by metadata (cust=${customer.id}, lic=${licLookup})`,
        );
        const subs = await stripe.subscriptions.search({
          query: [
            `metadata["customer"]:"${customer.id}"`,
            `metadata["license"]:"${licLookup}"`,
            `metadata["parentEntLookup"]:"${ctx.Runtime.EaC
              .EnterpriseLookup!}"`,
          ].join(" AND "),
          limit: 1,
          expand: ["data.latest_invoice.payment_intent"],
        });
        sub = subs?.data[0];
      }

      if (sub) {
        const verified = !sub.canceled_at &&
          sub.metadata["customer"] === customer.id &&
          sub.metadata["license"] === licLookup &&
          sub.metadata["parentEntLookup"] === ctx.Runtime.EaC.EnterpriseLookup!;

        log.debug(
          `[POST] reqId=${reqId} found sub ${sub.id}; verified=${verified} status=${sub.status}`,
        );

        if (!verified) {
          sub = undefined;
        }
      }

      log.debug(
        `[GET] reqId=${reqId} subscription ${JSON.stringify(redactSub(sub))}`,
      );

      const validStati = ["trialing", "active"];
      const active = !!(sub && validStati.some((s) => s === sub.status));

      log.info(
        `[GET] reqId=${reqId} result active=${active} status=${
          sub?.status ?? "n/a"
        } in ${done()}ms`,
      );

      return Response.json({
        Active: active,
        License: userLicense,
        Subscription: sub,
      });
    } catch (err) {
      log.error(`[GET] reqId=${reqId} unhandled error`);
      log.error(safeError(err));
      return Response.json(
        { Active: false, Error: safeError(err) },
        {
          status: STATUS_CODE.BadRequest,
        },
      );
    }
  },

  async POST(req, ctx) {
    const log = ctx.Runtime.Logs.Package;
    const reqId = getReqId(req);
    const done = startTimer();

    const entLookup = ctx.Runtime.EaC.EnterpriseLookup!;
    const url = new URL(req.url);
    const username = url.searchParams.get("username")!;
    const licLookup = ctx.Params.licLookup as string;

    log.info(
      `[POST licenses] reqId=${reqId} ent=${entLookup} user=${username} lic=${licLookup}`,
    );

    try {
      const licReq: EaCUserLicense = await req.json();
      log.debug(
        `[POST] reqId=${reqId} licReq plan=${licReq.PlanLookup} price=${licReq.PriceLookup}`,
      );

      const eacKv = await ctx.Runtime.IoC.Resolve<Deno.Kv>(Deno.Kv, "eac");
      let licenses = (
        await eacKv.get<Record<string, EaCUserLicense>>([
          "EaC",
          "Current",
          entLookup,
          "Licenses",
          username,
        ])
      ).value;

      if (!licenses) {
        log.debug(`[POST] reqId=${reqId} KV empty; initializing`);
        licenses = {};
      }

      const eacSvc = ctx.State.Steward!;
      const eac: EverythingAsCodeLicensing = await eacSvc.EaC.Get();

      const eacLicense = eac?.Licenses?.[licLookup];

      if (!eacLicense) {
        log.warn(
          `[POST] reqId=${reqId} eacLicense not found for lic=${licLookup}`,
        );
        return Response.json({}, { status: STATUS_CODE.BadRequest });
      }

      const stripe = await loadStripe(
        eacLicense.Details as EaCLicenseStripeDetails,
      )!;

      try {
        const existingUserLicense = licenses?.[licLookup];

        let customer = await getStripeCustomer(stripe, username);
        if (!customer) {
          log.info(
            `[POST] reqId=${reqId} creating Stripe customer for user=${username}`,
          );
          customer = await stripe.customers.create({ email: username });
        }
        log.debug(
          `[POST] reqId=${reqId} Stripe customer ${
            JSON.stringify(
              redactCustomer(customer),
            )
          }`,
        );

        let sub: Stripe.Subscription | undefined;
        if (existingUserLicense) {
          log.debug(
            `[POST] reqId=${reqId} retrieving subscription by id=${existingUserLicense.SubscriptionID}`,
          );
          sub = await stripe.subscriptions.retrieve(
            existingUserLicense.SubscriptionID,
          );
        }

        if (!sub) {
          log.debug(
            `[POST] reqId=${reqId} searching subscriptions by metadata (cust=${customer.id}, lic=${licLookup})`,
          );
          const subs = await stripe.subscriptions.search({
            query: [
              `metadata["customer"]:"${customer.id}"`,
              `metadata["license"]:"${licLookup}"`,
              `metadata["parentEntLookup"]:"${ctx.Runtime.EaC
                .EnterpriseLookup!}"`,
              `-status:"incomplete_expired"`,
              `-status:"canceled"`,
            ].join(" AND "),
            limit: 1,
          });
          sub = subs?.data[0];
        }

        if (sub) {
          const verified = !sub.canceled_at &&
            sub.metadata["customer"] === customer.id &&
            sub.metadata["license"] === licLookup &&
            sub.metadata["parentEntLookup"] ===
              ctx.Runtime.EaC.EnterpriseLookup!;

          log.debug(
            `[POST] reqId=${reqId} found sub ${sub.id}; verified=${verified} status=${sub.status}`,
          );

          if (!verified) {
            sub = undefined;
          }
        }

        // Price lookup in EaC
        const eacPrice = eac!.Licenses![licLookup]!.Plans![licReq.PlanLookup]!
          .Prices![
            licReq.PriceLookup
          ]!;
        const priceKey = Math.round(eacPrice.Details!.Value * 100).toString();
        const productId = `${licLookup}-${licReq.PlanLookup}`;

        const prices = await stripe.prices.search({
          query:
            `lookup_key:"${productId}|${priceKey}" AND product:"${productId}"`,
          limit: 1,
        });

        const priceId = prices.data[0]?.id;
        if (!priceId) {
          log.error(
            `[POST] reqId=${reqId} price not found for productId=${productId} priceKey=${priceKey}`,
          );
          return Response.json(
            { error: "Price not found" },
            { status: STATUS_CODE.BadRequest },
          );
        }
        log.debug(`[POST] reqId=${reqId} resolved priceId=${priceId}`);

        if (
          sub?.status === "incomplete" &&
          priceId !== sub.items.data[0].price.id
        ) {
          log.info(
            `[POST] reqId=${reqId} canceling mismatched incomplete sub=${sub.id} currentPrice=${
              sub.items.data[0].price.id
            } -> desiredPrice=${priceId}`,
          );
          await stripe.subscriptions.cancel(sub.id);
          sub = undefined;
        }

        const createSub = async () => {
          log.info(
            `[POST] reqId=${reqId} creating subscription for customer=${customer.id}`,
          );

          sub = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: priceId }],
            payment_behavior: "default_incomplete",
            payment_settings: {
              save_default_payment_method: "on_subscription",
            },
            expand: ["latest_invoice.payment_intent"],
            metadata: {
              customer: customer.id,
              license: licLookup,
              parentEntLookup: ctx.Runtime.EaC.EnterpriseLookup!,
            },
          });
        };

        if (!sub) {
          await createSub();
        } else {
          log.info(
            `[POST] reqId=${reqId} updating subscription items for sub=${sub.id}`,
          );
          try {
            sub = await stripe.subscriptions.update(sub.id, {
              items: [{ id: sub.items.data[0].id, price: priceId }],
              expand: ["latest_invoice.payment_intent"],
            });
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("No such subscription:") &&
              error.message.includes("a similar object exists in")
            ) {
              log.info(
                `[POST] reqId=${reqId} subscription cleanup required from environment testing for sub=${sub.id}`,
              );
              await stripe.subscriptions.cancel(sub.id);

              await createSub();
            }
          }
        }

        log.debug(
          `[POST] reqId=${reqId} subscription result ${
            JSON.stringify(
              redactSub(sub),
            )
          }`,
        );

        if (sub) {
          licReq.SubscriptionID = sub.id;
          licenses[licLookup] = licReq;

          await eacKv.set(
            ["EaC", "Current", entLookup, "Licenses", username],
            licenses,
          );
          log.info(
            `[POST] reqId=${reqId} KV updated for user=${username} lic=${licLookup} in ${done()}ms`,
          );

          return Response.json({
            License: licenses[licLookup],
            Subscription: sub,
          });
        }

        log.error(
          `[POST] reqId=${reqId} sub creation/update yielded undefined`,
        );
        return Response.json(
          { error: "Subscription creation failed" },
          { status: STATUS_CODE.BadRequest },
        );
      } catch (error) {
        log.error(
          `[POST] reqId=${reqId} error configuring license '${licLookup}'`,
        );
        log.error(safeError(error));

        return Response.json(safeError(error), {
          status: STATUS_CODE.BadRequest,
        });
      }
    } finally {
      log.info(`[POST] reqId=${reqId} done in ${done()}ms`);
    }
  },

  async DELETE(req, ctx) {
    const log = ctx.Runtime.Logs.Package;
    const reqId = getReqId(req);
    const done = startTimer();

    const entLookup = ctx.Runtime.EaC.EnterpriseLookup!;
    const url = new URL(req.url);
    const username = url.searchParams.get("username")!;
    const licLookup = ctx.Params.licLookup as string;

    log.info(
      `[DELETE licenses] reqId=${reqId} ent=${entLookup} user=${username} lic=${licLookup}`,
    );

    try {
      const eacKv = await ctx.Runtime.IoC.Resolve<Deno.Kv>(Deno.Kv, "eac");

      let licenses = (
        await eacKv.get<Record<string, EaCUserLicense>>([
          "EaC",
          "Current",
          entLookup,
          "Licenses",
          username,
        ])
      ).value;

      if (!licenses) {
        log.warn(`[DELETE] reqId=${reqId} no licenses for user=${username}`);
        return Response.json({}, { status: STATUS_CODE.BadRequest });
      }

      const userLicense = licenses?.[licLookup];
      if (!userLicense) {
        log.warn(`[DELETE] reqId=${reqId} no userLicense for lic=${licLookup}`);
        return Response.json({}, { status: STATUS_CODE.BadRequest });
      }

      const eacSvc = ctx.State.Steward!;
      const eac: EverythingAsCodeLicensing = await eacSvc.EaC.Get();
      const eacLicense = eac?.Licenses?.[licLookup];

      if (!eacLicense) {
        log.warn(
          `[DELETE] reqId=${reqId} eacLicense not found for lic=${licLookup}`,
        );
        return Response.json({}, { status: STATUS_CODE.BadRequest });
      }

      const stripe = await loadStripe(
        eacLicense.Details as EaCLicenseStripeDetails,
      )!;

      try {
        let customer = await getStripeCustomer(stripe, username);
        log.debug(
          `[DELETE] reqId=${reqId} Stripe customer ${
            JSON.stringify(
              redactCustomer(customer),
            )
          }`,
        );

        let subResp = await stripe.subscriptions.retrieve(
          userLicense.SubscriptionID,
        );
        let sub = subResp as Stripe.Subscription | undefined;

        if (!sub) {
          log.debug(
            `[DELETE] reqId=${reqId} subscription id lookup empty; searching by metadata`,
          );
          const subs = await stripe.subscriptions.search({
            query: [
              `metadata["customer"]:"${customer!.id}"`,
              `metadata["license"]:"${licLookup}"`,
              `metadata["parentEntLookup"]:"${ctx.Runtime.EaC
                .EnterpriseLookup!}"`,
            ].join(" AND "),
            limit: 1,
          });
          sub = subs?.data[0];
        }

        if (sub) {
          let customer = await getStripeCustomer(stripe, username);
          log.debug(
            `[GET] reqId=${reqId} Stripe customer ${
              JSON.stringify(
                redactCustomer(customer),
              )
            }`,
          );

          if (!customer) {
            log.warn(
              `[GET] reqId=${reqId} Stripe customer not found for user=${username}`,
            );
            log.info(`[GET] reqId=${reqId} done in ${done()}ms`);
            return Response.json({ Active: false });
          }

          const verified = !sub.canceled_at &&
            sub.metadata["customer"] === customer.id &&
            sub.metadata["license"] === licLookup &&
            sub.metadata["parentEntLookup"] ===
              ctx.Runtime.EaC.EnterpriseLookup!;

          log.debug(
            `[POST] reqId=${reqId} found sub ${sub.id}; verified=${verified} status=${sub.status}`,
          );

          if (!verified) {
            sub = undefined;
          }
        }

        log.debug(
          `[DELETE] reqId=${reqId} subscription pre-cancel ${
            JSON.stringify(
              redactSub(sub),
            )
          }`,
        );

        if (sub) {
          sub = await stripe.subscriptions.cancel(sub.id, {});
          log.info(
            `[DELETE] reqId=${reqId} subscription canceled sub=${sub.id}`,
          );
        } else {
          log.warn(
            `[DELETE] reqId=${reqId} subscription not found; nothing to cancel`,
          );
        }

        if (sub) {
          delete licenses[licLookup];
          await eacKv.set(
            ["EaC", "Current", entLookup, "Licenses", username],
            licenses,
          );
          log.info(
            `[DELETE] reqId=${reqId} KV updated; removed lic=${licLookup} in ${done()}ms`,
          );
          return Response.json({});
        }

        log.warn(
          `[DELETE] reqId=${reqId} sub undefined after cancel; KV unchanged`,
        );
        return Response.json({}, { status: STATUS_CODE.BadRequest });
      } catch (error) {
        log.error(`[DELETE] reqId=${reqId} stripe error`);
        log.error(safeError(error));
        return Response.json(safeError(error), {
          status: STATUS_CODE.BadRequest,
        });
      }
    } catch (err) {
      log.error(`[DELETE] reqId=${reqId} unhandled error`);
      log.error(safeError(err));
      return Response.json(safeError(err), { status: STATUS_CODE.BadRequest });
    } finally {
      log.info(`[DELETE] reqId=${reqId} done in ${done()}ms`);
    }
  },
} as EaCRuntimeHandlers<EaCStewardAPIState & EaCState>;
