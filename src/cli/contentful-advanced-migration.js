/**
 * Contentful Advanced Entry Migration Script
 *
 * This script migrates entries from one Contentful space to another,
 * including all their linked entries and assets, with support for:
 * - Configurable source and target spaces/environments
 * - Explicit entry exclusion list
 * - Recursive link traversal with configurable depth
 * - Robust error handling and detailed logging
 * - Rate limiting to avoid API throttling
 * - Asset processing
 *
 * @date ${new Date().toISOString().split('T')[0]}
 */

const contentful = require("contentful-management");
require("dotenv").config();
const logger = require("../utils/logger");

// Create a dedicated logger for this script
const migrationLogger = logger.createChild("migration");

// Configuration (can be overridden via CLI arguments)
const config = {
  sourceSpaceId: process.env.SPACE_ID_DE_DE,
  sourceEnvironmentId: process.env.ENV_DE_DE,
  targetSpaceId: process.env.SPACE_ID_FR_FR,
  targetEnvironmentId: process.env.ENV_FR_FR,
  accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  maxDepth: 4, // Maximum depth for traversing linked entries
  rateLimitDelay: 500, // Milliseconds between API calls to avoid rate limiting
  assetProcessingDelay: 1000, // Milliseconds to wait between asset processing attempts
  retryDelay: 2000, // Milliseconds to wait before retrying failed operations
  maxRetries: 3, // Maximum number of retries for failed operations
  excludedEntryIds: [], // Entry IDs to exclude from migration
  entryIds: [
    "7qwM0p7XUC4TSYg4xqKYYf",
    "2IEDSXtyMWbfMwVTpWdWyj",
    "s3KIC4Rw1kYeIFQ1urGSa",
  ], // Entry IDs to migrate (required)
  publishAfterMigration: false, // Whether to publish entries after migration
};

// Parse command line arguments to override configuration
function parseCommandLineArgs() {
  const argv = process.argv.slice(2);
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--source-space") {
      config.sourceSpaceId = argv[i + 1];
      i += 2;
    } else if (arg === "--source-env") {
      config.sourceEnvironmentId = argv[i + 1];
      i += 2;
    } else if (arg === "--target-space") {
      config.targetSpaceId = argv[i + 1];
      i += 2;
    } else if (arg === "--target-env") {
      config.targetEnvironmentId = argv[i + 1];
      i += 2;
    } else if (arg === "--token") {
      config.accessToken = argv[i + 1];
      i += 2;
    } else if (arg === "--depth") {
      config.maxDepth = parseInt(argv[i + 1], 10);
      i += 2;
    } else if (arg === "--exclude") {
      // Parse comma-separated list of entry IDs to exclude
      config.excludedEntryIds = argv[i + 1].split(",");
      i += 2;
    } else if (arg === "--entry") {
      // Parse comma-separated list of entry IDs to migrate
      config.entryIds = argv[i + 1].split(",");
      i += 2;
    } else if (arg === "--publish") {
      config.publishAfterMigration = argv[i + 1].toLowerCase() === "true";
      i += 2;
    } else if (arg === "--rate-limit-delay") {
      config.rateLimitDelay = parseInt(argv[i + 1], 10);
      i += 2;
    } else if (arg === "--asset-processing-delay") {
      config.assetProcessingDelay = parseInt(argv[i + 1], 10);
      i += 2;
    } else if (arg === "--retry-delay") {
      config.retryDelay = parseInt(argv[i + 1], 10);
      i += 2;
    } else if (arg === "--max-retries") {
      config.maxRetries = parseInt(argv[i + 1], 10);
      i += 2;
    } else if (arg === "--help") {
      printUsage();
      process.exit(0);
    } else {
      i++;
    }
  }

  // Validate required configuration
  validateConfig();
}

