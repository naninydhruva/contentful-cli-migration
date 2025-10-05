/**
 * Contentful Content Type Transformation Script
 *
 * This script migrates entries from source content types to target content types
 * based on configurable mappings. It handles:
 * - Multiple content type mappings (only updates explicitly mapped fields)
 * - Referenced entries migration
 * - Linked assets migration with proper locale handling
 * - Locale processing and error handling
 * - Rate limiting and exceptions
 *
 * Usage:
 *   node cf-source-target-cli.js --entry-id <entry-id> --config-file <config-file-path>
 *
 * Additional options:
 *   --source-env <env-id>          Source environment ID (default: from .env)
 *   --source-space <space-id>      Source space ID (default: from .env)
 *   --target-env <env-id>          Target environment ID (default: from .env)
 *   --target-space <space-id>      Target space ID (default: from .env)
 *   --publish                      Publish entries after creation
 *   --verbose                      Enable detailed logging
 *   --config-file                  Path to config file (default: ./content-type-mappings.json)
 *
 * Example:
 *   node cf-source-target-cli.js --entry-id 12345 --config-file ./my-mappings.json
 */

const contentful = require("contentful-management");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
require("dotenv").config();

// Create a dedicated logger for this script
const migrationLogger = logger.createChild("content-transform");

// Default configuration
const config = {
  sourceSpaceId: process.env.SPACE_ID_DE_DE,
  sourceEnvironmentId: process.env.ENV_DE_DE,
  targetSpaceId: process.env.SPACE_ID_FR_FR,
  targetEnvironmentId: process.env.ENV_FR_FR,
  accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  entryIds: [
    "7qwM0p7XUC4TSYg4xqKYYf",
    "2IEDSXtyMWbfMwVTpWdWyj",
    "s3KIC4Rw1kYeIFQ1urGSa",
  ], // Support multiple entry IDs
  assetIds: ["19GzwBfB1sZT0yrFnRxxZS"], // Support multiple asset IDs
  migrationType: "entry", // Can be "entry", "asset", or "both"
  configFile: path.join(__dirname, "content-type-mappings.json"),
  defaultLocale: "en-US",
  publish: false,
  verbose: false,
  skipExisting: true, // Skip entries/assets that already exist instead of updating them
  enableCrossSpaceMigration: true, // Enable automatic cross-space asset migration
  rateLimitDelay: 500,
  maxRetries: 5,
  processedEntries: new Set(), // Track already processed entries to avoid duplicates
  processedAssets: new Set(), // Track already processed assets to avoid duplicates
};

// Content type mappings will be loaded from the config file
let contentTypeMappings = [];

// Cache for content types
const contentTypeCache = new Map();

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case "--migration-type":
        const type = args[++i].toLowerCase();
        if (["entry", "asset", "both"].includes(type)) {
          config.migrationType = type;
        } else {
          migrationLogger.error(
            "Invalid migration type. Must be 'entry', 'asset', or 'both'"
          );
          process.exit(1);
        }
        break;
      case "--entry-id":
        // Support single entry ID for backward compatibility
        config.entryIds = [args[++i]];
        break;
      case "--entry-ids":
        // Support comma-separated list of entry IDs
        config.entryIds = args[++i].split(",").map((id) => id.trim());
        break;
      case "--asset-id":
        // Support single asset ID
        config.assetIds = [args[++i]];
        break;
      case "--asset-ids":
        // Support comma-separated list of asset IDs
        config.assetIds = args[++i].split(",").map((id) => id.trim());
        break;
      case "--config-file":
        config.configFile = args[++i];
        break;
      case "--source-env":
        config.sourceEnvironmentId = args[++i];
        break;
      case "--source-space":
        config.sourceSpaceId = args[++i];
        break;
      case "--target-env":
        config.targetEnvironmentId = args[++i];
        break;
      case "--target-space":
        config.targetSpaceId = args[++i];
        break;
      case "--default-locale":
        config.defaultLocale = args[++i];
        break;
      case "--publish":
        config.publish = true;
        break;
      case "--verbose":
        config.verbose = true;
        break;
      case "--skip-existing":
        config.skipExisting = true;
        break;
      case "--update-existing":
        config.skipExisting = false;
        break;
      case "--enable-cross-space-migration":
        config.enableCrossSpaceMigration = true;
        break;
      case "--disable-cross-space-migration":
        config.enableCrossSpaceMigration = false;
        break;
      case "--help":
        printUsage();
        process.exit(0);
      default:
        migrationLogger.warn(`Unknown argument: ${arg}`);
    }
    i++;
  } // Validate required parameters
  if (
    config.migrationType === "entry" &&
    (!config.entryIds || config.entryIds.length === 0)
  ) {
    migrationLogger.error(
      "Missing required entry ID parameter for entry migration"
    );
    printUsage();
    process.exit(1);
  }

  if (
    config.migrationType === "asset" &&
    (!config.assetIds || config.assetIds.length === 0)
  ) {
    migrationLogger.error(
      "Missing required asset ID parameter for asset migration"
    );
    printUsage();
    process.exit(1);
  }

  if (
    config.migrationType === "both" &&
    (!config.entryIds ||
      !config.assetIds ||
      (config.entryIds.length === 0 && config.assetIds.length === 0))
  ) {
    migrationLogger.error(
      "Missing required entry ID or asset ID parameters for 'both' migration type"
    );
    printUsage();
    process.exit(1);
  }

  // Load content type mappings
  loadContentTypeMappings();
}

// Print usage instructions
function printUsage() {
  console.log(`
Usage: node cf-source-target-cli.js --migration-type <type> [options]

Migration Type (required):
  --migration-type <type>  Type of migration to perform: 'entry', 'asset', or 'both'

Entry Migration:
  --entry-id <id>         ID of a single entry to migrate
  --entry-ids <ids>       Comma-separated list of entry IDs to migrate

Asset Migration:
  --asset-id <id>         ID of a single asset to migrate
  --asset-ids <ids>       Comma-separated list of asset IDs to migrate

Optional:
  --config-file <path>    Path to content type mappings config file
  --source-env <env>      Source environment ID (default: from .env)
  --source-space <space>  Source space ID (default: from .env)
  --target-env <env>      Target environment ID (default: from .env)
  --target-space <space>  Target space ID (default: from .env)
  --default-locale <loc>  Default locale to use (default: en-US)
  --publish              Publish after creation
  --verbose             Enable detailed logging
  --skip-existing       Skip entries/assets that already exist (default)
  --update-existing     Update entries/assets that already exist
  --enable-cross-space-migration   Enable automatic cross-space asset migration (default)
  --disable-cross-space-migration  Disable automatic cross-space asset migration
  --help                Show this help message

Examples:
  # Migrate a single entry
  node cf-source-target-cli.js --migration-type entry --entry-id abc123

  # Migrate multiple assets
  node cf-source-target-cli.js --migration-type asset --asset-ids abc123,def456

  # Migrate both entries and assets
  node cf-source-target-cli.js --migration-type both --entry-ids abc123,def456 --asset-ids ghi789,jkl012

  # Migrate assets with cross-space migration enabled (default)
  node cf-source-target-cli.js --migration-type asset --asset-ids abc123 --enable-cross-space-migration

  # Migrate assets with cross-space migration disabled
  node cf-source-target-cli.js --migration-type asset --asset-ids abc123 --disable-cross-space-migration

Cross-Space Asset Migration:
  When enabled (default), the script automatically detects asset file URLs that reference
  assets from different Contentful spaces and migrates them by:
  1. Downloading the original file from the source space
  2. Uploading it to the target space via Contentful's Upload API
  3. Updating the asset with the new file URL before processing

Config file format (JSON):
  [
    {
      "sourceContentType": "blogPost",
      "targetContentType": "article",
      "fieldMappings": {
        "headline": "title",
        "content": "body"
      }
    },
    ...
  ]
`);
}

