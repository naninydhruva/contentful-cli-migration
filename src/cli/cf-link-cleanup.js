const contentful = require("contentful-management");
require("dotenv").config();

// Unified Configuration - prioritizes env vars, then CLI args, then defaults
const CONFIG = {
  // Contentful credentials from environment variables
  ACCESS_TOKEN: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  SPACE_ID: process.env.SPACE_ID_FR_FR,
  ENVIRONMENT_ID: process.env.ENV_FR_FR,
  // Processing configuration - Optimized for higher throughput
  RETRY_ATTEMPTS: 7, // Increased from 5 to handle more rate limit scenarios
  RETRY_DELAY: 2000, // Reduced from 5000ms to 2000ms for faster recovery
  RATE_LIMIT_DELAY: 2000, // Reduced from 5000ms to 1000ms for better throughput
  BATCH_SIZE: 50, // Reduced from 100 to 50 for more manageable concurrent load
  MAX_ENTRIES: 4000,

  // Bulk operation settings
  DRY_RUN: false,
  PUBLISH_AFTER_UPDATE: true,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
};

// Validate configuration
function validateConfig() {
  const errors = [];

  if (!CONFIG.ACCESS_TOKEN) {
    errors.push("CONTENTFUL_MANAGEMENT_TOKEN environment variable is required");
  }

  if (!CONFIG.SPACE_ID) {
    errors.push("CONTENTFUL_SPACE_ID environment variable is required");
  }

  if (errors.length > 0) {
    logger.error("Configuration validation failed:");
    errors.forEach((error) => logger.error(`  - ${error}`));
    process.exit(1);
  }
}

// Initialize contentful client
let client;
let environment;

async function initializeClient() {
  try {
    client = contentful.createClient({
      accessToken: CONFIG.ACCESS_TOKEN,
    });

    const space = await client.getSpace(CONFIG.SPACE_ID);
    environment = await space.getEnvironment(CONFIG.ENVIRONMENT_ID);

    logger.info(
      `✅ Connected to Contentful space: ${CONFIG.SPACE_ID}, environment: ${CONFIG.ENVIRONMENT_ID}`
    );
  } catch (error) {
    logger.error("Failed to initialize Contentful client:", error);
    throw error;
  }
}

// Simple logger with color-coded output and levels
const logger = {
  levels: {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  },

  colors: {
    debug: "\x1b[90m", // Gray
    info: "\x1b[36m", // Cyan
    warn: "\x1b[33m", // Yellow
    error: "\x1b[31m", // Red
    success: "\x1b[32m", // Green
    reset: "\x1b[0m",
  },

  shouldLog(level) {
    const configLevel = this.levels[CONFIG.LOG_LEVEL] || 1;
    const messageLevel = this.levels[level] || 1;
    return messageLevel >= configLevel;
  },

  log(level, message, error = null) {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const color = this.colors[level] || this.colors.info;
    const formattedMessage = `${color}[${timestamp}] [${level.toUpperCase()}] ${message}${
      this.colors.reset
    }`;

    if (level === "error") {
      console.error(formattedMessage);
      if (error) {
        console.error(
          `${color}${error.stack || error.message || error}${this.colors.reset}`
        );
      }
    } else {
      console.log(formattedMessage);
    }
  },

  debug(message) {
    this.log("debug", message);
  },
  info(message) {
    this.log("info", message);
  },
  warn(message) {
    this.log("warn", message);
  },
  error(message, error) {
    this.log("error", message, error);
  },
  success(message) {
    this.log("info", `${this.colors.success}${message}${this.colors.reset}`);
  },
};