// Print usage information
function printUsage() {
  console.log(`
Contentful Advanced Entry Migration Script

Usage:
  node contentful-advanced-migration.js [options]

Options:
  --entry <ids>                  Comma-separated list of entry IDs to migrate (required)
  --exclude <ids>                Comma-separated list of entry IDs to exclude from migration
  --source-space <id>            Source space ID (default: from .env)
  --source-env <id>              Source environment ID (default: from .env)
  --target-space <id>            Target space ID (default: from .env)
  --target-env <id>              Target environment ID (default: from .env)
  --token <token>                Contentful management token (default: from .env)
  --depth <number>               Maximum depth for traversing linked entries (default: 4)
  --publish <true|false>         Whether to publish entries after migration (default: false)
  --rate-limit-delay <ms>        Delay between API calls to avoid rate limiting (default: 500ms)
  --asset-processing-delay <ms>  Delay between asset processing attempts (default: 1000ms)
  --retry-delay <ms>             Delay before retrying failed operations (default: 2000ms)  
  --max-retries <number>         Maximum number of retries for failed operations (default: 3)
  --help                         Print this usage information and exit
`);
}

// Validate required configuration
function validateConfig() {
  const requiredConfig = [
    { name: "sourceSpaceId", label: "Source space ID" },
    { name: "sourceEnvironmentId", label: "Source environment ID" },
    { name: "targetSpaceId", label: "Target space ID" },
    { name: "targetEnvironmentId", label: "Target environment ID" },
    { name: "accessToken", label: "Contentful management token" },
  ];

  const missingConfig = requiredConfig.filter((item) => !config[item.name]);

  if (missingConfig.length > 0) {
    migrationLogger.critical("Missing required configuration:");
    missingConfig.forEach((item) => {
      migrationLogger.critical(`- ${item.label}`);
    });
    process.exit(1);
  }

  if (!config.entryIds || config.entryIds.length === 0) {
    migrationLogger.critical(
      "No entry IDs specified for migration. Use --entry option."
    );
    process.exit(1);
  }
}

// Create a Contentful client
function createClient() {
  try {
    return contentful.createClient({ accessToken: config.accessToken });
  } catch (error) {
    migrationLogger.critical("Failed to create Contentful client:", error);
    process.exit(1);
  }
}

/**
 * Check if an entry or asset exists in the specified environment.
 *
 * @param {Object} env - Contentful environment object
 * @param {string} type - Type of resource ('entry' or 'asset')
 * @param {string} id - ID of the resource
 * @returns {Promise<boolean>} - Whether the resource exists
 */
async function resourceExists(env, type, id) {
  try {
    if (type === "entry") {
      await env.getEntry(id);
    } else if (type === "asset") {
      await env.getAsset(id);
    } else {
      throw new Error(`Invalid resource type: ${type}`);
    }
    return true;
  } catch (error) {
    if (error.name === "NotFound") {
      return false;
    }

    // Re-throw unexpected errors
    migrationLogger.error(`Error checking if ${type} ${id} exists:`, error);
    throw error;
  }
}

/**
 * Collect all linked entry and asset IDs for a given entry.
 *
 * @param {Object} env - Contentful environment object
 * @param {string} entryId - ID of the entry to start from
 * @param {Set<string>} foundEntries - Set of already found entry IDs
 * @param {Set<string>} foundAssets - Set of already found asset IDs
 * @param {number} depth - Current recursion depth
 * @param {number} maxDepth - Maximum recursion depth
 * @returns {Promise<Object>} - Object containing sets of entry and asset IDs
 */