/**
 * Load content type mappings from config file
 */
function loadContentTypeMappings() {
  try {
    if (!fs.existsSync(config.configFile)) {
      // Create default mapping config if it doesn't exist
      if (path.basename(config.configFile) === "content-type-mappings.json") {
        const defaultMappings = [
          {
            sourceContentType: "blogPost",
            targetContentType: "article",
            fieldMappings: {
              // Key is target field, value is source field
              // "targetFieldName": "sourceFieldName"
            },
          },
        ];
        fs.writeFileSync(
          config.configFile,
          JSON.stringify(defaultMappings, null, 2)
        );
        migrationLogger.info(
          `Created default mapping file at ${config.configFile}`
        );
      } else {
        migrationLogger.error(`Config file not found: ${config.configFile}`);
        process.exit(1);
      }
    }

    const mappingsData = fs.readFileSync(config.configFile, "utf8");
    contentTypeMappings = JSON.parse(mappingsData);

    if (
      !Array.isArray(contentTypeMappings) ||
      contentTypeMappings.length === 0
    ) {
      migrationLogger.error(
        "Config file must contain an array of content type mappings"
      );
      process.exit(1);
    }

    migrationLogger.info(
      `Loaded ${contentTypeMappings.length} content type mappings`
    );
  } catch (error) {
    migrationLogger.error(
      `Failed to load content type mappings: ${error.message}`
    );
    process.exit(1);
  }
}

/**
 * Retry a function with exponential backoff for rate limiting
 * @param {Function} fn - The async function to execute
 * @param {string} operation - Name of the operation for logging
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, operation) {
  let attempt = 0;

  while (attempt < config.maxRetries) {
    try {
      return await fn();
    } catch (error) {
      // Check if it's a rate limit error
      if (error.name === "RateLimitExceeded") {
        const wait = (error.retryAfter || 2 ** attempt) * 1000;
        migrationLogger.warn(
          `Rate limit hit during ${operation}. Retrying in ${wait}ms... (Attempt ${
            attempt + 1
          }/${config.maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
        attempt++;
      } else {
        // For non-rate limit errors, throw immediately
        throw error;
      }
    }
  }

  throw new Error(
    `Operation ${operation} failed after ${config.maxRetries} attempts due to rate limits.`
  );
}

/**
 * Get the Contentful environment
 * @param {string} spaceId - The space ID
 * @param {string} environmentId - The environment ID
 * @returns {Promise<import('contentful-management').Environment>}
 */
async function getEnvironment(spaceId, environmentId) {
  const client = contentful.createClient({ accessToken: config.accessToken });
  const space = await client.getSpace(spaceId);
  return space.getEnvironment(environmentId);
}

/**
 * Find the mapping for a specific content type
 * @param {string} contentTypeId - The source content type ID
 * @returns {object|null} - The mapping object or null if not found
 */
function findMappingForContentType(contentTypeId) {
  return (
    contentTypeMappings.find(
      (mapping) => mapping.sourceContentType === contentTypeId
    ) || null
  );
}

/**
 * Get the target field name based on mapping
 * @param {string} sourceContentTypeId - The source content type ID
 * @param {string} sourceFieldId - The source field ID
 * @returns {string} - The target field ID
 */
function getTargetFieldName(sourceContentTypeId, sourceFieldId) {
  const mapping = findMappingForContentType(sourceContentTypeId);

  if (!mapping || !mapping.fieldMappings) {
    // If no mapping found, use the same field name
    return sourceFieldId;
  }

  // Return the mapped field name or the original if no mapping exists
  return mapping.fieldMappings[sourceFieldId] || sourceFieldId;
}

/**
 * Core asset migration logic - shared by processAsset and migrateAsset
 * @param {string} assetId - The asset ID to migrate
 * @param {import('contentful-management').Environment} sourceEnv - Source environment
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 * @param {boolean} forReference - Whether this is for a reference (affects return value and error handling)
 * @returns {Promise<object|null>} - Returns the migrated asset or null/throws based on context
 */
async function migrateAssetCore(
  assetId,
  sourceEnv,
  targetEnv,
  forReference = false
) {
  // Skip if we've already processed this asset
  if (config.processedAssets.has(assetId)) {
    if (config.verbose) {
      migrationLogger.info(`Asset ${assetId} already processed, skipping`);
    }
    return forReference
      ? { sys: { type: "Link", linkType: "Asset", id: assetId } }
      : null;
  }

  try {
    // Mark as processed to avoid duplicates
    config.processedAssets.add(assetId);

    migrationLogger.info(
      `${
        forReference ? "Processing asset reference" : "Migrating asset"
      } ${assetId}...`
    );

    // Get the asset from source environment
    const sourceAsset = await retryWithBackoff(
      () => sourceEnv.getAsset(assetId),
      `get source asset ${assetId}`
    );

    // Check if asset exists in target environment
    let targetAsset;
    let assetExists = false;

    try {
      targetAsset = await retryWithBackoff(
        () => targetEnv.getAsset(assetId),
        `check target asset ${assetId}`
      );

      assetExists = true;

      if (config.skipExisting) {
        migrationLogger.info(
          `Asset ${assetId} already exists in target environment, skipping`
        );
        return forReference
          ? { sys: { type: "Link", linkType: "Asset", id: assetId } }
          : targetAsset;
      } else {
        migrationLogger.info(
          `Asset ${assetId} already exists in target environment, will update if needed`
        );
      }
    } catch (error) {
      if (error.name !== "NotFound") {
        migrationLogger.error(
          `Error checking asset existence: ${error.message}`
        );
        throw error;
      }
      // Asset doesn't exist, will create it
      assetExists = false;
    }

    if (!assetExists) {
      // Create new asset in target environment
      migrationLogger.info(`Creating asset ${assetId} in target environment`);

      // Get available locales in the target environment
      const availableLocales = (await targetEnv.getLocales()).items.map(
        (locale) => locale.code
      );

      // Map source asset fields to target asset fields with appropriate locales
      const mappedFields = {};

      for (const [fieldId, fieldValue] of Object.entries(sourceAsset.fields)) {
        mappedFields[fieldId] = {};

        for (const [locale, value] of Object.entries(fieldValue)) {
          // Use the locale if available in target, otherwise use default
          const targetLocale = availableLocales.includes(locale)
            ? locale
            : config.defaultLocale;

          mappedFields[fieldId][targetLocale] = value;
        }
      }

      // Create the asset with the same ID in target environment
      targetAsset = await retryWithBackoff(
        () => targetEnv.createAssetWithId(assetId, { fields: mappedFields }),
        `create asset ${assetId}`
      );

      migrationLogger.success(`Asset ${assetId} created in target environment`);
    }

    // Process the asset in TARGET environment (this is crucial for cross-space migration)
    migrationLogger.info(
      `Processing asset ${assetId} in target environment...`
    );
    await processAssetWithErrorHandling(targetAsset, assetId, targetEnv);

    // Publish the asset if requested
    if (config.publish) {
      try {
        await retryWithBackoff(
          () => targetAsset.publish(),
          `publish asset ${assetId}`
        );
        migrationLogger.success(`Asset ${assetId} published successfully`);
      } catch (publishError) {
        migrationLogger.warning(
          `Failed to publish asset ${assetId}: ${publishError.message}`
        );
        // Don't fail the entire migration for publish errors
      }
    }

    migrationLogger.success(
      `Asset ${assetId} ${
        forReference ? "reference processing" : "migration"
      } completed successfully`
    );

    return forReference
      ? { sys: { type: "Link", linkType: "Asset", id: assetId } }
      : targetAsset;
  } catch (error) {
    migrationLogger.error(
      `Failed to ${
        forReference ? "process asset reference" : "migrate asset"
      } ${assetId}: ${error.message}`
    );

    // Enhanced error reporting
    if (error.details) {
      migrationLogger.error(
        `Error details: ${JSON.stringify(error.details, null, 2)}`
      );
    }

    // Remove from processed set so it can be retried if needed
    config.processedAssets.delete(assetId);

    if (forReference) {
      // For references, return null to indicate processing failed but don't stop entire migration
      return null;
    } else {
      // For direct migration, rethrow the error
      throw error;
    }
  }
}

