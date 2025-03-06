import { loadJwtConfig } from "./.deps.ts";
import { EaCLicensingClient } from "./EaCLicensingClient.ts";

export async function loadEaCLicensingSvc(): Promise<
  EaCLicensingClient
>;

export async function loadEaCLicensingSvc(
  eacApiKey: string,
): Promise<EaCLicensingClient>;

export async function loadEaCLicensingSvc(
  entLookup: string,
  username: string,
): Promise<EaCLicensingClient>;

export async function loadEaCLicensingSvc(
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
