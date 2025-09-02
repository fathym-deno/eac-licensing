import { loadStripe } from "./loadStripe.ts";
import {
  EaCLicenseStripeDetails,
  EaCUserLicense,
  EverythingAsCodeLicensing,
  loadEaCStewardSvc,
} from "./.deps.ts";
import { getStripeCustomer } from "./.export.ts";

const VALID_SUB_STATUSES = ["active", "trialing"];

export async function recoverUserLicensesFromStripe(
  entLookup: string,
  username: string,
  eacKv: Deno.Kv,
  licFilter?: string,
): Promise<Record<string, EaCUserLicense>> {
  const eacSvc = await loadEaCStewardSvc(entLookup, username);
  const eac: EverythingAsCodeLicensing = await eacSvc.EaC.Get();

  const discoveredLicenses: Record<string, EaCUserLicense> = {};

  for (const licLookup in eac.Licenses) {
    if (licFilter && licFilter !== licLookup) continue;

    const eacLicense = eac.Licenses[licLookup];
    const stripe = await loadStripe(
      eacLicense.Details as EaCLicenseStripeDetails,
    );
    const customer = await getStripeCustomer(stripe, username);
    if (!customer) continue;

    const subs = await stripe.subscriptions.search({
      query: [
        `metadata["customer"]:"${customer.id}"`,
        `metadata["license"]:"${licLookup}"`,
        `-status:"incomplete_expired"`,
        `-status:"canceled"`,
      ].join(" AND "),
      limit: 1,
    });

    const sub = subs?.data?.[0];
    if (!sub || !VALID_SUB_STATUSES.includes(sub.status)) continue;

    const planLookup = sub.metadata?.plan || "default";
    const priceLookup = sub.metadata?.price || "default";
    const couponLookup = sub.discount?.coupon?.id;

    discoveredLicenses[licLookup] = {
      SubscriptionID: sub.id,
      PlanLookup: planLookup,
      PriceLookup: priceLookup,
      CouponLookup: couponLookup,
    };
  }

  if (Object.keys(discoveredLicenses).length > 0) {
    await eacKv.set(
      ["EaC", "Current", entLookup, "Licenses", username],
      discoveredLicenses,
    );
  }

  return discoveredLicenses;
}