/**
 * Process and migrate an asset reference (used within entry processing)
 * @param {object} assetLink - The asset link object
 * @param {import('contentful-management').Environment} sourceEnv - Source environment
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 * @returns {Promise<object|null>} - Returns the asset link or null if processing failed
 */
async function processAsset(assetLink, sourceEnv, targetEnv) {
  const assetId = assetLink.sys.id;
  return await migrateAssetCore(assetId, sourceEnv, targetEnv, true);
}

/**
 * Process and migrate a referenced entry
 * @param {object} entryLink - The entry link object
 * @param {import('contentful-management').Environment} sourceEnv - Source environment
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 * @returns {Promise<object|null>} - Returns the entry link or null if processing failed
 */
async function processReferencedEntry(entryLink, sourceEnv, targetEnv) {
  const entryId = entryLink.sys.id;

  // Skip if we've already processed this entry
  if (config.processedEntries.has(entryId)) {
    return entryLink;
  }

  try {
    // Mark as processed to avoid circular references
    config.processedEntries.add(entryId);

    // Get the entry from source environment
    const sourceEntry = await retryWithBackoff(
      () => sourceEnv.getEntry(entryId),
      `get referenced entry ${entryId}`
    );

    // Get content type of the referenced entry
    const contentTypeId = sourceEntry.sys.contentType.sys.id;
    const mapping = findMappingForContentType(contentTypeId);
    if (!mapping) {
      // If no mapping found for this content type, check if it has reference fields
      migrationLogger.info(
        `No mapping found for referenced content type ${contentTypeId}, checking for nested references in entry ${entryId}`
      );

      // Process any reference fields inside this entry even if we can't migrate the entry itself
      await processEntryReferences(sourceEntry, sourceEnv, targetEnv);

      // Keep the original reference
      return entryLink;
    }

    // Migrate the referenced entry
    const targetContentTypeId = mapping.targetContentType;

    migrationLogger.info(
      `Found mapping for referenced content type ${contentTypeId} -> ${targetContentTypeId}, migrating entry ${entryId}`
    );

    // Check if we should skip existing entries
    if (config.skipExisting) {
      // Check if entry exists in target
      try {
        await targetEnv.getEntry(entryId);
        migrationLogger.info(
          `Referenced entry ${entryId} already exists in target environment. Skipping.`
        );
        return entryLink;
      } catch (checkError) {
        if (checkError.name !== "NotFound") {
          throw checkError;
        }
        // Entry doesn't exist, proceed with migration
      }
    }

    // Process the entry recursively
    await migrateEntry(entryId, sourceEnv, targetEnv);

    // If target content type is different, update the reference
    if (targetContentTypeId !== contentTypeId) {
      migrationLogger.info(
        `Referenced content type changed from ${contentTypeId} to ${targetContentTypeId}, updating reference`
      );
      return {
        sys: {
          type: "Link",
          linkType: "Entry",
          id: entryId,
        },
      };
    }

    // Return the original entry link
    return entryLink;
  } catch (error) {
    migrationLogger.error(
      `Failed to process referenced entry ${entryId}:`,
      error
    );

    // Return the original link, as references to missing entries are better than no references
    return entryLink;
  }
}

/**
 * Checks if a field value is a reference (Asset or Entry)
 * @param {any} value - The field value to check
 * @returns {boolean} - True if the value is a reference field
 */
