import { EaCVertexDetails } from "./.deps.ts";

export type EaCLicensePlanDetails = {
  AccessConfigurationLookups?: string[];

  Features: string[];

  Featured?: string;

  Priority: number;

  TrialPeriodDays?: number;
} & EaCVertexDetails;
