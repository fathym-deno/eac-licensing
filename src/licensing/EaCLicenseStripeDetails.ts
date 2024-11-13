import { EaCVertexDetails } from "./.deps.ts";

export type EaCLicenseStripeDetails = {
  Enabled: boolean;

  PublishableKey: string;

  SecretKey: string;

  WebhookSecret: string;
} & EaCVertexDetails;
