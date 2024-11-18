import { EaCBaseClient, EaCUserLicense } from "./.deps.ts";

export class EaCLicensingStewardClient extends EaCBaseClient {
  constructor(baseUrl: URL, apiToken: string) {
    super(baseUrl, apiToken);
  }

  public License = {
    Cancel: async (
      entLookup: string,
      username: string,
      licLookup: string,
    ): Promise<unknown> => {
      //: Promise<T> {
      const response = await fetch(
        this.loadClientUrl(
          `${entLookup}/licenses/${licLookup}?username=${username}`,
        ),
        {
          method: "DELETE",
          headers: this.loadHeaders(),
        },
      );

      return await this.json(response);
    },

    Get: async (
      entLookup: string,
      username: string,
      licLookup: string,
    ): Promise<{ Active: boolean; License: EaCUserLicense }> => {
      //: Promise<T> {
      const response = await fetch(
        this.loadClientUrl(
          `${entLookup}/licenses/${licLookup}?username=${username}`,
        ),
        {
          headers: this.loadHeaders(),
        },
      );

      return await this.json(response);
    },

    List: async (
      entLookup: string,
      username: string,
    ): Promise<Record<string, EaCUserLicense>> => {
      //: Promise<T> {
      const response = await fetch(
        this.loadClientUrl(`${entLookup}/licenses?username=${username}`),
        {
          headers: this.loadHeaders(),
        },
      );

      return await this.json(response);
    },

    Subscription: async (
      entLookup: string,
      username: string,
      licLookup: string,
      planLookup: string,
      priceLookup: string,
    ): Promise<unknown> => {
      //: Promise<T> {
      const response = await fetch(
        this.loadClientUrl(
          `${entLookup}/licenses/${licLookup}?username=${username}`,
        ),
        {
          method: "POST",
          headers: this.loadHeaders(),
          body: JSON.stringify({
            PlanLookup: planLookup,
            PriceLookup: priceLookup,
          }),
        },
      );

      return await this.json(response);
    },
  };
}
