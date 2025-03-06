import { loadJwtConfig } from "./.deps.ts";
import { EaCLicensingStewardClient } from "./EaCLicensingStewardClient.ts";

export async function loadEaCLicensingStewardSvc(): Promise<
  EaCLicensingStewardClient
>;

export async function loadEaCLicensingStewardSvc(
  eacApiKey: string,
): Promise<EaCLicensingStewardClient>;

export async function loadEaCLicensingStewardSvc(
  entLookup: string,
  username: string,
): Promise<EaCLicensingStewardClient>;

export async function loadEaCLicensingStewardSvc(
  eacApiKeyEntLookup?: string,
  username?: string,
): Promise<EaCLicensingStewardClient> {
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

  const eacBaseUrl = Deno.env.get("EaCLicensingStewardClient_URL")!;

  return new EaCLicensingStewardClient(
    new URL(eacBaseUrl),
    eacApiKeyEntLookup ?? "",
  );
}