async function getAllLinkedResources(
  env,
  entryId,
  foundEntries = new Set(),
  foundAssets = new Set(),
  depth = 0,
  maxDepth = config.maxDepth
) {
  // Skip if already processed or max depth reached
  if (foundEntries.has(entryId) || depth >= maxDepth) {
    return { entries: foundEntries, assets: foundAssets };
  }

  // Skip if entry is in the exclusion list
  if (config.excludedEntryIds.includes(entryId)) {
    migrationLogger.info(`Entry ${entryId} is in exclusion list, skipping`);
    return { entries: foundEntries, assets: foundAssets };
  }

  try {
    // Add current entry to found entries
    foundEntries.add(entryId);

    // Get the entry
    const entry = await env.getEntry(entryId);
    migrationLogger.debug(
      `Processing entry ${entryId} (content type: ${entry.sys.contentType.sys.id}) at depth ${depth}`
    );

    // Process all fields of the entry
    for (const field of Object.values(entry.fields)) {
      for (const localeVal of Object.values(field)) {
        // Process arrays of links
        if (Array.isArray(localeVal)) {
          for (const item of localeVal) {
            if (item && item.sys && item.sys.type === "Link") {
              if (
                item.sys.linkType === "Entry" &&
                !config.excludedEntryIds.includes(item.sys.id)
              ) {
                if (await resourceExists(env, "entry", item.sys.id)) {
                  await getAllLinkedResources(
                    env,
                    item.sys.id,
                    foundEntries,
                    foundAssets,
                    depth + 1,
                    maxDepth
                  );
                } else {
                  migrationLogger.warning(
                    `Linked entry ${item.sys.id} does not exist in source, skipping`
                  );
                }
              } else if (item.sys.linkType === "Asset") {
                if (await resourceExists(env, "asset", item.sys.id)) {
                  foundAssets.add(item.sys.id);
                } else {
                  migrationLogger.warning(
                    `Linked asset ${item.sys.id} does not exist in source, skipping`
                  );
                }
              }
            }
          }
        }
        // Process single links
        else if (localeVal && localeVal.sys && localeVal.sys.type === "Link") {
          if (
            localeVal.sys.linkType === "Entry" &&
            !config.excludedEntryIds.includes(localeVal.sys.id)
          ) {
            if (await resourceExists(env, "entry", localeVal.sys.id)) {
              await getAllLinkedResources(
                env,
                localeVal.sys.id,
                foundEntries,
                foundAssets,
                depth + 1,
                maxDepth
              );
            } else {
              migrationLogger.warning(
                `Linked entry ${localeVal.sys.id} does not exist in source, skipping`
              );
            }
          } else if (localeVal.sys.linkType === "Asset") {
            if (await resourceExists(env, "asset", localeVal.sys.id)) {
              foundAssets.add(localeVal.sys.id);
            } else {
              migrationLogger.warning(
                `Linked asset ${localeVal.sys.id} does not exist in source, skipping`
              );
            }
          }
        }
      }
    }

    return { entries: foundEntries, assets: foundAssets };
  } catch (error) {
    migrationLogger.error(
      `Error processing linked resources for entry ${entryId}:`,
      error
    );
    throw error;
  }
}

/**
 * Migrate a set of entries and their linked assets from source to target.
 *
 * @param {Object} sourceEnv - Source Contentful environment
 * @param {Object} targetEnv - Target Contentful environment
 * @param {Set<string>} entryIds - Set of entry IDs to migrate
 * @param {Set<string>} assetIds - Set of asset IDs to migrate
 * @returns {Promise<Object>} - Statistics about the migration
 */
