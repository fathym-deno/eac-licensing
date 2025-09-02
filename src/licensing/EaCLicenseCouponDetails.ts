import { EaCVertexDetails } from "./.deps.ts";

export type EaCLicenseCouponDetails = {
  Name?: string;
  PercentOff?: number;
  AmountOff?: number;
  Currency?: string;
  Duration: "forever" | "once" | "repeating";
  DurationInMonths?: number;
} & EaCVertexDetails;
