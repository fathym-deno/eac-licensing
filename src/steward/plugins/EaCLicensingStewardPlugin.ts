import {
  buildStewardApiPluginConfig,
  EaCAPIProcessor,
  EaCApplicationAsCode,
  EaCDistributedFileSystemDetails,
  EaCJSRDistributedFileSystemDetails,
  EaCLocalDistributedFileSystemDetails,
  EaCProjectAsCode,
  EaCRuntimeConfig,
  EaCRuntimePlugin,
  EaCRuntimePluginConfig,
  EaCStewardPluginOptions,
  EverythingAsCode,
  EverythingAsCodeApplications,
  EverythingAsCodeDenoKV,
  IoCContainer,
} from "./.deps.ts";

export type EaCLicensingStewardPluginOptions = EaCStewardPluginOptions;

export default class EaCLicensingStewardPlugin implements EaCRuntimePlugin {
  constructor(protected options?: EaCLicensingStewardPluginOptions) {}

  public Setup(_config: EaCRuntimeConfig): Promise<EaCRuntimePluginConfig> {
    const stewardApiMetaPath = import.meta.resolve(
      "../steward/api",
    );

    const pluginConfig: EaCRuntimePluginConfig<
      EverythingAsCode & EverythingAsCodeApplications & EverythingAsCodeDenoKV
    > = buildStewardApiPluginConfig(
      EaCLicensingStewardPlugin.name,
      stewardApiMetaPath,
      "core",
      "steward-licensing",
      "fathym:eac-licensing/api",
      "/api/steward/licensing*",
      "@fathym/eac-licensing",
      this.options ?? {},
    );

    return Promise.resolve(pluginConfig);
  }
}
