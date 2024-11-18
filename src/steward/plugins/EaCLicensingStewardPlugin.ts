import { EverythingAsCode } from "jsr:@fathym/eac@0.2.17";
import {
  EaCDistributedFileSystemDetails,
  EaCJSRDistributedFileSystemDetails,
  EaCLocalDistributedFileSystemDetails,
  IoCContainer,
} from "./.deps.ts";
import { EaCRuntimeConfig } from "jsr:@fathym/eac@0.2.17/runtime/config";
import {
  EaCRuntimePlugin,
  EaCRuntimePluginConfig,
} from "jsr:@fathym/eac@0.2.17/runtime/plugins";
import {
  EaCApplicationAsCode,
  EaCProjectAsCode,
  EverythingAsCodeApplications,
} from "jsr:@fathym/eac-applications@0.0.20";
import { EverythingAsCodeDenoKV } from "jsr:@fathym/eac-deno-kv@0.0.4";
import { EaCAPIProcessor } from "jsr:@fathym/eac-applications@0.0.20/processors";

export type EaCLicensingStewardPluginOptions = {
  DFS?: {
    Details?: EaCDistributedFileSystemDetails;

    Lookup?: string;
  };

  Application?: {
    JWTValidationModifier?: {
      Lookup?: string;

      Priority?: number;
    };

    Lookup?: string;

    Path?: string;

    Priority?: number;
  };

  Project?: {
    Lookup?: string;
  };
};

export default class EaCLicensingStewardPlugin implements EaCRuntimePlugin {
  constructor(protected options?: EaCLicensingStewardPluginOptions) {}

  public Setup(_config: EaCRuntimeConfig): Promise<EaCRuntimePluginConfig> {
    const stewardApiMetaPath = import.meta.resolve("../steward/api/eac");

    const fileScheme = "file:///";

    const projLookup = this.options?.Project?.Lookup ?? "core";

    const appLookup = this.options?.Application?.Lookup ?? "steward-licensing";

    const dfsLookup = this.options?.DFS?.Lookup ?? "steward:api/eac/licensing";

    const jwtValidationLookup = this.options?.Application?.JWTValidationModifier
      ?.Lookup;

    const pluginConfig: EaCRuntimePluginConfig<
      EverythingAsCode & EverythingAsCodeApplications & EverythingAsCodeDenoKV
    > = {
      Name: EaCLicensingStewardPlugin.name,
      IoC: new IoCContainer(),
      EaC: {
        Projects: {
          [projLookup]: {
            ApplicationResolvers: {
              [appLookup]: {
                PathPattern: this.options?.Application?.Path ??
                  "/api/steward/licensing*",
                Priority: this.options?.Application?.Priority ?? 700,
              },
            },
          } as EaCProjectAsCode,
        },
        Applications: {
          [appLookup]: {
            Details: {
              Name: "Steward Licensing API Endpoints",
              Description: "The Steward Licensing API endpoints to use.",
            },
            ModifierResolvers: {
              ...(jwtValidationLookup
                ? {
                  [jwtValidationLookup]: {
                    Priority: this.options!.Application!.JWTValidationModifier!
                      .Priority ?? 900,
                  },
                }
                : {}),
            },
            Processor: {
              Type: "API",
              DFSLookup: dfsLookup,
            } as EaCAPIProcessor,
          } as EaCApplicationAsCode,
        },
        DFSs: {
          dfsLookup: {
            Details: this.options?.DFS?.Details ??
                stewardApiMetaPath.startsWith(fileScheme)
              ? ({
                Type: "Local",
                FileRoot: stewardApiMetaPath.slice(fileScheme.length),
                DefaultFile: "index.ts",
                Extensions: ["ts"],
                WorkerPath: import.meta.resolve(
                  "@fathym/eac-dfs/workers/local",
                ),
              } as EaCLocalDistributedFileSystemDetails)
              : ({
                Type: "JSR",
                Package: "@fathym/eac-licensing",
                Version: "",
                FileRoot: "/src/steward/api/eac/",
                DefaultFile: "index.ts",
                Extensions: ["ts"],
                WorkerPath: import.meta.resolve(
                  "@fathym/eac-dfs/workers/jsr",
                ),
              } as EaCJSRDistributedFileSystemDetails),
          },
        },
      },
    };

    return Promise.resolve(pluginConfig);
  }
}