// Helper functions
const helpers = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

  isRateLimitError: (err) => {
    return (
      err &&
      (err.name === "RateLimitExceeded" ||
        err.response?.status === 429 ||
        err.status === 429)
    );
  },

  withRetry: async (
    operation,
    operationName,
    maxRetries = CONFIG.RETRY_ATTEMPTS
  ) => {
    let retries = 0;

    while (true) {
      try {
        return await operation();
      } catch (err) {
        if (helpers.isRateLimitError(err) && retries < maxRetries) {
          retries++;
          // Exponential backoff with jitter: base delay * 2^retries + random jitter
          const baseDelay = CONFIG.RETRY_DELAY;
          const exponentialDelay = baseDelay * Math.pow(2, retries - 1);
          const jitter = Math.floor(Math.random() * 1000);
          const delay = Math.min(exponentialDelay + jitter, 30000); // Cap at 30s

          logger.warn(
            `Rate limit hit on ${operationName}, retry ${retries}/${maxRetries} in ${delay}ms (exponential backoff)`
          );
          await helpers.sleep(delay);
        } else {
          if (retries >= maxRetries) {
            logger.error(
              `Operation ${operationName} failed after ${maxRetries} retries`,
              err
            );
          }
          throw err;
        }
      }
    }
  },
};

/**
 * Validate if a link exists in the environment
 * @param {Object} link - Link object with sys.type, sys.linkType, and sys.id
 * @returns {Promise<Object|null>} - Returns the link if valid, null if broken
 */
async function validateLink(link) {
  try {
    if (!link?.sys?.id || !link?.sys?.linkType) {
      logger.debug(`Invalid link structure: ${JSON.stringify(link)}`);
      return null;
    }

    if (link.sys.linkType !== "Entry" && link.sys.linkType !== "Asset") {
      logger.debug(`Unknown link type: ${link.sys.linkType}`);
      return null;
    }

    const getMethod = link.sys.linkType === "Entry" ? "getEntry" : "getAsset";

    try {
      const resource = await helpers.withRetry(
        () => environment[getMethod](link.sys.id),
        `validate-${link.sys.linkType.toLowerCase()}-${link.sys.id}`
      );

      if (resource) {
        logger.debug(`✅ Valid ${link.sys.linkType} link: ${link.sys.id}`);
        return link;
      }
    } catch (error) {
      if (error.name === "NotFound" || error.status === 404) {
        logger.debug(
          `🔗 Broken ${link.sys.linkType} link found: ${link.sys.id} (404 Not Found)`
        );
        return null;
      } else if (error.status === 422) {
        logger.debug(
          `🔗 Invalid ${link.sys.linkType} link: ${link.sys.id} (422 Validation Error)`
        );
        return null;
      } else if (helpers.isRateLimitError(error)) {
        logger.warn(
          `Rate limit hit while validating link ${link.sys.id}, keeping link for retry`
        );
        return link; // Keep link during rate limit errors
      } else {
        logger.warn(
          `Error validating ${link.sys.linkType} ${link.sys.id}: ${error.message} - removing for safety`
        );
        return null;
      }
    }

    return null;
  } catch (error) {
    logger.error(`Unexpected error validating link ${link?.sys?.id}:`, error);
    return null;
  }
}

/**
 * Clean broken links from an entry
 * @param {import('contentful-management').Entry} entry - The entry to clean
 * @returns {Promise<Object>} - Cleaning results
 */
