import { EaCLicenseStripeDetails } from "../licensing/EaCLicenseStripeDetails.ts";
import { eacGetSecrets, loadMainSecretClient, Stripe } from "./.deps.ts";

export async function loadStripe(
  stripeDetails: EaCLicenseStripeDetails,
): Promise<Stripe> {
  const secretClient = await loadMainSecretClient();

  const secreted = await eacGetSecrets(secretClient, {
    PublishableKey: stripeDetails.PublishableKey,
    SecretKey: stripeDetails.SecretKey,
    WebhookSecret: stripeDetails.WebhookSecret,
  });

  stripeDetails = {
    ...stripeDetails,
    ...secreted,
  };

  // deno-lint-ignore no-explicit-any
  const stripe = (Stripe as any)(stripeDetails.SecretKey)!;

  return stripe;
}
