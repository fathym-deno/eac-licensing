import { EaCVertexDetails } from "./.deps.ts";

export type EaCLicensePlanDetails = {
  Features: string[];

  Featured?: string;

  Priority: number;
} & EaCVertexDetails;