async function cleanEntryLinks(entry) {
  const result = {
    entryId: entry?.sys?.id || "unknown",
    contentType: entry?.sys?.contentType?.sys?.id || "unknown",
    hasBrokenLinks: false,
    totalLinksFound: 0,
    totalBrokenLinks: 0,
    brokenEntryLinks: 0,
    brokenAssetLinks: 0,
    wasUpdated: false,
    errors: [],
  };

  try {
    if (!entry?.fields) {
      logger.debug(`Entry ${result.entryId} has no fields`);
      return result;
    }

    let hasChanges = false;

    // Process each field
    for (const [fieldKey, fieldData] of Object.entries(entry.fields)) {
      if (!fieldData || typeof fieldData !== "object") continue;

      // Process each locale in the field
      for (const [locale, value] of Object.entries(fieldData)) {
        if (!value) continue;

        // Handle arrays of links
        if (Array.isArray(value)) {
          const cleanedArray = [];

          for (const item of value) {
            if (item?.sys?.type === "Link") {
              result.totalLinksFound++;
              const validLink = await validateLink(item);

              if (validLink) {
                cleanedArray.push(validLink);
              } else {
                result.hasBrokenLinks = true;
                result.totalBrokenLinks++;
                hasChanges = true;

                if (item.sys.linkType === "Entry") {
                  result.brokenEntryLinks++;
                } else if (item.sys.linkType === "Asset") {
                  result.brokenAssetLinks++;
                }

                logger.info(
                  `🔗 Removed broken ${item.sys.linkType} link from ${fieldKey}.${locale}: ${item.sys.id}`
                );
              }
            } else {
              cleanedArray.push(item);
            }
          }

          if (hasChanges) {
            fieldData[locale] = cleanedArray;
          }
        }
        // Handle single link objects
        else if (value?.sys?.type === "Link") {
          result.totalLinksFound++;
          const validLink = await validateLink(value);

          if (!validLink) {
            fieldData[locale] = null;
            result.hasBrokenLinks = true;
            result.totalBrokenLinks++;
            hasChanges = true;

            if (value.sys.linkType === "Entry") {
              result.brokenEntryLinks++;
            } else if (value.sys.linkType === "Asset") {
              result.brokenAssetLinks++;
            }

            logger.info(
              `🔗 Removed broken ${value.sys.linkType} link from ${fieldKey}.${locale}: ${value.sys.id}`
            );
          }
        }
      }
    }

    result.wasUpdated = hasChanges;
    return result;
  } catch (error) {
    result.errors.push(
      `Error processing entry ${result.entryId}: ${error.message}`
    );
    logger.error(`Unexpected error processing entry ${result.entryId}:`, error);
    return result;
  }
}

/**
 * Update and optionally publish an entry
 * @param {import('contentful-management').Entry} entry - The entry to update
 * @param {boolean} shouldPublish - Whether to publish after update
 * @returns {Promise<Object>} - Update result
 */
async function updateEntry(entry, shouldPublish = false) {
  const result = {
    updated: false,
    published: false,
    errors: [],
  };

  try {
    const entryId = entry.sys.id; // Update the entry
    logger.info(`💾 Updating entry ${entryId}...`);
    await helpers.withRetry(() => entry.update(), `update-entry-${entryId}`);
    result.updated = true;
    logger.success(`✅ Updated entry ${entryId}`);

    // Add delay to prevent rate limiting after update
    await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);

    // Publish if requested
    if (shouldPublish) {
      try {
        // Get latest version of the entry
        const latestEntry = await helpers.withRetry(
          () => environment.getEntry(entryId),
          `get-entry-${entryId}`
        );

        logger.info(`📤 Publishing entry ${entryId}...`);
        await helpers.withRetry(
          () => latestEntry.publish(),
          `publish-entry-${entryId}`
        );
        result.published = true;
        logger.success(`✅ Published entry ${entryId}`);

        // Add delay after publishing
        await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);
      } catch (publishError) {
        const error = `Failed to publish entry ${entryId}: ${publishError.message}`;
        result.errors.push(error);
        logger.error(error, publishError);
      }
    }

    return result;
  } catch (error) {
    const entryId = entry?.sys?.id || "unknown";
    const errorMsg = `Failed to update entry ${entryId}: ${error.message}`;
    result.errors.push(errorMsg);
    logger.error(errorMsg, error);
    return result;
  }
}

/**
 * Process entries in batches to find and clean broken links
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processing results
 */
