import { EaCDetails } from "./.deps.ts";
import { EaCLicenseDetails } from "./EaCLicenseDetails.ts";
import { EaCLicensePlanAsCode } from "./EaCLicensePlanAsCode.ts";

export type EaCLicenseAsCode = {
  Plans: Record<string, EaCLicensePlanAsCode>;
} & EaCDetails<EaCLicenseDetails>;
