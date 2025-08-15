// deno-lint-ignore-file no-explicit-any
import {
  EaCActuatorErrorResponse,
  EaCActuatorRequest,
  EaCActuatorResponse,
  EaCLicenseAsCode,
  EaCLicenseStripeDetails,
  EaCRuntimeHandlers,
  eacSetSecrets,
  EverythingAsCode,
  EverythingAsCodeLicensing,
  loadMainSecretClient,
  Stripe,
} from "../.deps.ts";

export default {
  async POST(req, ctx) {
    const log = ctx.Runtime.Logs.Package;

    // helpers
    const reqId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const t0 = Date.now();
    const done = () => Date.now() - t0;
    const safeJson = (v: unknown) => {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    };

    try {
      const handlerRequest: EaCActuatorRequest = await req.json();

      const commitId = handlerRequest.CommitID ?? "unknown";
      const licLookup = handlerRequest.Lookup;
      log.info(
        () =>
          `[lic-act][${reqId}] start commit=${commitId} license=${licLookup}`,
      );

      const eac: EverythingAsCode & EverythingAsCodeLicensing =
        handlerRequest.EaC;
      const currentLicenses = eac.Licenses || {};
      const current = currentLicenses[licLookup] || {};
      const license = handlerRequest.Model as EaCLicenseAsCode;
      const licDetails = (license.Details ||
        current.Details!) as EaCLicenseStripeDetails;

      if (licDetails) {
        log.debug(
          () =>
            `[lic-act][${reqId}] initializing Stripe client for license=${licLookup}`,
        );
        const stripe = (Stripe as any)(licDetails.SecretKey)! as Stripe;

        const products = await stripe.products.list();
        log.debug(
          () => `[lic-act][${reqId}] existing products=${products.data.length}`,
        );

        const planLookups = Object.keys(license.Plans || {});
        log.info(
          () =>
            `[lic-act][${reqId}] processing plans count=${planLookups.length}`,
        );

        let createdProducts = 0;
        let updatedProducts = 0;
        let createdPrices = 0;
        let deactivatedPrices = 0;

        const productCalls = planLookups.map(async (planLookup) => {
          const productId = `${licLookup}-${planLookup}`;
          const eacPlan = license.Plans![planLookup];

          const exists = products.data.some((p) => p.id === productId);
          if (!exists) {
            await stripe.products.create({
              id: productId,
              name: eacPlan.Details?.Name
                ? `${license.Details!.Name} - ${
                  eacPlan.Details?.Name || productId
                }`
                : "undefined",
              description: eacPlan.Details?.Description || undefined,
              active: true,
              type: "service",
            });
            createdProducts++;
            log.info(
              () => `[lic-act][${reqId}] product created id=${productId}`,
            );
          } else {
            await stripe.products.update(productId, {
              name: eacPlan.Details?.Name
                ? `${license.Details!.Name} - ${
                  eacPlan.Details?.Name || productId
                }`
                : undefined,
              description: eacPlan.Details?.Description || undefined,
              active: true,
            });
            updatedProducts++;
            log.debug(
              () => `[lic-act][${reqId}] product updated id=${productId}`,
            );
          }

          const prices = await stripe.prices.list({ product: productId });
          const priceLookups = Object.keys(eacPlan.Prices || {});
          log.debug(
            () =>
              `[lic-act][${reqId}] plan=${planLookup} existingPrices=${prices.data.length} desiredPrices=${priceLookups.length}`,
          );

          const priceCalls: Promise<unknown>[] = [];

          // create missing prices
          for (const priceLookup of priceLookups) {
            const eacPrice = eacPlan.Prices![priceLookup];
            const interval = eacPrice.Details!
              .Interval as Stripe.PriceCreateParams.Recurring.Interval;
            const unitAmount = Math.round(eacPrice.Details!.Value * 100);

            const found = prices.data.find((p) => p.unit_amount === unitAmount);
            if (!found) {
              priceCalls.push(
                stripe.prices
                  .create({
                    lookup_key: `${productId}|${unitAmount.toString()}`,
                    unit_amount: unitAmount,
                    currency: eacPrice.Details!.Currency,
                    recurring: { interval },
                    metadata: {
                      priceId: `${licLookup}-${planLookup}-${priceLookup}`,
                    },
                    product: productId,
                    nickname: eacPrice.Details?.Name,
                    active: true,
                  })
                  .then(() => {
                    createdPrices++;
                    log.info(
                      () =>
                        `[lic-act][${reqId}] price created product=${productId} amount=${unitAmount}`,
                    );
                  }),
              );
            }
          }

          // build a quick map of allowed amounts to keep active
          const allowedAmounts = new Set<number>();
          for (const apl of priceLookups) {
            const amt = eacPlan.Prices?.[apl]?.Details?.Value ??
              current.Plans?.[planLookup]?.Prices?.[apl]?.Details?.Value;
            if (typeof amt === "number") {
              allowedAmounts.add(Math.round(amt * 100));
            }
          }

          // toggle activity based on whether the amount is allowed
          for (const price of prices.data) {
            const shouldBeActive = allowedAmounts.has(price.unit_amount ?? -1);
            if (price.active !== shouldBeActive) {
              priceCalls.push(
                stripe.prices
                  .update(price.id, { active: shouldBeActive })
                  .then(() => {
                    if (!shouldBeActive) deactivatedPrices++;
                    log.debug(
                      () =>
                        `[lic-act][${reqId}] price ${
                          shouldBeActive ? "activated" : "deactivated"
                        } id=${price.id} amount=${price.unit_amount}`,
                    );
                  }),
              );
            }
          }

          await Promise.all(priceCalls);
        });

        await Promise.all(productCalls);

        // Secrets handling
        const secretRoot = `licenses-${licLookup}`;
        const needsSecreting =
          !licDetails.PublishableKey.startsWith("$secret:") ||
          !licDetails.SecretKey.startsWith("$secret:") ||
          !licDetails.WebhookSecret.startsWith("$secret:");

        if (needsSecreting) {
          log.info(
            () =>
              `[lic-act][${reqId}] storing Stripe keys in secret vault root=${secretRoot}`,
          );
          const secretClient = await loadMainSecretClient();

          const secreted = await eacSetSecrets(secretClient, secretRoot, {
            PublishableKey: licDetails.PublishableKey,
            SecretKey: licDetails.SecretKey,
            WebhookSecret: licDetails.WebhookSecret,
          });

          license.Details = {
            ...license.Details,
            ...secreted,
          } as EaCLicenseStripeDetails;
        } else {
          log.debug(
            () =>
              `[lic-act][${reqId}] keys already secreted (root=${secretRoot})`,
          );
        }

        log.info(
          () =>
            `[lic-act][${reqId}] done license=${licLookup} products(created=${createdProducts}, updated=${updatedProducts}) prices(created=${createdPrices}, deactivated=${deactivatedPrices}) in ${done()}ms`,
        );
      } else {
        log.warn(
          () =>
            `[lic-act][${reqId}] no Stripe license details provided; skipping Stripe sync`,
        );
      }

      return Response.json({
        Checks: [],
        Lookup: licLookup,
        Messages: {
          Message: `The iot '${licLookup}' has been handled.`,
        },
        Model: license,
      } as EaCActuatorResponse);
    } catch (err) {
      log.error(`[lic-act][${reqId}] error configuring licenses`);
      log.error({
        error: err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : { message: safeJson(err) },
      });

      return Response.json({
        HasError: true,
        Messages: { Error: safeJson(err) },
      } as EaCActuatorErrorResponse);
    }
  },
} as EaCRuntimeHandlers;