async function bulkLinkCleanup(options = {}) {
  const {
    contentTypeFilter = null,
    batchSize = CONFIG.BATCH_SIZE,
    maxEntries = CONFIG.MAX_ENTRIES,
    dryRun = CONFIG.DRY_RUN,
    shouldPublish = CONFIG.PUBLISH_AFTER_UPDATE,
  } = options;

  const results = {
    totalProcessed: 0,
    totalWithBrokenLinks: 0,
    totalLinksFound: 0,
    totalBrokenLinksRemoved: 0,
    totalEntriesUpdated: 0,
    totalEntriesPublished: 0,
    brokenEntryLinks: 0,
    brokenAssetLinks: 0,
    processingErrors: [],
    updateErrors: [],
    entriesWithBrokenLinks: [],
  };

  const startTime = Date.now();

  try {
    logger.info(`🔍 Starting bulk link cleanup...`);
    logger.info(
      `📋 Options: dryRun=${dryRun}, shouldPublish=${shouldPublish}, maxEntries=${maxEntries}`
    );

    if (contentTypeFilter) {
      logger.info(`🎯 Filtering by content type: ${contentTypeFilter}`);
    }

    let skip = 0;
    let processedInBatch = 0;

    while (results.totalProcessed < maxEntries) {
      const limit = Math.min(batchSize, maxEntries - results.totalProcessed);

      logger.info(
        `📄 Fetching batch ${Math.floor(skip / batchSize) + 1} (entries ${
          skip + 1
        }-${skip + limit})...`
      );

      // Build query parameters
      const queryParams = {
        limit,
        skip,
        order: "sys.createdAt",
        "sys.archivedAt[exists]": false,
      };

      if (contentTypeFilter) {
        queryParams.content_type = contentTypeFilter;
      }

      // Fetch entries batch
      const entriesBatch = await helpers.withRetry(
        () => environment.getEntries(queryParams),
        `fetch-entries-batch-${Math.floor(skip / batchSize) + 1}`
      );

      if (entriesBatch.items.length === 0) {
        logger.info("📋 No more entries to process");
        break;
      }

      logger.info(`🔄 Processing ${entriesBatch.items.length} entries...`); // Process all entries in the batch in parallel with staggered delays
      const batchProcessingPromises = entriesBatch.items.map(
        async (entry, index) => {
          try {
            // Add small staggered delay to prevent simultaneous API calls
            if (index > 0) {
              await helpers.sleep(index * 100); // 100ms delay between each parallel request
            }

            // Skip archived entries
            if (entry.sys.archivedAt) {
              logger.debug(`⏭️ Skipping archived entry: ${entry.sys.id}`);
              return {
                success: true,
                skipped: true,
                entryId: entry.sys.id,
                reason: "archived",
              };
            }

            logger.debug(
              `🔍 Scanning entry ${entry.sys.id} for broken links...`
            );

            // Clean links from the entry
            const cleaningResult = await cleanEntryLinks(entry);

            // Prepare batch result
            const batchResult = {
              success: true,
              skipped: false,
              entryId: entry.sys.id,
              cleaningResult,
              updateResult: null,
            };

            // Handle entries with broken links
            if (cleaningResult.hasBrokenLinks) {
              logger.info(
                `🔗 Entry ${cleaningResult.entryId}: Found ${cleaningResult.totalBrokenLinks} broken links`
              );

              // Update the entry if not a dry run
              if (!dryRun && cleaningResult.wasUpdated) {
                const updateResult = await updateEntry(entry, shouldPublish);
                batchResult.updateResult = updateResult;
              } else if (dryRun) {
                logger.info(
                  `🎯 DRY RUN: Would update entry ${cleaningResult.entryId}`
                );
              }
            }

            return batchResult;
          } catch (entryError) {
            const entryId = entry?.sys?.id || "unknown";
            const error = `Error processing entry ${entryId}: ${entryError.message}`;
            logger.error(error, entryError);

            return {
              success: false,
              skipped: false,
              entryId,
              error: error,
              errorDetails: entryError,
            };
          }
        }
      );

      // Wait for all entries in the batch to complete
      logger.info(
        `⚡ Processing ${entriesBatch.items.length} entries in parallel...`
      );
      const batchResults = await Promise.allSettled(batchProcessingPromises);

      // Process results and update counters
      for (const promiseResult of batchResults) {
        if (promiseResult.status === "fulfilled") {
          const batchResult = promiseResult.value;

          if (batchResult.success && !batchResult.skipped) {
            const cleaningResult = batchResult.cleaningResult;

            // Update results counters
            results.totalLinksFound += cleaningResult.totalLinksFound;
            results.totalBrokenLinksRemoved += cleaningResult.totalBrokenLinks;
            results.brokenEntryLinks += cleaningResult.brokenEntryLinks;
            results.brokenAssetLinks += cleaningResult.brokenAssetLinks;

            // Add any cleaning errors
            if (cleaningResult.errors.length > 0) {
              results.processingErrors.push(...cleaningResult.errors);
            }

            // Track entries with broken links
            if (cleaningResult.hasBrokenLinks) {
              results.totalWithBrokenLinks++;
              results.entriesWithBrokenLinks.push({
                entryId: cleaningResult.entryId,
                contentType: cleaningResult.contentType,
                brokenLinks: cleaningResult.totalBrokenLinks,
                brokenEntryLinks: cleaningResult.brokenEntryLinks,
                brokenAssetLinks: cleaningResult.brokenAssetLinks,
              });

              // Handle update results
              if (batchResult.updateResult) {
                if (batchResult.updateResult.updated) {
                  results.totalEntriesUpdated++;
                }
                if (batchResult.updateResult.published) {
                  results.totalEntriesPublished++;
                }
                if (batchResult.updateResult.errors.length > 0) {
                  results.updateErrors.push(...batchResult.updateResult.errors);
                }
              }
            }

            results.totalProcessed++;
          } else if (batchResult.skipped) {
            // Count skipped entries but don't process them
            results.totalProcessed++;
          } else {
            // Handle processing errors
            results.processingErrors.push(batchResult.error);
            results.totalProcessed++;
          }
        } else {
          // Handle promise rejection
          const error = `Batch processing promise rejected: ${
            promiseResult.reason?.message || promiseResult.reason
          }`;
          results.processingErrors.push(error);
          logger.error(error);
          results.totalProcessed++;
        }

        // Check if we've reached the maximum number of entries
        if (results.totalProcessed >= maxEntries) {
          break;
        }
      }

      skip += entriesBatch.items.length;

      // Add delay between batches
      await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);

      // Log progress
      logger.info(
        `📊 Progress: ${results.totalProcessed}/${maxEntries} entries processed, ${results.totalWithBrokenLinks} with broken links`
      );
    }

    const duration = Date.now() - startTime;
    logger.success(`🎉 Bulk link cleanup completed in ${duration}ms`);

    return results;
  } catch (error) {
    logger.error("Fatal error in bulk link cleanup:", error);
    results.processingErrors.push(`Fatal error: ${error.message}`);
    return results;
  }
}

