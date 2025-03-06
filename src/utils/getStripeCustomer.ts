import { Stripe } from "./.deps.ts";

export async function getStripeCustomer(
  stripe: Stripe,
  username: string,
): Promise<Stripe.Customer | undefined> {
  const customers = await stripe.customers.search({
    query: `email:"${username}"`,
    limit: 100,
  });

  let customer: Stripe.Customer | undefined = undefined;

  let i = 0;
  while (!customer && i < customers.data.length) {
    customer = customers.data[i];

    if (customer) {
      const check = await stripe.customers.retrieve(customer.id);

      if (check.deleted) {
        customer = undefined;
      }
    }

    i++;
  }

  return customer;
}
