import { join } from "node:path";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const environment = Config.schema(
  Schema.Literals(["local", "staging", "production"]),
  "MARKETPLACE_ENVIRONMENT",
);
const applicationStack = Config.String("APPLICATION_ALCHEMY_STACK").pipe(
  Config.withDefault("supernala-api"),
);
const applicationStage = Config.String("APPLICATION_ALCHEMY_STAGE");

/**
 * Marketplace-owned release journal plus read-only Alchemy references to application-owned stores.
 *
 * The references resolve the app stack's existing outputs; they do not adopt, import, create, migrate,
 * or transfer ownership of ApplicationDatabase or PluginPackages.
 */
export default Alchemy.Stack(
  "supernala-marketplace-release",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const deploymentEnvironment = yield* environment;
    const appStack = yield* applicationStack;
    const appStage = yield* applicationStage;
    if (appStage !== deploymentEnvironment) {
      throw new Error("Application resource stage must exactly match Marketplace environment");
    }

    const applicationDatabase = yield* Cloudflare.D1.Database.ref("ApplicationDatabase", {
      stack: appStack,
      stage: appStage,
    });
    const pluginPackages = yield* Cloudflare.R2.Bucket.ref("PluginPackages", {
      stack: appStack,
      stage: appStage,
    });

    const releaseJournal = yield* Cloudflare.D1.Database("MarketplaceReleaseJournal", {
      name: `supernala-marketplace-release-${deploymentEnvironment}`,
      migrations: join(import.meta.dirname, "migrations"),
    });

    return {
      environment: deploymentEnvironment,
      releaseJournalDatabaseId: releaseJournal.databaseId,
      applicationDatabaseId: applicationDatabase.databaseId,
      pluginPackageBucketName: pluginPackages.bucketName,
      applicationResourceOwner: `${appStack}/${appStage}`,
    };
  }),
);