/**
 * Display a summary of the link cleanup results
 * @param {Object} results - Processing results
 * @param {Object} options - Display options
 */
function displaySummary(results, options = {}) {
  const {
    dryRun = CONFIG.DRY_RUN,
    shouldPublish = CONFIG.PUBLISH_AFTER_UPDATE,
  } = options;

  logger.info("\n" + "=".repeat(60));
  logger.info("🎉 LINK CLEANUP SUMMARY");
  logger.info("=".repeat(60));

  // Basic statistics
  logger.info(`📊 Processing Statistics:`);
  logger.info(`   Total entries processed: ${results.totalProcessed}`);
  logger.info(`   Entries with broken links: ${results.totalWithBrokenLinks}`);
  logger.info(`   Total links found: ${results.totalLinksFound}`);
  logger.info(
    `   Total broken links removed: ${results.totalBrokenLinksRemoved}`
  );
  logger.info(`   - Broken entry links: ${results.brokenEntryLinks}`);
  logger.info(`   - Broken asset links: ${results.brokenAssetLinks}`);

  // Update statistics
  if (!dryRun) {
    logger.info(`\n💾 Update Statistics:`);
    logger.info(`   Entries updated: ${results.totalEntriesUpdated}`);
    if (shouldPublish) {
      logger.info(`   Entries published: ${results.totalEntriesPublished}`);
    }
  } else {
    logger.info(`\n🎯 DRY RUN - No actual changes made`);
  }

  // Error statistics
  if (results.processingErrors.length > 0 || results.updateErrors.length > 0) {
    logger.warn(`\n⚠️ Error Statistics:`);
    if (results.processingErrors.length > 0) {
      logger.warn(`   Processing errors: ${results.processingErrors.length}`);
    }
    if (results.updateErrors.length > 0) {
      logger.warn(`   Update errors: ${results.updateErrors.length}`);
    }
  }

  // Entries with broken links details (show first 10)
  if (results.entriesWithBrokenLinks.length > 0) {
    logger.info(`\n🔗 Entries with Broken Links:`);
    results.entriesWithBrokenLinks.slice(0, 10).forEach((entry, index) => {
      logger.info(
        `   ${index + 1}. ${entry.entryId} (${entry.contentType}): ${
          entry.brokenLinks
        } broken links`
      );
    });

    if (results.entriesWithBrokenLinks.length > 10) {
      logger.info(
        `   ... and ${results.entriesWithBrokenLinks.length - 10} more entries`
      );
    }
  }

  // Performance metrics
  const successRate =
    results.totalProcessed > 0
      ? (
          ((results.totalProcessed - results.processingErrors.length) /
            results.totalProcessed) *
          100
        ).toFixed(1)
      : "0.0";

  logger.info(`\n📈 Performance:`);
  logger.info(`   Success rate: ${successRate}%`);

  // Final status
  logger.info("\n" + "=".repeat(60));
  if (
    results.processingErrors.length === 0 &&
    results.updateErrors.length === 0
  ) {
    logger.success("✅ Link cleanup completed successfully!");
  } else {
    logger.warn(
      "⚠️ Link cleanup completed with some errors. Please review the logs."
    );
  }
  logger.info("=".repeat(60) + "\n");
}