async function migrateResources(sourceEnv, targetEnv, entryIds, assetIds) {
  const stats = {
    entriesProcessed: 0,
    entriesCreated: 0,
    entriesSkipped: 0,
    entriesPublished: 0,
    assetsProcessed: 0,
    assetsCreated: 0,
    assetsSkipped: 0,
    assetsPublished: 0,
    errors: [],
  };

  // Keep track of created resources to avoid duplicates
  const createdEntries = {};
  const createdAssets = {};

  // Process all entries first
  migrationLogger.info(`Starting migration of ${entryIds.size} entries`);
  migrationLogger.startTimer("entries-migration");

  for (const entryId of entryIds) {
    try {
      stats.entriesProcessed++;
      migrationLogger.debug(
        `Processing entry ${entryId} (${stats.entriesProcessed}/${entryIds.size})`
      );

      // Skip if entry already processed
      if (createdEntries[entryId]) {
        migrationLogger.debug(`Entry ${entryId} already processed, skipping`);
        stats.entriesSkipped++;
        continue;
      }

      // Skip if entry already exists in target
      if (await resourceExists(targetEnv, "entry", entryId)) {
        migrationLogger.info(
          `Entry ${entryId} already exists in target, skipping`
        );
        createdEntries[entryId] = true;
        stats.entriesSkipped++;
        continue;
      }

      // Get entry from source
      const entry = await sourceEnv.getEntry(entryId);

      // Deep copy fields to avoid modifying the original
      const fieldsCopy = JSON.parse(JSON.stringify(entry.fields));

      // Create entry in target
      const createdEntry = await targetEnv.createEntryWithId(
        entry.sys.contentType.sys.id,
        entryId,
        { fields: fieldsCopy }
      );

      createdEntries[entryId] = createdEntry;
      stats.entriesCreated++;
      migrationLogger.success(
        `Created entry ${entryId} (content type: ${entry.sys.contentType.sys.id})`
      );

      // Publish if configured
      if (config.publishAfterMigration) {
        try {
          await createdEntry.publish();
          stats.entriesPublished++;
          migrationLogger.success(`Published entry ${entryId}`);
        } catch (publishError) {
          migrationLogger.warning(
            `Failed to publish entry ${entryId}:`,
            publishError
          );
          stats.errors.push({
            type: "entry-publish",
            id: entryId,
            error: publishError.message,
          });
        }
      }

      // Rate limiting delay
      await new Promise((resolve) =>
        setTimeout(resolve, config.rateLimitDelay)
      );
    } catch (error) {
      // If the error is related to rate limiting or a temporary issue, retry once
      if (error.status === 429 || error.status >= 500) {
        migrationLogger.warning(
          `Rate limited or server error for entry ${entryId}, retrying after delay...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, config.rateLimitDelay * 4)
        ); // Longer delay for retries

        try {
          // Retry entry creation
          const entry = await sourceEnv.getEntry(entryId);
          const fieldsCopy = JSON.parse(JSON.stringify(entry.fields));
          const createdEntry = await targetEnv.createEntryWithId(
            entry.sys.contentType.sys.id,
            entryId,
            { fields: fieldsCopy }
          );

          createdEntries[entryId] = createdEntry;
          stats.entriesCreated++;
          migrationLogger.success(
            `Created entry ${entryId} on retry (content type: ${entry.sys.contentType.sys.id})`
          );

          // Publish if configured
          if (config.publishAfterMigration) {
            try {
              await createdEntry.publish();
              stats.entriesPublished++;
              migrationLogger.success(`Published entry ${entryId} on retry`);
            } catch (publishError) {
              migrationLogger.warning(
                `Failed to publish entry ${entryId} on retry:`,
                publishError
              );
            }
          }
        } catch (retryError) {
          migrationLogger.error(
            `Failed to process entry ${entryId} even after retry:`,
            retryError
          );
          stats.errors.push({
            type: "entry-create-retry",
            id: entryId,
            error: retryError.message,
          });
        }
      } else {
        migrationLogger.error(`Failed to process entry ${entryId}:`, error);
        stats.errors.push({
          type: "entry-create",
          id: entryId,
          error: error.message,
        });
      }
    }
  }

  const entriesDuration = migrationLogger.endTimer("entries-migration");
  migrationLogger.info(`Entries migration completed in ${entriesDuration}ms`);

  // Process all assets
  migrationLogger.info(`Starting migration of ${assetIds.size} assets`);
  migrationLogger.startTimer("assets-migration");

  for (const assetId of assetIds) {
    try {
      stats.assetsProcessed++;
      migrationLogger.debug(
        `Processing asset ${assetId} (${stats.assetsProcessed}/${assetIds.size})`
      );

      // Skip if asset already processed
      if (createdAssets[assetId]) {
        migrationLogger.debug(`Asset ${assetId} already processed, skipping`);
        stats.assetsSkipped++;
        continue;
      }

      // Skip if asset already exists in target
      if (await resourceExists(targetEnv, "asset", assetId)) {
        migrationLogger.info(
          `Asset ${assetId} already exists in target, skipping`
        );
        createdAssets[assetId] = true;
        stats.assetsSkipped++;
        continue;
      }

      // Get asset from source
      const asset = await sourceEnv.getAsset(assetId);

      // Create asset in target
      const createdAsset = await targetEnv.createAssetWithId(assetId, {
        fields: JSON.parse(JSON.stringify(asset.fields)),
      }); // Process asset files for each locale using our helper function
      for (const locale of Object.keys(asset.fields.file || {})) {
        try {
          await safelyProcessAssetFile(createdAsset, locale, migrationLogger);
        } catch (processError) {
          migrationLogger.warning(
            `Failed to process asset ${assetId} for locale ${locale}:`,
            processError
          );
          stats.errors.push({
            type: "asset-process",
            id: assetId,
            locale,
            error: processError.message,
          });
        }
      }

      createdAssets[assetId] = createdAsset;
      stats.assetsCreated++;
      migrationLogger.success(`Created asset ${assetId}`);

      // Publish if configured
      if (config.publishAfterMigration) {
        try {
          await createdAsset.publish();
          stats.assetsPublished++;
          migrationLogger.success(`Published asset ${assetId}`);
        } catch (publishError) {
          migrationLogger.warning(
            `Failed to publish asset ${assetId}:`,
            publishError
          );
          stats.errors.push({
            type: "asset-publish",
            id: assetId,
            error: publishError.message,
          });
        }
      }

      // Rate limiting delay
      await new Promise((resolve) =>
        setTimeout(resolve, config.rateLimitDelay)
      );
    } catch (error) {
      // If the error is related to rate limiting or a temporary issue, retry once
      if (error.status === 429 || error.status >= 500) {
        migrationLogger.warning(
          `Rate limited or server error for asset ${assetId}, retrying after delay...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, config.rateLimitDelay * 4)
        ); // Longer delay for retries

        try {
          // Retry asset creation
          const asset = await sourceEnv.getAsset(assetId);
          const createdAsset = await targetEnv.createAssetWithId(assetId, {
            fields: JSON.parse(JSON.stringify(asset.fields)),
          });
          // Process asset files for each locale using our helper function
          for (const locale of Object.keys(asset.fields.file || {})) {
            try {
              await safelyProcessAssetFile(
                createdAsset,
                locale,
                migrationLogger
              );
            } catch (retryProcessError) {
              migrationLogger.warning(
                `Failed to process asset ${assetId} for locale ${locale} during retry:`,
                retryProcessError
              );
              throw retryProcessError;
            }
          }

          createdAssets[assetId] = createdAsset;
          stats.assetsCreated++;
          migrationLogger.success(`Created asset ${assetId} on retry`);

          // Continue with the rest of the asset processing
          if (config.publishAfterMigration) {
            try {
              await createdAsset.publish();
              stats.assetsPublished++;
              migrationLogger.success(`Published asset ${assetId}`);
            } catch (publishError) {
              migrationLogger.warning(
                `Failed to publish asset ${assetId} on retry:`,
                publishError
              );
            }
          }
        } catch (retryError) {
          migrationLogger.error(
            `Failed to process asset ${assetId} even after retry:`,
            retryError
          );
          stats.errors.push({
            type: "asset-create-retry",
            id: assetId,
            error: retryError.message,
          });
        }
      } else {
        migrationLogger.error(`Failed to process asset ${assetId}:`, error);
        stats.errors.push({
          type: "asset-create",
          id: assetId,
          error: error.message,
        });
      }
    }
  }

  const assetsDuration = migrationLogger.endTimer("assets-migration");
  migrationLogger.info(`Assets migration completed in ${assetsDuration}ms`);

  return stats;
}