function isReferenceField(value) {
  // Handle single value
  if (value && typeof value === "object" && value.sys) {
    if (
      value.sys.type === "Link" &&
      (value.sys.linkType === "Entry" || value.sys.linkType === "Asset")
    ) {
      return true;
    }
  }

  // Handle array of values
  if (Array.isArray(value) && value.length > 0) {
    const firstItem = value[0];
    if (
      firstItem &&
      typeof firstItem === "object" &&
      firstItem.sys &&
      firstItem.sys.type === "Link" &&
      (firstItem.sys.linkType === "Entry" || firstItem.sys.linkType === "Asset")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Process field value for migration
 * @param {any} value - The field value
 * @param {import('contentful-management').Environment} sourceEnv - Source environment
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 * @returns {Promise<any>} - The processed value
 */
async function processFieldValue(value, sourceEnv, targetEnv) {
  try {
    // If the value is an array, process each item
    if (Array.isArray(value)) {
      const processedArray = [];

      for (const item of value) {
        try {
          // Process links
          if (item && item.sys && item.sys.type === "Link") {
            if (item.sys.linkType === "Asset") {
              // Process linked asset - ensure it's processed in target environment
              migrationLogger.info(
                `Processing asset reference: ${item.sys.id}`
              );
              const validAsset = await processAsset(item, sourceEnv, targetEnv);
              if (validAsset) {
                processedArray.push(validAsset);
              } else {
                migrationLogger.warning(
                  `Asset ${item.sys.id} processing failed, excluding from references`
                );
              }
            } else if (item.sys.linkType === "Entry") {
              // Process linked entry
              migrationLogger.info(
                `Processing entry reference: ${item.sys.id}`
              );
              const validEntry = await processReferencedEntry(
                item,
                sourceEnv,
                targetEnv
              );
              if (validEntry) {
                processedArray.push(validEntry);
              } else {
                migrationLogger.warning(
                  `Entry ${item.sys.id} processing failed, excluding from references`
                );
              }
            } else {
              // For other link types, just keep them as is
              processedArray.push(item);
            }
          } else {
            // For non-link items, keep them as is
            processedArray.push(item);
          }
        } catch (itemError) {
          migrationLogger.error(
            `Error processing array item: ${itemError.message}`
          );
          // Continue with other items, don't fail the entire array
        }
      }

      return processedArray;
    }

    // If the value is a link
    if (value && value.sys && value.sys.type === "Link") {
      if (value.sys.linkType === "Asset") {
        migrationLogger.info(
          `Processing single asset reference: ${value.sys.id}`
        );

        try {
          const processedAsset = await processAsset(
            value,
            sourceEnv,
            targetEnv
          );
          return processedAsset;
        } catch (assetError) {
          migrationLogger.error(
            `Failed to process asset ${value.sys.id}: ${assetError.message}`
          );
          // Return the original reference if processing fails
          return value;
        }
      } else if (value.sys.linkType === "Entry") {
        migrationLogger.info(
          `Processing single entry reference: ${value.sys.id}`
        );

        try {
          const processedEntry = await processReferencedEntry(
            value,
            sourceEnv,
            targetEnv
          );
          return processedEntry;
        } catch (entryError) {
          migrationLogger.error(
            `Failed to process entry ${value.sys.id}: ${entryError.message}`
          );
          // Return the original reference if processing fails
          return value;
        }
      }
    }

    // For other types, return as is
    return value;
  } catch (error) {
    migrationLogger.error(`Error in processFieldValue: ${error.message}`);
    // Return original value if processing fails
    return value;
  }
}

/**
 * Map fields from source entry to target content type
 * @param {object} sourceEntry - The source entry
 * @param {object} mapping - The content type mapping
 * @param {import('contentful-management').Environment} sourceEnv - Source environment
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 * @returns {Promise<object>} - Mapped fields for the target entry
 */
async function mapFields(sourceEntry, mapping, sourceEnv, targetEnv) {
  const mappedFields = {};
  const sourceContentTypeId = sourceEntry.sys.contentType.sys.id;

  // Get available locales in the target environment
  const availableLocales = (await targetEnv.getLocales()).items.map(
    (locale) => locale.code
  );

  // Skip if no mapping is available
  if (!mapping || !mapping.fieldMappings) {
    migrationLogger.warn(
      `No field mappings found for content type ${sourceContentTypeId}`
    );
    return mappedFields;
  }

  // Create a map of source fields to target fields for quicker lookup
  const sourceToTargetFieldMap = {};
  for (const [targetField, sourceField] of Object.entries(
    mapping.fieldMappings
  )) {
    sourceToTargetFieldMap[sourceField] = targetField;
  }

  // Process fields - handle reference fields differently
  for (const [sourceFieldId, fieldValue] of Object.entries(
    sourceEntry.fields
  )) {
    // Check if this source field is mapped to a target field
    const targetFieldId = sourceToTargetFieldMap[sourceFieldId];
    // Get a sample value to check if this is a reference field
    const sampleValue = Object.values(fieldValue)[0];
    const isRefField = isReferenceField(sampleValue); // Use our helper function
    // Handle reference fields differently
    if (isRefField) {
      // Process reference fields even if they aren't mapped
      const fieldToUse = targetFieldId || sourceFieldId;

      try {
        // Fetch content type information if we have a target field
        let targetContentType = null;
        if (targetFieldId) {
          targetContentType = await getContentType(
            targetEnv,
            mapping.targetContentType
          );
        }

        // Process field value for each locale
        mappedFields[fieldToUse] = {};

        for (const [locale, value] of Object.entries(fieldValue)) {
          // Use the locale if available in target, otherwise use default
          const targetLocale = availableLocales.includes(locale)
            ? locale
            : config.defaultLocale; // Check if source is multiple but target is single
          if (
            Array.isArray(value) &&
            targetContentType &&
            !isMultipleField(targetContentType, fieldToUse)
          ) {
            migrationLogger.info(
              `Field '${sourceFieldId}' has multiple references but target field '${fieldToUse}' only accepts a single reference. Migrating all entries but using only the first reference.`
            );

            if (value.length > 0) {
              // Process all items to ensure they're all migrated
              for (const item of value) {
                // This ensures all references are processed and migrated
                if (item && item.sys && item.sys.type === "Link") {
                  if (item.sys.linkType === "Asset") {
                    await processAsset(item, sourceEnv, targetEnv);
                  } else if (item.sys.linkType === "Entry") {
                    await processReferencedEntry(item, sourceEnv, targetEnv);
                  }
                }
              }

              // But only use the first item for the actual reference
              const firstItem = value[0];
              mappedFields[fieldToUse][targetLocale] = await processFieldValue(
                firstItem,
                sourceEnv,
                targetEnv
              );
            } else {
              // Empty array, set to null
              mappedFields[fieldToUse][targetLocale] = null;
            }
          } else {
            // Normal processing for compatible field types
            mappedFields[fieldToUse][targetLocale] = await processFieldValue(
              value,
              sourceEnv,
              targetEnv
            );
          }
        }
      } catch (error) {
        migrationLogger.error(
          `Error processing reference field '${sourceFieldId}' → '${fieldToUse}':`,
          error
        );
      }
    } else {
      // Skip non-reference fields that don't have a mapping
      if (!targetFieldId) {
        if (config.verbose) {
          migrationLogger.info(
            `Skipping non-reference field '${sourceFieldId}' as it has no mapping defined`
          );
        }
        continue;
      }

      try {
        // Process field value for each locale
        mappedFields[targetFieldId] = {};

        for (const [locale, value] of Object.entries(fieldValue)) {
          // Use the locale if available in target, otherwise use default
          const targetLocale = availableLocales.includes(locale)
            ? locale
            : config.defaultLocale;

          // Process the field value
          mappedFields[targetFieldId][targetLocale] = value;
        }
      } catch (error) {
        migrationLogger.error(
          `Error processing field '${sourceFieldId}' → '${targetFieldId}':`,
          error
        );
      }
    }
  }

  return mappedFields;
}

/**
 * Main function to migrate an entry
 * @param {string} entryId - The entry ID to migrate
 * @param {import('contentful-management').Environment} sourceEnv - Source environment
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 */
async function migrateEntry(
  entryId = null,
  sourceEnv = null,
  targetEnv = null
) {
  try {
    // Use provided environments or connect if not provided
    const _sourceEnv =
      sourceEnv ||
      (await getEnvironment(config.sourceSpaceId, config.sourceEnvironmentId));

    const _targetEnv =
      targetEnv ||
      (await getEnvironment(config.targetSpaceId, config.targetEnvironmentId)); // Use provided entry ID or the first from config.entryIds array
    const _entryId = entryId || config.entryIds[0];

    // Get the entry from the source environment
    migrationLogger.info(`Processing entry ${_entryId}...`);
    const sourceEntry = await retryWithBackoff(
      () => _sourceEnv.getEntry(_entryId),
      `fetch entry ${_entryId}`
    );

    // Get the content type of the entry
    const sourceContentTypeId = sourceEntry.sys.contentType.sys.id;

    // Find mapping for this content type
    const mapping = findMappingForContentType(sourceContentTypeId);

    if (!mapping) {
      migrationLogger.warn(
        `No mapping found for content type ${sourceContentTypeId}, skipping entry ${_entryId}`
      ); // For the main entries (not references), check if they have reference fields
      // and process those references even if the main entry can't be migrated
      if (config.entryIds.includes(_entryId)) {
        migrationLogger.info(
          `Checking if entry ${_entryId} has reference fields to migrate...`
        );
        await processEntryReferences(sourceEntry, _sourceEnv, _targetEnv);
      }

      return;
    }

    const targetContentTypeId = mapping.targetContentType;

    // Map fields from source to target
    migrationLogger.info(
      `Mapping fields from ${sourceContentTypeId} to ${targetContentTypeId}...`
    );
    const mappedFields = await mapFields(
      sourceEntry,
      mapping,
      _sourceEnv,
      _targetEnv
    ); // Check if entry already exists in target
    let targetEntry;
    try {
      targetEntry = await retryWithBackoff(
        () => _targetEnv.getEntry(_entryId),
        `check existing entry ${_entryId}`
      );

      // Skip updating entries that already exist in target environment
      migrationLogger.info(
        `Entry ${_entryId} already exists in target environment. Skipping update...`
      ); // Process any references even if we're skipping the main entry
      if (config.entryIds.includes(_entryId)) {
        migrationLogger.info(
          `Checking if entry ${_entryId} has reference fields to migrate...`
        );
        await processEntryReferences(sourceEntry, _sourceEnv, _targetEnv);
      }

      return targetEntry;

      // The following code is skipped because we don't want to update existing entries
      /* 
      // Update content type if needed
      const currentTargetContentType = targetEntry.sys.contentType.sys.id;
      if (currentTargetContentType !== targetContentTypeId) {
        migrationLogger.warn(
          `Entry ${_entryId} has content type ${currentTargetContentType} but mapping requires ${targetContentTypeId}`
        );

        // We need to create a new entry with the correct content type
        targetEntry = await retryWithBackoff(
          () =>
            _targetEnv.createEntryWithId(
              targetContentTypeId,
              `${_entryId}_new`,
              { fields: {} }
            ),
          `create new entry for ${_entryId}`
        );
      }
      */
    } catch (error) {
      if (error.name === "NotFound") {
        // Create the entry with the same ID
        migrationLogger.info(
          `Creating new entry with ID ${_entryId} in target environment...`
        );
        targetEntry = await retryWithBackoff(
          () =>
            _targetEnv.createEntryWithId(targetContentTypeId, _entryId, {
              fields: {},
            }),
          `create entry ${_entryId}`
        );
      } else {
        throw error;
      }
    }

    // Update the entry with mapped fields
    targetEntry.fields = mappedFields;

    // Save the entry
    const updatedEntry = await retryWithBackoff(
      () => targetEntry.update(),
      `update entry ${_entryId}`
    );

    migrationLogger.success(
      `Entry ${updatedEntry.sys.id} updated successfully`
    );

    // Publish if requested
    if (config.publish) {
      await retryWithBackoff(
        () => updatedEntry.publish(),
        `publish entry ${_entryId}`
      );
      migrationLogger.success(`Entry ${_entryId} published successfully`);
    }

    return updatedEntry;
  } catch (error) {
    migrationLogger.error(
      `Failed to migrate entry ${entryId || config.entryIds[0]}:`,
      error
    );
    throw error;
  }
}

/**
 * Main function to migrate an asset (CLI command)
 * @param {string} assetId - The asset ID to migrate
 * @param {import('contentful-management').Environment} sourceEnv - Source environment
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 */
async function migrateAsset(
  assetId = null,
  sourceEnv = null,
  targetEnv = null
) {
  try {
    // Use provided environments or connect if not provided
    const _sourceEnv =
      sourceEnv ||
      (await getEnvironment(config.sourceSpaceId, config.sourceEnvironmentId));

    const _targetEnv =
      targetEnv ||
      (await getEnvironment(config.targetSpaceId, config.targetEnvironmentId));

    // Use provided asset ID or the first from config.assetIds array
    const _assetId = assetId || config.assetIds[0];

    migrationLogger.info(`Starting migration for asset ${_assetId}...`);

    // Use the shared core migration logic
    const result = await migrateAssetCore(
      _assetId,
      _sourceEnv,
      _targetEnv,
      false
    );

    migrationLogger.success(
      `Asset ${_assetId} migration completed successfully`
    );
    return result;
  } catch (error) {
    migrationLogger.error(
      `Failed to migrate asset ${assetId || config.assetIds[0]}: ${
        error.message
      }`
    );

    // Enhanced error reporting
    if (error.details) {
      migrationLogger.error(
        `Error details: ${JSON.stringify(error.details, null, 2)}`
      );
    }

    if (error.originalError) {
      migrationLogger.error(`Original error: ${error.originalError.message}`);
    }

    throw error;
  }
}

/**
 * Process all reference fields in an entry and migrate the referenced entries
 * @param {object} sourceEntry - The source entry
 * @param {import('contentful-management').Environment} sourceEnv - Source environment
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 */
async function processEntryReferences(sourceEntry, sourceEnv, targetEnv) {
  const entryId = sourceEntry.sys.id;
  let referencesFound = false;

  migrationLogger.info(`Analyzing references in entry ${entryId}...`);

  // Iterate through all fields in the entry
  for (const [fieldId, fieldValue] of Object.entries(sourceEntry.fields)) {
    // Check each locale's value
    for (const [locale, value] of Object.entries(fieldValue)) {
      // Check if this is a reference field
      if (isReferenceField(value)) {
        referencesFound = true;
        migrationLogger.info(
          `Found reference field '${fieldId}' in entry ${entryId}, locale ${locale}`
        );

        try {
          // Process the references
          await processFieldValue(value, sourceEnv, targetEnv);
        } catch (error) {
          migrationLogger.error(
            `Error processing reference field '${fieldId}' in entry ${entryId}:`,
            error
          );
        }
      }
    }
  }

  if (!referencesFound) {
    migrationLogger.info(`No reference fields found in entry ${entryId}`);
  } else {
    migrationLogger.success(
      `Completed processing references in entry ${entryId}`
    );
  }
}

/**
 * Helper function to check if an error is of a specific type from Contentful
 * @param {Error} error - The error object to check
 * @param {string} errorType - The error message to look for
 * @returns {boolean} - Whether the error matches the specified type
 */
function isContentfulErrorType(error, errorType) {
  if (!error) return false;

  // Check in different places where the error message might be
  if (error.message && error.message.includes(errorType)) {
    return true;
  }

  if (
    error.details &&
    error.details.message &&
    error.details.message.includes(errorType)
  ) {
    return true;
  }

  if (error.statusText && error.statusText.includes(errorType)) {
    return true;
  }

  if (
    error.status === 400 &&
    error.message &&
    error.message.includes(errorType)
  ) {
    return true;
  }

  return false;
}

/**
 * Download a file from a URL
 * @param {string} url - The URL to download from
 * @returns {Promise<Buffer>} - The file data as a buffer
 */
async function downloadFile(url) {
  const https = require("https");
  const http = require("http");

  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;

    client
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`Failed to download file: HTTP ${response.statusCode}`)
          );
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      })
      .on("error", reject);
  });
}