/**
 * Parse command line arguments
 */
function parseCommandLineArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--space-id":
        options.spaceId = args[++i];
        break;
      case "--environment":
      case "--env":
        options.environmentId = args[++i];
        break;
      case "--management-token":
      case "--token":
        options.managementToken = args[++i];
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--publish":
        options.publish = true;
        break;
      case "--log-level":
        options.logLevel = args[++i];
        break;
      case "--content-type":
        options.contentTypeFilter = args[++i];
        break;
      case "--batch-size":
        options.batchSize = parseInt(args[++i]);
        break;
      case "--max-entries":
        options.maxEntries = parseInt(args[++i]);
        break;
      case "--help":
      case "-h":
        showHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          logger.warn(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  return options;
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
🔗 Contentful Link Cleanup Tool

Usage: node cf-link-cleanup.js [options]

Options:
  --space-id <id>           Contentful space ID (or set CONTENTFUL_SPACE_ID env var)
  --environment <env>       Environment name (or set CONTENTFUL_ENVIRONMENT_ID env var, default: master)
  --management-token <token> Management API token (or set CONTENTFUL_MANAGEMENT_TOKEN env var)
  --content-type <type>     Filter by specific content type
  --batch-size <size>       Entries per batch (default: 50)
  --max-entries <count>     Maximum entries to process (default: 1000)
  --dry-run                 Preview changes without applying them
  --publish                 Publish entries after updates (default: false)
  --log-level <level>       Logging level: debug, info, warn, error (default: info)
  --help, -h               Show this help message

Environment Variables:
  CONTENTFUL_MANAGEMENT_TOKEN   Management API token
  CONTENTFUL_SPACE_ID          Space ID
  CONTENTFUL_ENVIRONMENT_ID    Environment ID (default: master)
  DRY_RUN                      Set to 'true' for dry run
  PUBLISH_AFTER_UPDATE         Set to 'true' to publish after updates
  LOG_LEVEL                    Logging level (default: info)

Examples:
  # Basic usage with env vars
  node cf-link-cleanup.js

  # Specify options explicitly
  node cf-link-cleanup.js --space-id abc123 --environment master --dry-run

  # Filter by content type and publish
  node cf-link-cleanup.js --content-type blogPost --publish

  # Dry run with debug logging
  node cf-link-cleanup.js --dry-run --log-level debug
  `);
}

/**
 * Main execution function
 */
async function main() {
  try {
    // Parse CLI arguments
    const cliOptions = parseCommandLineArgs();

    // Merge configuration from CLI, env vars, and defaults
    const finalConfig = {
      ...CONFIG,
      ...cliOptions,
    };

    // Override from CLI if provided
    if (cliOptions.spaceId) finalConfig.SPACE_ID = cliOptions.spaceId;
    if (cliOptions.environmentId)
      finalConfig.ENVIRONMENT_ID = cliOptions.environmentId;
    if (cliOptions.managementToken)
      finalConfig.ACCESS_TOKEN = cliOptions.managementToken;
    if (cliOptions.dryRun !== undefined)
      finalConfig.DRY_RUN = cliOptions.dryRun;
    if (cliOptions.publish !== undefined)
      finalConfig.PUBLISH_AFTER_UPDATE = cliOptions.publish;
    if (cliOptions.logLevel) finalConfig.LOG_LEVEL = cliOptions.logLevel;
    if (cliOptions.batchSize) finalConfig.BATCH_SIZE = cliOptions.batchSize;
    if (cliOptions.maxEntries) finalConfig.MAX_ENTRIES = cliOptions.maxEntries;

    // Update global CONFIG
    Object.assign(CONFIG, finalConfig);

    // Validate configuration
    validateConfig();

    // Initialize Contentful client
    await initializeClient();

    logger.info(`🔍 Starting bulk link cleanup...`);
    logger.info(`📋 Configuration:`);
    logger.info(`   - Space: ${CONFIG.SPACE_ID}`);
    logger.info(`   - Environment: ${CONFIG.ENVIRONMENT_ID}`);
    logger.info(`   - Dry run: ${CONFIG.DRY_RUN}`);
    logger.info(`   - Publish after update: ${CONFIG.PUBLISH_AFTER_UPDATE}`);
    logger.info(`   - Max entries: ${CONFIG.MAX_ENTRIES}`);
    logger.info(`   - Batch size: ${CONFIG.BATCH_SIZE}`);
    if (finalConfig.contentTypeFilter) {
      logger.info(`   - Content type filter: ${finalConfig.contentTypeFilter}`);
    }

    // Execute bulk link cleanup
    const results = await bulkLinkCleanup({
      contentTypeFilter: finalConfig.contentTypeFilter,
      batchSize: CONFIG.BATCH_SIZE,
      maxEntries: CONFIG.MAX_ENTRIES,
      dryRun: CONFIG.DRY_RUN,
      shouldPublish: CONFIG.PUBLISH_AFTER_UPDATE,
    });

    // Display summary
    displaySummary(results, {
      dryRun: CONFIG.DRY_RUN,
      shouldPublish: CONFIG.PUBLISH_AFTER_UPDATE,
    });

    // Exit with appropriate code
    const hasErrors =
      results.processingErrors.length > 0 || results.updateErrors.length > 0;
    process.exit(hasErrors ? 1 : 0);
  } catch (error) {
    logger.error("Fatal error:", error);
    process.exit(1);
  }
}

// Run main function if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  bulkLinkCleanup,
  cleanEntryLinks,
  validateLink,
  updateEntry,
  displaySummary,
};
