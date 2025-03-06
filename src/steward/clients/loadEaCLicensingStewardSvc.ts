import { loadJwtConfig } from "./.deps.ts";
import { EaCLicensingClient } from "./EaCLicensingClient.ts";

export async function loadEaCLicensingStewardSvc(): Promise<
  EaCLicensingClient
>;

export async function loadEaCLicensingStewardSvc(
  eacApiKey: string,
): Promise<EaCLicensingClient>;

export async function loadEaCLicensingStewardSvc(
  entLookup: string,
  username: string,
): Promise<EaCLicensingClient>;

export async function loadEaCLicensingStewardSvc(
  eacApiKeyEntLookup?: string,
  username?: string,
): Promise<EaCLicensingClient> {
  if (!eacApiKeyEntLookup) {
    eacApiKeyEntLookup = Deno.env.get("EAC_API_KEY");

    if (!eacApiKeyEntLookup) {
      eacApiKeyEntLookup = Deno.env.get("EAC_API_ENTERPRISE_LOOKUP");

      if (eacApiKeyEntLookup) {
        username = Deno.env.get("EAC_API_USERNAME");
      }
    }
  }

  if (username) {
    eacApiKeyEntLookup = await loadJwtConfig().Create(
      {
        EnterpriseLookup: eacApiKeyEntLookup,
        Username: username!,
      },
      60 * 60 * 1,
    );
  }

  const eacBaseUrl = Deno.env.get("EaCLicensingClient_URL")!;

  return new EaCLicensingClient(
    new URL(eacBaseUrl),
    eacApiKeyEntLookup ?? "",
  );
}
