import { EaCDetails } from "./.deps.ts";
import { EaCLicenseDetails } from "./EaCLicenseDetails.ts";
import { EaCLicensePlanAsCode } from "./EaCLicensePlanAsCode.ts";
import { EaCLicenseCouponAsCode } from "./EaCLicenseCouponAsCode.ts";

export type EaCLicenseAsCode = {
  Plans: Record<string, EaCLicensePlanAsCode>;
  Coupons?: Record<string, EaCLicenseCouponAsCode>;
} & EaCDetails<EaCLicenseDetails>;