/**
 * Safely process asset files for a given locale, handling the "already processed" case.
 *
 * @param {Object} asset - The Contentful asset object
 * @param {string} locale - The locale to process
 * @param {Object} logger - Logger instance
 * @returns {Promise<boolean>} - Whether processing was needed/successful
 */
async function safelyProcessAssetFile(asset, locale, logger) {
  try {
    // Check if asset already has a URL (already processed)
    const hasUrl =
      asset.fields.file &&
      asset.fields.file[locale] &&
      asset.fields.file[locale].url;

    if (hasUrl) {
      logger.debug(
        `Asset ${asset.sys.id} for locale ${locale} already has URL, skipping processing`
      );
      return true;
    }

    logger.debug(`Processing asset ${asset.sys.id} for locale ${locale}`);
    await asset.processForLocale(locale);
    await asset.waitForProcess(locale);
    return true;
  } catch (error) {
    // Handle the "already processed" error
    if (
      error.message &&
      (error.message.includes("File has already been processed") ||
        error.message.includes("already being processed"))
    ) {
      logger.debug(
        `Asset ${asset.sys.id} for locale ${locale}: ${error.message}`
      );
      return true;
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Main migration function.
 */
async function runMigration() {
  migrationLogger.info(
    "Starting content migration with the following configuration:"
  );
  migrationLogger.info(
    `Source: Space ${config.sourceSpaceId}, Environment ${config.sourceEnvironmentId}`
  );
  migrationLogger.info(
    `Target: Space ${config.targetSpaceId}, Environment ${config.targetEnvironmentId}`
  );
  migrationLogger.info(`Entries to migrate: ${config.entryIds.length}`);

  if (config.excludedEntryIds.length > 0) {
    migrationLogger.info(`Excluded entries: ${config.excludedEntryIds.length}`);
  }

  migrationLogger.startTimer("total");

  try {
    // Create Contentful client
    const client = createClient();

    // Get source and target environments
    const sourceSpace = await client.getSpace(config.sourceSpaceId);
    const sourceEnv = await sourceSpace.getEnvironment(
      config.sourceEnvironmentId
    );

    const targetSpace = await client.getSpace(config.targetSpaceId);
    const targetEnv = await targetSpace.getEnvironment(
      config.targetEnvironmentId
    );

    // Arrays to hold all resources to migrate
    const allEntriesToMigrate = new Set();
    const allAssetsToMigrate = new Set();

    // Process each entry ID
    for (const entryId of config.entryIds) {
      migrationLogger.info(`Collecting linked resources for entry ${entryId}`);

      // Skip if entry doesn't exist in source
      if (!(await resourceExists(sourceEnv, "entry", entryId))) {
        migrationLogger.warning(
          `Entry ${entryId} does not exist in source, skipping`
        );
        continue;
      }

      // Collect linked resources
      const { entries, assets } = await getAllLinkedResources(
        sourceEnv,
        entryId,
        new Set(),
        new Set(),
        0,
        config.maxDepth
      );

      // Add to migration lists
      entries.forEach((id) => allEntriesToMigrate.add(id));
      assets.forEach((id) => allAssetsToMigrate.add(id));
    }

    // Log resources to migrate
    migrationLogger.info(
      `Found ${allEntriesToMigrate.size} entries and ${allAssetsToMigrate.size} assets to migrate`
    );

    // Remove excluded entries from migration list
    if (config.excludedEntryIds.length > 0) {
      const beforeSize = allEntriesToMigrate.size;
      config.excludedEntryIds.forEach((id) => allEntriesToMigrate.delete(id));
      migrationLogger.info(
        `Removed ${
          beforeSize - allEntriesToMigrate.size
        } excluded entries from migration list`
      );
    }

    // Migrate resources
    const stats = await migrateResources(
      sourceEnv,
      targetEnv,
      allEntriesToMigrate,
      allAssetsToMigrate
    );

    // Log statistics
    const totalDuration = migrationLogger.endTimer("total");
    migrationLogger.success(`Migration completed in ${totalDuration}ms`);
    migrationLogger.success(
      `Entries: ${stats.entriesCreated} created, ${stats.entriesSkipped} skipped, ${stats.entriesPublished} published`
    );
    migrationLogger.success(
      `Assets: ${stats.assetsCreated} created, ${stats.assetsSkipped} skipped, ${stats.assetsPublished} published`
    );

    if (stats.errors.length > 0) {
      migrationLogger.warning(
        `Encountered ${stats.errors.length} errors during migration`
      );
      migrationLogger.group("Errors:");
      stats.errors.forEach((error) => {
        migrationLogger.error(`${error.type} (${error.id}): ${error.error}`);
      });
      migrationLogger.groupEnd();
    }
  } catch (error) {
    migrationLogger.critical("Migration failed with an error:", error);
    process.exit(1);
  }
}

// Parse command line arguments and run migration
parseCommandLineArgs();
runMigration()
  .then(() => {
    migrationLogger.success("Migration process completed successfully");
  })
  .catch((error) => {
    migrationLogger.critical("Unhandled error during migration:", error);
    process.exit(1);
  });
