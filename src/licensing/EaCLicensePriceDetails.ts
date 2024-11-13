import { EaCVertexDetails } from "./.deps.ts";

export type EaCLicensePriceDetails = {
  Currency: string;

  Discount: number;

  Interval: string;

  Name: string;

  Value: number;
} & EaCVertexDetails;