/**
 * Upload a file to Contentful Upload API
 * @param {Buffer} fileData - The file data
 * @param {string} contentType - The content type of the file
 * @param {string} fileName - The original file name
 * @returns {Promise<object>} - The upload metadata with uploadFrom reference
 */
async function uploadFileToContentful(fileData, contentType, fileName) {
  const https = require("https");

  return new Promise((resolve, reject) => {
    const postData = fileData;
    const options = {
      hostname: "upload.contentful.com",
      path: "/spaces/" + config.targetSpaceId + "/uploads",
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/octet-stream", // Always use octet-stream for Contentful uploads
        "Content-Length": postData.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 201) {
          const response = JSON.parse(data);
          // Return upload metadata for proper asset field assignment
          // The uploadFrom pattern is the correct way to reference uploads
          resolve({
            uploadFrom: {
              sys: {
                type: "Link",
                linkType: "Upload",
                id: response.sys.id,
              },
            },
            fileName: fileName,
            contentType: contentType,
          });
        } else {
          reject(new Error(`Upload failed: HTTP ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Handle cross-space asset migration by downloading and re-uploading the file
 * @param {object} asset - The asset object
 * @param {string} assetId - The asset ID for logging
 * @param {string} locale - The locale being processed
 * @param {object} fileInfo - The file information containing the cross-space URL
 * @returns {Promise<object>} - Object with uploadFrom reference and metadata
 */
async function handleCrossSpaceAssetMigration(
  asset,
  assetId,
  locale,
  fileInfo
) {
  try {
    migrationLogger.info(
      `Handling cross-space asset migration for ${assetId} (locale: ${locale})`
    );

    // Extract the original file URL
    const originalUrl = fileInfo.url;
    if (!originalUrl.startsWith("//") && !originalUrl.startsWith("http")) {
      throw new Error(`Invalid file URL format: ${originalUrl}`);
    }

    // Make sure URL is complete
    const fullUrl = originalUrl.startsWith("//")
      ? `https:${originalUrl}`
      : originalUrl;

    migrationLogger.info(`Downloading file from: ${fullUrl}`);

    // Download the file
    const fileData = await downloadFile(fullUrl);

    // Get file info
    const fileName = fileInfo.fileName || `asset-${assetId}-${locale}`;
    const contentType = fileInfo.contentType || "application/octet-stream";

    migrationLogger.info(
      `Downloaded ${fileData.length} bytes for ${fileName} (${contentType})`
    );

    // Upload to target space - now returns upload metadata
    const uploadResult = await uploadFileToContentful(
      fileData,
      contentType,
      fileName
    );

    migrationLogger.success(
      `Successfully uploaded file to target space with upload ID: ${uploadResult.uploadFrom.sys.id}`
    );

    // Return upload metadata for proper asset field assignment
    return {
      uploadFrom: uploadResult.uploadFrom,
      fileName: fileName,
      contentType: contentType,
    };
  } catch (error) {
    migrationLogger.error(
      `Failed to handle cross-space migration for asset ${assetId}:`,
      error
    );
    throw error;
  }
}

/**
 * Check if an asset has cross-space file URLs and migrate them if needed
 * @param {object} asset - The asset object
 * @param {string} assetId - The asset ID for logging
 * @returns {Promise<boolean>} - True if cross-space migration was performed
 */
async function handleCrossSpaceAssetURLs(asset, assetId) {
  let migrationPerformed = false;

  // Check if cross-space migration is enabled
  if (!config.enableCrossSpaceMigration) {
    return migrationPerformed;
  }

  if (!asset.fields || !asset.fields.file) {
    return migrationPerformed;
  }

  for (const [locale, fileInfo] of Object.entries(asset.fields.file)) {
    if (!fileInfo || !fileInfo.url) {
      continue;
    }

    // Check if this is a cross-space URL
    const fileUrl = fileInfo.url;
    const targetSpaceId = config.targetSpaceId;

    // Cross-space URLs typically contain a different space ID or come from a different CDN
    const isCrossSpace =
      fileUrl.includes("ctfassets.net") && !fileUrl.includes(targetSpaceId);
    if (isCrossSpace) {
      try {
        migrationLogger.info(
          `Detected cross-space URL for asset ${assetId}, locale ${locale}: ${fileUrl}`
        ); // Download and re-upload the file
        const uploadResult = await handleCrossSpaceAssetMigration(
          asset,
          assetId,
          locale,
          fileInfo
        ); // Update the asset with the uploadFrom reference (proper Contentful API pattern)
        // Note: Don't include 'details' field when using uploadFrom - Contentful generates it after processing
        asset.fields.file[locale] = {
          uploadFrom: uploadResult.uploadFrom,
          fileName: uploadResult.fileName,
          contentType: uploadResult.contentType,
        };
        migrationPerformed = true;

        migrationLogger.success(
          `Updated asset ${assetId} locale ${locale} with upload reference: ${uploadResult.uploadFrom.sys.id}`
        );
      } catch (error) {
        migrationLogger.error(
          `Failed to migrate cross-space URL for asset ${assetId}, locale ${locale}:`,
          error
        );
        // Continue with other locales even if one fails
      }
    }
  }

  return migrationPerformed;
}

/**
 * Process an asset with proper error handling and cross-space migration support
 * @param {object} asset - The asset to process
 * @param {string} assetId - The asset ID for logging
 * @param {import('contentful-management').Environment} targetEnv - Target environment for processing
 * @returns {Promise<void>} - Promise that resolves when processing is complete
 */
async function processAssetWithErrorHandling(asset, assetId, targetEnv) {
  try {
    migrationLogger.info(`Starting asset processing for ${assetId}...`);

    // First, check and handle any cross-space URLs
    const crossSpaceMigrationPerformed = await handleCrossSpaceAssetURLs(
      asset,
      assetId
    );

    if (crossSpaceMigrationPerformed) {
      // If we migrated files, save the asset first
      migrationLogger.info(
        `Updating asset ${assetId} with migrated file URLs...`
      );
      await retryWithBackoff(
        () => asset.update(),
        `update asset ${assetId} with new URLs`
      );

      // Get fresh asset instance after update for processing
      asset = await retryWithBackoff(
        () => targetEnv.getAsset(assetId),
        `refresh asset ${assetId} after URL update`
      );
    }

    // Check if asset files are already processed
    const isAlreadyProcessed = await checkIfAssetAlreadyProcessed(
      asset,
      assetId
    );

    if (isAlreadyProcessed) {
      migrationLogger.info(
        `Asset ${assetId} files are already processed, skipping processing step`
      );
      return;
    }

    // Process the asset for all locales in TARGET environment
    migrationLogger.info(`Processing asset ${assetId} for all locales...`);
    await retryWithBackoff(
      () => asset.processForAllLocales(),
      `process asset ${assetId} for all locales`
    );

    // Wait for processing to complete
    await waitForAssetProcessing(asset, assetId, targetEnv);

    migrationLogger.success(`Asset ${assetId} processed successfully`);
  } catch (error) {
    // Enhanced error handling with specific patterns
    const errorHandled = await handleAssetProcessingError(
      error,
      assetId,
      asset,
      targetEnv
    );

    if (!errorHandled) {
      // For any unhandled error, rethrow with additional context
      const enhancedError = new Error(
        `Failed to process asset ${assetId}: ${error.message}`
      );
      enhancedError.originalError = error;
      enhancedError.assetId = assetId;
      throw enhancedError;
    }
  }
}

/**
 * Check if an asset's files are already processed
 * @param {object} asset - The asset object
 * @param {string} assetId - The asset ID for logging
 * @returns {Promise<boolean>} - True if all files are already processed
 */
async function checkIfAssetAlreadyProcessed(asset, assetId) {
  try {
    if (!asset.fields || !asset.fields.file) {
      migrationLogger.info(`Asset ${assetId} has no file fields`);
      return true;
    }

    // Check if all file fields have URLs (indicating they're processed)
    const fileEntries = Object.entries(asset.fields.file);
    for (const [locale, fileInfo] of fileEntries) {
      if (!fileInfo || !fileInfo.url || fileInfo.url.includes("in-progress")) {
        migrationLogger.info(
          `Asset ${assetId} locale ${locale} needs processing`
        );
        return false;
      }
    }

    migrationLogger.info(`Asset ${assetId} appears to be already processed`);
    return true;
  } catch (error) {
    migrationLogger.warning(
      `Error checking asset processing status: ${error.message}`
    );
    return false;
  }
}

/**
 * Wait for asset processing to complete
 * @param {object} asset - The asset object
 * @param {string} assetId - The asset ID for logging
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 * @returns {Promise<void>}
 */
async function waitForAssetProcessing(asset, assetId, targetEnv) {
  const maxWaitTime = 60000; // 1 minute
  const checkInterval = 2000; // 2 seconds
  const startTime = Date.now();

  migrationLogger.info(
    `Waiting for asset ${assetId} processing to complete...`
  );

  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Refresh asset to get latest status
      const refreshedAsset = await retryWithBackoff(
        () => targetEnv.getAsset(assetId),
        `refresh asset ${assetId} status`
      );

      // Check if all files are processed
      if (refreshedAsset.fields && refreshedAsset.fields.file) {
        const allProcessed = Object.values(refreshedAsset.fields.file).every(
          (fileInfo) =>
            fileInfo && fileInfo.url && !fileInfo.url.includes("in-progress")
        );

        if (allProcessed) {
          migrationLogger.success(`Asset ${assetId} processing completed`);
          return;
        }
      }

      migrationLogger.info(`Asset ${assetId} still processing, waiting...`);
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    } catch (error) {
      migrationLogger.warning(
        `Error checking asset processing status: ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  migrationLogger.warning(
    `Asset ${assetId} processing timed out after ${maxWaitTime}ms`
  );
}

/**
 * Handle specific asset processing errors
 * @param {Error} error - The error object
 * @param {string} assetId - The asset ID
 * @param {object} asset - The asset object
 * @param {import('contentful-management').Environment} targetEnv - Target environment
 * @returns {Promise<boolean>} - True if error was handled, false otherwise
 */
async function handleAssetProcessingError(error, assetId, asset, targetEnv) {
  // Check for "already processed" error patterns
  const alreadyProcessedPatterns = [
    "File has already been processed",
    "already being processed",
    "Asset is already being processed",
  ];

  const isAlreadyProcessedError = alreadyProcessedPatterns.some(
    (pattern) =>
      (error.message && error.message.includes(pattern)) ||
      (error.details &&
        error.details.message &&
        error.details.message.includes(pattern))
  );

  if (isAlreadyProcessedError) {
    migrationLogger.info(
      `Asset ${assetId} has already been processed, continuing...`
    );
    return true;
  }

  // Check for cross-space URL errors
  const crossSpacePatterns = [
    "The file URL must reference the asset being processed",
    "cannot reference an asset from another space",
    "File URL must reference the asset being processed",
  ];

  const isCrossSpaceError = crossSpacePatterns.some(
    (pattern) =>
      (error.message && error.message.includes(pattern)) ||
      (error.details &&
        error.details.message &&
        error.details.message.includes(pattern))
  );

  if (isCrossSpaceError) {
    migrationLogger.warning(
      `Asset ${assetId} has cross-space URL references. Attempting automatic migration...`
    );

    try {
      // Attempt cross-space migration if not already tried
      const migrationPerformed = await handleCrossSpaceAssetURLs(
        asset,
        assetId
      );

      if (migrationPerformed) {
        migrationLogger.info(
          `Cross-space migration completed for ${assetId}, retrying processing...`
        );

        // Update the asset with new URLs
        await retryWithBackoff(
          () => asset.update(),
          `update asset ${assetId} after cross-space migration`
        );

        // Retry processing
        await retryWithBackoff(
          () => asset.processForAllLocales(),
          `retry processing asset ${assetId} after cross-space migration`
        );

        return true;
      } else {
        migrationLogger.warning(
          `Cross-space migration not performed for ${assetId}. Manual intervention may be required.`
        );
        migrationLogger.warning(`Error details: ${error.message}`);
        return true; // Consider handled to continue with other assets
      }
    } catch (migrationError) {
      migrationLogger.error(
        `Failed to perform cross-space migration for ${assetId}: ${migrationError.message}`
      );
      return true; // Consider handled to continue with other assets
    }
  }

  // Check for validation errors
  if (
    error.status === 422 ||
    (error.message && error.message.includes("Validation error"))
  ) {
    migrationLogger.error(
      `Asset ${assetId} validation error: ${error.message}`
    );

    if (error.details && error.details.errors) {
      migrationLogger.error(
        `Validation details: ${JSON.stringify(error.details.errors, null, 2)}`
      );
    }

    return true; // Consider handled to continue with other assets
  }

  // Check for rate limiting errors
  if (error.name === "RateLimitExceeded" || error.status === 429) {
    migrationLogger.warning(
      `Rate limit exceeded for asset ${assetId}. This will be retried automatically.`
    );
    throw error; // Let the retry mechanism handle this
  }

  // Check for network/connectivity errors
  if (
    error.code === "ENOTFOUND" ||
    error.code === "ECONNRESET" ||
    error.code === "ETIMEDOUT"
  ) {
    migrationLogger.warning(
      `Network error processing asset ${assetId}: ${error.message}. This will be retried automatically.`
    );
    throw error; // Let the retry mechanism handle this
  }

  // Error not handled
  return false;
}

/**
 * Fetch and cache content type information
 * @param {import('contentful-management').Environment} env - Contentful environment
 * @param {string} contentTypeId - Content type ID to fetch
 * @returns {Promise<object>} - The content type object
 */
async function getContentType(env, contentTypeId) {
  const cacheKey = `${env.sys.id}:${contentTypeId}`;

  if (contentTypeCache.has(cacheKey)) {
    return contentTypeCache.get(cacheKey);
  }

  try {
    const contentType = await retryWithBackoff(
      () => env.getContentType(contentTypeId),
      `fetch content type ${contentTypeId}`
    );

    contentTypeCache.set(cacheKey, contentType);
    return contentType;
  } catch (error) {
    migrationLogger.error(
      `Failed to fetch content type ${contentTypeId}:`,
      error
    );
    return null;
  }
}

/**
 * Check if a field in a content type allows multiple values
 * @param {object} contentType - Content type object
 * @param {string} fieldId - Field ID to check
 * @returns {boolean} - True if the field allows multiple values
 */
function isMultipleField(contentType, fieldId) {
  if (!contentType || !contentType.fields) {
    return false;
  }

  const field = contentType.fields.find((f) => f.id === fieldId);
  if (!field) {
    return false;
  }

  // Check for Array type which indicates multiple values
  if (field.type === "Array") {
    // For link fields, also check the linkType in the items property
    if (field.items && field.items.type === "Link") {
      migrationLogger.info(
        `Field '${fieldId}' is a multi-reference field of type ${field.items.linkType}`
      );
      return true;
    }
    return true;
  }

  // Single value field
  if (field.type === "Link") {
    migrationLogger.info(
      `Field '${fieldId}' is a single-reference field of type ${field.linkType}`
    );
  }

  return false;
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse command line arguments
    parseArgs();

    migrationLogger.info("Starting migration process...");

    // Connect to source and target environments
    migrationLogger.info("Connecting to Contentful environments...");
    const sourceEnv = await getEnvironment(
      config.sourceSpaceId,
      config.sourceEnvironmentId
    );
    const targetEnv = await getEnvironment(
      config.targetSpaceId,
      config.targetEnvironmentId
    );

    const results = { success: [], failure: [] };

    // Process based on migration type
    switch (config.migrationType) {
      case "entry":
        migrationLogger.info(
          `Processing ${config.entryIds.length} entries: ${config.entryIds.join(
            ", "
          )}`
        );
        for (const entryId of config.entryIds) {
          try {
            await migrateEntry(entryId, sourceEnv, targetEnv);
            results.success.push({ type: "entry", id: entryId });
          } catch (error) {
            migrationLogger.error(`Failed to migrate entry ${entryId}:`, error);
            results.failure.push({
              type: "entry",
              id: entryId,
              error: error.message,
            });
          }
        }
        break;

      case "asset":
        migrationLogger.info(
          `Processing ${config.assetIds.length} assets: ${config.assetIds.join(
            ", "
          )}`
        );
        for (const assetId of config.assetIds) {
          try {
            await migrateAsset(assetId, sourceEnv, targetEnv);
            results.success.push({ type: "asset", id: assetId });
          } catch (error) {
            migrationLogger.error(`Failed to migrate asset ${assetId}:`, error);
            results.failure.push({
              type: "asset",
              id: assetId,
              error: error.message,
            });
          }
        }
        break;

      case "both":
        // Process entries first
        if (config.entryIds.length > 0) {
          migrationLogger.info(
            `Processing ${
              config.entryIds.length
            } entries: ${config.entryIds.join(", ")}`
          );
          for (const entryId of config.entryIds) {
            try {
              await migrateEntry(entryId, sourceEnv, targetEnv);
              results.success.push({ type: "entry", id: entryId });
            } catch (error) {
              migrationLogger.error(
                `Failed to migrate entry ${entryId}:`,
                error
              );
              results.failure.push({
                type: "entry",
                id: entryId,
                error: error.message,
              });
            }
          }
        }

        // Then process assets
        if (config.assetIds.length > 0) {
          migrationLogger.info(
            `Processing ${
              config.assetIds.length
            } assets: ${config.assetIds.join(", ")}`
          );
          for (const assetId of config.assetIds) {
            try {
              await migrateAsset(assetId, sourceEnv, targetEnv);
              results.success.push({ type: "asset", id: assetId });
            } catch (error) {
              migrationLogger.error(
                `Failed to migrate asset ${assetId}:`,
                error
              );
              results.failure.push({
                type: "asset",
                id: assetId,
                error: error.message,
              });
            }
          }
        }
        break;
    }

    // Display final summary
    migrationLogger.success("Migration completed!");

    if (results.success.length > 0) {
      migrationLogger.success("Successfully processed:");
      const successfulEntries = results.success.filter(
        (r) => r.type === "entry"
      );
      const successfulAssets = results.success.filter(
        (r) => r.type === "asset"
      );

      if (successfulEntries.length > 0) {
        migrationLogger.success(
          ` - ${successfulEntries.length} entries: ${successfulEntries
            .map((e) => e.id)
            .join(", ")}`
        );
      }
      if (successfulAssets.length > 0) {
        migrationLogger.success(
          ` - ${successfulAssets.length} assets: ${successfulAssets
            .map((a) => a.id)
            .join(", ")}`
        );
      }
    }

    if (results.failure.length > 0) {
      migrationLogger.warn("Failed to process:");
      const failedEntries = results.failure.filter((r) => r.type === "entry");
      const failedAssets = results.failure.filter((r) => r.type === "asset");

      if (failedEntries.length > 0) {
        migrationLogger.warn(
          ` - ${failedEntries.length} entries: ${failedEntries
            .map((e) => e.id)
            .join(", ")}`
        );
      }
      if (failedAssets.length > 0) {
        migrationLogger.warn(
          ` - ${failedAssets.length} assets: ${failedAssets
            .map((a) => a.id)
            .join(", ")}`
        );
      }
    }
    migrationLogger.info(
      `Total: processed ${config.processedEntries.size} entries and ${config.processedAssets.size} assets`
    );

    // Exit with appropriate code based on results
    if (results.failure.length > 0) {
      migrationLogger.warn(
        `Migration completed with ${results.failure.length} failures`
      );
      process.exit(1); // Non-zero exit code for CI/CD awareness
    } else {
      migrationLogger.success(
        "Migration completed successfully with no failures"
      );
      process.exit(0);
    }
  } catch (error) {
    migrationLogger.error("Migration failed with critical error:", error);

    // Enhanced error reporting for debugging
    if (error.stack) {
      migrationLogger.error("Stack trace:", error.stack);
    }

    if (error.details) {
      migrationLogger.error(
        "Error details:",
        JSON.stringify(error.details, null, 2)
      );
    }

    process.exit(1);
  }
}

// Run the script
parseArgs();
main();
