const contentful = require("contentful-management");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Configuration
const CONFIG = {
  ACCESS_TOKEN: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  SOURCE_SPACE: process.env.SPACE_ID_FR_FR,
  SOURCE_ENV: process.env.ENV_FR_FR,
  TARGET_SPACE: process.env.SPACE_ID_EN_GB,
  TARGET_ENV: process.env.ENV_EN_GB,
  SPACE_ID_FR_FR: process.env.SPACE_ID_FR_FR,
  ENV_FR_FR: process.env.ENV_FR_FR,
  SPACE_ID_DE_DE: process.env.SPACE_ID_DE_DE,
  ENV_DE_DE: process.env.ENV_DE_DE,
  MOBILE_APP_SPACE: process.env.MOBILE_APP_SPACE_ID,
  MOBILE_APP_ENV: process.env.MOBILE_APP_ENV,
  RETRY_ATTEMPTS: 5,
  RETRY_DELAY: 1000,
  RATE_LIMIT_DELAY: 300,
};

// Initialize contentful client
const client = contentful.createClient({
  accessToken: CONFIG.ACCESS_TOKEN,
});

// Logger setup
const logger = {
  logToFile: (message, type = "info") => {
    // Also log to console with color formatting
    const colors = {
      info: "\x1b[36m%s\x1b[0m", // Cyan
      success: "\x1b[32m%s\x1b[0m", // Green
      warning: "\x1b[33m%s\x1b[0m", // Yellow
      error: "\x1b[31m%s\x1b[0m", // Red
    };
    console.log(
      colors[type] || colors.info,
      `[${type.toUpperCase()}] ${message}`
    );
  },
  info: (message) => logger.logToFile(message, "info"),
  success: (message) => logger.logToFile(message, "success"),
  warn: (message) => logger.logToFile(message, "warning"),
  error: (message, err) => {
    const errorDetails =
      err instanceof Error
        ? `${err.message}\n${err.stack}`
        : JSON.stringify(err);
    logger.logToFile(`${message}: ${errorDetails}`, "error");
  },
};

// Helper functions
const helpers = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

  isRateLimitError: (err) => {
    return (
      err &&
      (err.name === "RateLimitExceeded" ||
        (err.response && err.response.status === 429))
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
          const delay = CONFIG.RETRY_DELAY + Math.floor(Math.random() * 1000);
          logger.warn(
            `Rate limit hit on ${operationName}, retry ${retries}/${maxRetries} in ${delay}ms...`
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

  getEnvironments: async (spaceId, envId) => {
    try {
      const space = await client.getSpace(spaceId);
      const environment = await space.getEnvironment(envId);
      return { space, environment };
    } catch (err) {
      logger.error(
        `Failed to get space ${spaceId} or environment ${envId}`,
        err
      );
      throw err;
    }
  },
};

/**
 * Enhanced retry function with exponential backoff for rate limiting
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<any>} - Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 5, timeoutMs = 30000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      // Add timeout to the function call
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
      });

      return await Promise.race([fn(), timeoutPromise]);
    } catch (error) {
      if (error.name === "RateLimitExceeded") {
        const wait = (error.retryAfter || 2 ** attempt) * 1000;
        logger.warn(
          `Rate limit hit. Retrying in ${wait}ms... (Attempt ${
            attempt + 1
          }/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
        attempt++;
      } else if (error.message === "Request timeout") {
        logger.warn(
          `Request timed out after ${timeoutMs}ms. Retrying... (Attempt ${
            attempt + 1
          }/${maxRetries})`
        );
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        throw error; // Rethrow non-retriable errors
      }
    }
  }
  throw new Error(
    `Operation failed after ${maxRetries} attempts due to rate limits or timeouts.`
  );
}

/**
 * Remove all links to a specific entry from other entries that reference it.
 * Automatically handles archived entries by unarchiving them before updating.
 * @param {import('contentful-management').Environment} environment
 * @param {string} entryId - The entry ID to unlink from all other entries
 * @returns {Promise<{success: boolean, unlinkedFrom: Array, errors: Array}>} - Results of unlinking process
 */
async function unlinkEntryFromAllReferences(environment, entryId) {
  const result = {
    success: true,
    unlinkedFrom: [],
    errors: [],
    totalProcessed: 0,
    totalUpdated: 0,
    totalUnarchived: 0,
  };

  try {
    logger.info(`🔗 Starting unlinking process for entry ${entryId}...`);

    // Find all entries that reference this entry
    const referencingEntries = await retryWithBackoff(() =>
      environment.getEntries({
        links_to_entry: entryId,
        limit: 1000, // Get all referencing entries
      })
    );

    if (referencingEntries.items.length === 0) {
      logger.info(`✅ Entry ${entryId} is not referenced by any other entries`);
      return result;
    }

    logger.info(
      `📋 Found ${referencingEntries.items.length} entries referencing ${entryId}`
    );
    result.totalProcessed = referencingEntries.items.length;

    // Process each referencing entry
    for (const referencingEntry of referencingEntries.items) {
      try {
        const referencingEntryId = referencingEntry.sys.id;
        let hasChanges = false;
        let wasArchived = false;
        const removedLinks = [];

        logger.info(
          `🔍 Processing entry ${referencingEntryId} for links to ${entryId}...`
        );

        // Track if entry is archived before we potentially unarchive it
        wasArchived = referencingEntry.sys.archivedAt !== null;

        // Check all fields in the referencing entry
        if (
          referencingEntry.fields &&
          typeof referencingEntry.fields === "object"
        ) {
          const fieldKeys = Object.keys(referencingEntry.fields);

          for (const fieldKey of fieldKeys) {
            try {
              const fieldData = referencingEntry.fields[fieldKey];

              if (!fieldData || typeof fieldData !== "object") {
                continue;
              }

              const localeKeys = Object.keys(fieldData);

              for (const locale of localeKeys) {
                try {
                  if (
                    !Object.prototype.hasOwnProperty.call(fieldData, locale)
                  ) {
                    continue;
                  }

                  const value = fieldData[locale];

                  if (value === null || value === undefined) {
                    continue;
                  }

                  // Handle arrays of links
                  if (Array.isArray(value)) {
                    const originalLength = value.length;
                    const filteredArray = value.filter((item) => {
                      if (
                        item &&
                        typeof item === "object" &&
                        item.sys &&
                        item.sys.type === "Link" &&
                        item.sys.id === entryId
                      ) {
                        removedLinks.push({
                          field: fieldKey,
                          locale: locale,
                          linkType: item.sys.linkType,
                          removedId: entryId,
                        });
                        return false; // Remove this link
                      }
                      return true; // Keep this item
                    });

                    if (filteredArray.length !== originalLength) {
                      referencingEntry.fields[fieldKey][locale] = filteredArray;
                      hasChanges = true;
                      logger.info(
                        `  ✂️  Removed ${
                          originalLength - filteredArray.length
                        } link(s) from ${fieldKey}.${locale}`
                      );
                    }
                  }
                  // Handle single link objects
                  else if (
                    value &&
                    typeof value === "object" &&
                    value.sys &&
                    value.sys.type === "Link" &&
                    value.sys.id === entryId
                  ) {
                    referencingEntry.fields[fieldKey][locale] = null;
                    hasChanges = true;
                    removedLinks.push({
                      field: fieldKey,
                      locale: locale,
                      linkType: value.sys.linkType,
                      removedId: entryId,
                    });
                    logger.info(
                      `  ✂️  Removed link from ${fieldKey}.${locale}`
                    );
                  }
                } catch (localeError) {
                  const error = `Error processing locale ${locale}: ${localeError.message}`;
                  logger.warn(
                    `Entry ${referencingEntryId}, field ${fieldKey}: ${error}`
                  );
                  result.errors.push({
                    entryId: referencingEntryId,
                    field: fieldKey,
                    locale: locale,
                    error: error,
                  });
                }
              }
            } catch (fieldError) {
              const error = `Error processing field ${fieldKey}: ${fieldError.message}`;
              logger.warn(`Entry ${referencingEntryId}: ${error}`);
              result.errors.push({
                entryId: referencingEntryId,
                field: fieldKey,
                error: error,
              });
            }
          }
        } // Update the entry if there were changes
        if (hasChanges) {
          if (!wasArchived) {
            try {
              logger.info(
                `💾 Updating entry ${referencingEntryId} to remove links...`
              );
              await retryWithBackoff(() => referencingEntry.update());
              result.unlinkedFrom.push({
                entryId: referencingEntryId,
                contentType: referencingEntry.sys.contentType.sys.id,
                removedLinks: removedLinks,
                wasArchived: wasArchived,
              });
              result.totalUpdated++;

              logger.success(
                `✅ Updated entry ${referencingEntryId} (removed ${removedLinks.length} link(s))`
              );

              // Small delay to prevent rate limiting
              await new Promise((resolve) => setTimeout(resolve, 500));
            } catch (updateError) {
              const error = `Failed to update entry ${referencingEntryId}: ${updateError.message}`;
              logger.error(error);
              result.errors.push({
                entryId: referencingEntryId,
                error: error,
                operation: "update",
              });
              result.success = false;
            }
          }
        } else {
          logger.info(`ℹ️  No links found in entry ${referencingEntryId}`);
        }
      } catch (entryError) {
        const error = `Error processing referencing entry ${referencingEntry.sys.id}: ${entryError.message}`;
        logger.error(error);
        result.errors.push({
          entryId: referencingEntry.sys.id,
          error: error,
          operation: "process",
        });
        result.success = false;
      }
    }
    if (result.totalUpdated > 0) {
      let successMessage = `🎉 Successfully unlinked entry ${entryId} from ${result.totalUpdated} entries`;
      if (result.totalUnarchived > 0) {
        successMessage += ` (unarchived ${result.totalUnarchived} entries)`;
      }
      logger.success(successMessage);
    }

    if (result.errors.length > 0) {
      logger.warn(
        `⚠️  Encountered ${result.errors.length} errors during unlinking process`
      );
    }

    return result;
  } catch (error) {
    const errorMsg = `Fatal error in unlinkEntryFromAllReferences for ${entryId}: ${error.message}`;
    logger.error(errorMsg);
    result.success = false;
    result.errors.push({
      entryId: entryId,
      error: errorMsg,
      operation: "fatal",
    });
    return result;
  }
}

/**
 * Check if an entry is linked by other entries
 * @param {import('contentful-management').Environment} environment
 * @param {string} entryId - The entry ID to check
 * @returns {Promise<{isLinked: boolean, linkedBy: Array}>} - Link status and referencing entries
 */
async function isEntryLinked(environment, entryId) {
  try {
    const referencingEntries = await retryWithBackoff(() =>
      environment.getEntries({
        links_to_entry: entryId,
        limit: 100, // Get up to 100 referencing entries for checking
      })
    );

    return {
      isLinked: referencingEntries.items.length > 0,
      linkedBy: referencingEntries.items.map((entry) => ({
        id: entry.sys.id,
        contentType: entry.sys.contentType.sys.id,
        version: entry.sys.version,
      })),
    };
  } catch (error) {
    logger.error(`Error checking if entry ${entryId} is linked:`, error);
    // If we can't check, assume it might be linked for safety
    return { isLinked: true, linkedBy: [] };
  }
}

/**
 * Synchronizes content types from a source environment to a target environment.
 * Adds new content types, updates existing ones, and handles field additions/removals.
 *
 * @param {string} sourceSpaceId - Source space ID
 * @param {string} targetSpaceId - Target space ID
 * @param {string} sourceEnvId - Source environment ID
 * @param {string} targetEnvId - Target environment ID
 * @returns {Promise<void>}
 */
async function syncContentTypes(
  sourceSpaceId = CONFIG.SOURCE_SPACE,
  targetSpaceId = CONFIG.TARGET_SPACE,
  sourceEnvId = CONFIG.SOURCE_ENV,
  targetEnvId = CONFIG.TARGET_ENV
) {
  try {
    logger.info(
      `Starting content type sync from ${sourceSpaceId}/${sourceEnvId} to ${targetSpaceId}/${targetEnvId}`
    );

    // Get environments with retry handling
    const source = await helpers.withRetry(
      () => helpers.getEnvironments(sourceSpaceId, sourceEnvId),
      "get_source_environments"
    );
    const target = await helpers.withRetry(
      () => helpers.getEnvironments(targetSpaceId, targetEnvId),
      "get_target_environments"
    );

    // Fetch content types from both environments
    const sourceContentTypes = await helpers.withRetry(
      () => source.environment.getContentTypes({ limit: 1000 }),
      "fetch_source_content_types"
    );

    const targetContentTypes = await helpers.withRetry(
      () => target.environment.getContentTypes({ limit: 1000 }),
      "fetch_target_content_types"
    );

    logger.info(
      `Found ${sourceContentTypes.items.length} content types in source and ${targetContentTypes.items.length} in target`
    );

    // Create or update content types in target environment
    for (const sourceCT of sourceContentTypes.items) {
      try {
        // Get target content type if it exists
        const targetCT = await helpers.withRetry(
          () =>
            target.environment
              .getContentType(sourceCT.sys.id)
              .catch(() => null),
          `get_target_content_type_${sourceCT.sys.id}`
        );

        logger.info(
          `Processing content type: ${sourceCT.sys.id} (${
            targetCT ? "Update" : "Create"
          })`
        );

        if (targetCT) {
          await updateExistingContentType(
            sourceCT,
            targetCT,
            target.environment
          );
        } else {
          await createNewContentType(sourceCT, target.environment);
        }

        await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);
      } catch (err) {
        logger.error(`Failed to process content type: ${sourceCT.sys.id}`, err);
      }
    }

    logger.success("Content type synchronization completed");
  } catch (err) {
    logger.error("Content type synchronization failed", err);
    throw err;
  }
}
/**
 * Migrates a single content type from source to target environment.
 * @param {string} contentTypeId - The ID of the content type to migrate
 * @param {string} sourceSpaceId - Source space ID
 * @param {string} targetSpaceId - Target space ID
 * @param {string} sourceEnvId - Source environment ID
 * @param {string} targetEnvId - Target environment ID
 * @returns {Promise<void>}
 */
async function migrateSingleContentType(
  contentTypeId,
  sourceSpaceId = CONFIG.SOURCE_SPACE,
  targetSpaceId = CONFIG.TARGET_SPACE,
  sourceEnvId = CONFIG.SOURCE_ENV,
  targetEnvId = CONFIG.TARGET_ENV
) {
  try {
    if (!contentTypeId) {
      logger.error("No content type ID provided");
      return;
    }
    logger.info(
      `Migrating single content type '${contentTypeId}' from ${sourceSpaceId}/${sourceEnvId} to ${targetSpaceId}/${targetEnvId}`
    );

    // Get environments
    const source = await helpers.withRetry(
      () => helpers.getEnvironments(sourceSpaceId, sourceEnvId),
      "get_source_environments"
    );
    const target = await helpers.withRetry(
      () => helpers.getEnvironments(targetSpaceId, targetEnvId),
      "get_target_environments"
    );

    // Fetch the content type from source
    const sourceCT = await helpers.withRetry(
      () => source.environment.getContentType(contentTypeId),
      `fetch_source_content_type_${contentTypeId}`
    );

    // Try to fetch the content type from target
    const targetCT = await helpers.withRetry(
      () => target.environment.getContentType(contentTypeId).catch(() => null),
      `fetch_target_content_type_${contentTypeId}`
    );

    if (targetCT) {
      logger.info(`Updating existing content type: ${contentTypeId}`);
      await updateExistingContentType(sourceCT, targetCT, target.environment);
    } else {
      logger.info(`Creating new content type: ${contentTypeId}`);
      await createNewContentType(sourceCT, target.environment);
    }

    logger.success(`Migration of content type '${contentTypeId}' completed.`);
  } catch (err) {
    logger.error(`Migration of content type '${contentTypeId}' failed`, err);
    throw err;
  }
}

/**
 * Updates an existing content type in the target environment.
 *
 * @param {Object} sourceCT - Source content type
 * @param {Object} targetCT - Target content type
 * @param {Object} targetEnv - Target environment
 * @returns {Promise<void>}
 */
async function updateExistingContentType(sourceCT, targetCT, targetEnv) {
  // Update basic properties
  targetCT.name = sourceCT.name;
  targetCT.description = sourceCT.description;

  const sourceFieldIds = sourceCT.fields.map((f) => f.id);
  const targetFieldIds = targetCT.fields.map((f) => f.id);

  // Check if fields are the same
  const fieldsAreSame =
    sourceFieldIds.length === targetFieldIds.length &&
    sourceFieldIds.every((id) => targetFieldIds.includes(id));

  // If fields are the same, skip update
  if (fieldsAreSame) {
    logger.info(
      `No field changes for content type: ${targetCT.sys.id}, skipping update`
    );
    return;
  }

  // Add new fields from source
  const newFields = sourceCT.fields.filter(
    (f) => !targetFieldIds.includes(f.id)
  );

  // Identify fields to mark as omitted (in target but not in source)
  const fieldsToRemove = targetCT.fields.filter(
    (f) => !sourceFieldIds.includes(f.id)
  );

  // Process new fields
  if (newFields.length > 0) {
    await addNewFieldsToContentType(targetCT.sys.id, newFields, targetEnv);
  } else {
    logger.info(`No new fields to add for content type: ${targetCT.sys.id}`);
  }

  // Process fields to omit
  if (fieldsToRemove.length > 0) {
    await omitFieldsFromContentType(targetCT.sys.id, fieldsToRemove, targetEnv);
  } else {
    logger.info(`No fields to remove for content type: ${targetCT.sys.id}`);
  }

  logger.success(`Updated content type: ${targetCT.sys.id}`);
}

/**
 * Adds new fields to a content type.
 *
 * @param {string} contentTypeId - Content type ID
 * @param {Array} newFields - Array of new fields to add
 * @param {Object} targetEnv - Target environment
 * @returns {Promise<void>}
 */
async function addNewFieldsToContentType(contentTypeId, newFields, targetEnv) {
  try {
    // Always fetch the latest version before updating
    const latestCT = await helpers.withRetry(
      () => targetEnv.getContentType(contentTypeId),
      `get_latest_ct_for_fields_${contentTypeId}`
    );

    // Add the new fields
    latestCT.fields = [...latestCT.fields, ...newFields];

    // Update and publish
    const updatedCT = await helpers.withRetry(
      () => latestCT.update(),
      `update_ct_with_new_fields_${contentTypeId}`
    );

    await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);

    const freshCT = await helpers.withRetry(
      () => targetEnv.getContentType(updatedCT.sys.id),
      `get_fresh_ct_${contentTypeId}`
    );

    await helpers.withRetry(
      () => freshCT.publish(),
      `publish_ct_with_new_fields_${contentTypeId}`
    );

    logger.success(
      `Added ${newFields.length} new fields to content type: ${freshCT.sys.id}`
    );
  } catch (err) {
    logger.error(
      `Failed to add new fields to content type: ${contentTypeId}`,
      err
    );
    throw err;
  }
}

/**
 * Marks fields as omitted in a content type.
 *
 * @param {string} contentTypeId - Content type ID
 * @param {Array} fieldsToRemove - Array of fields to mark as omitted
 * @param {Object} targetEnv - Target environment
 * @returns {Promise<void>}
 */
async function omitFieldsFromContentType(
  contentTypeId,
  fieldsToRemove,
  targetEnv
) {
  try {
    // Always fetch the latest version before updating
    const latestCT = await helpers.withRetry(
      () => targetEnv.getContentType(contentTypeId),
      `get_latest_ct_for_omit_${contentTypeId}`
    );

    // Mark fields as omitted
    latestCT.fields = latestCT.fields.map((field) => {
      if (fieldsToRemove.some((f) => f.id === field.id)) {
        return { ...field, omitted: true };
      }
      return field;
    });

    // Update and publish
    const updatedCT = await helpers.withRetry(
      () => latestCT.update(),
      `update_ct_with_omitted_fields_${contentTypeId}`
    );

    await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);

    const freshCT = await helpers.withRetry(
      () => targetEnv.getContentType(updatedCT.sys.id),
      `get_fresh_ct_for_omit_${contentTypeId}`
    );

    await helpers.withRetry(
      () => freshCT.publish(),
      `publish_ct_with_omitted_fields_${contentTypeId}`
    );

    logger.success(
      `Marked ${fieldsToRemove.length} fields as omitted in content type: ${freshCT.sys.id}`
    );
  } catch (err) {
    logger.error(
      `Failed to mark fields as omitted in content type: ${contentTypeId}`,
      err
    );
    throw err;
  }
}

/**
 * Creates a new content type in the target environment.
 *
 * @param {Object} sourceCT - Source content type
 * @param {Object} targetEnv - Target environment
 * @returns {Promise<void>}
 */
async function createNewContentType(sourceCT, targetEnv) {
  try {
    const latestSourceCT = await helpers.withRetry(
      () => sourceCT,
      `get_latest_source_ct_${sourceCT.sys.id}`
    );

    logger.info(`Creating new content type: ${latestSourceCT.sys.id}`);

    // Create content type
    const newCT = await helpers.withRetry(
      () =>
        targetEnv.createContentTypeWithId(latestSourceCT.sys.id, {
          name: latestSourceCT.name,
          description: latestSourceCT.description,
          fields: latestSourceCT.fields,
        }),
      `create_new_ct_${latestSourceCT.sys.id}`
    );

    // Publish content type
    await helpers.withRetry(
      () => newCT.publish(),
      `publish_new_ct_${latestSourceCT.sys.id}`
    );

    logger.success(`Created and published content type: ${newCT.sys.id}`);
  } catch (err) {
    logger.error(`Failed to create content type: ${sourceCT.sys.id}`, err);
    throw err;
  }
}
/**
 * Synchronizes locales from source environment to target environment.
 * Sets en-US as the default locale and creates missing locales.
 *
 * @param {string} sourceSpaceId - Source space ID
 * @param {string} targetSpaceId - Target space ID
 * @param {string} sourceEnvId - Source environment ID
 * @param {string} targetEnvId - Target environment ID
 * @returns {Promise<void>}
 */
async function syncLocales(
  sourceSpaceId = CONFIG.SOURCE_SPACE,
  targetSpaceId = CONFIG.TARGET_SPACE,
  sourceEnvId = CONFIG.SOURCE_ENV,
  targetEnvId = CONFIG.TARGET_ENV
) {
  try {
    logger.info(
      `Syncing locales from ${sourceSpaceId}/${sourceEnvId} to ${targetSpaceId}/${targetEnvId}`
    );

    // Get environments with retry handling
    const source = await helpers.withRetry(
      () => helpers.getEnvironments(sourceSpaceId, sourceEnvId),
      "get_source_environments_for_locales"
    );

    const target = await helpers.withRetry(
      () => helpers.getEnvironments(targetSpaceId, targetEnvId),
      "get_target_environments_for_locales"
    );

    // Fetch locales from both environments
    const sourceLocales = await helpers.withRetry(
      () => source.environment.getLocales(),
      "fetch_source_locales"
    );

    const targetLocales = await helpers.withRetry(
      () => target.environment.getLocales(),
      "fetch_target_locales"
    );

    const targetLocaleCodes = targetLocales.items.map((l) => l.code);

    // Set en-US as the default locale
    for (const locale of targetLocales.items) {
      try {
        if (locale.code === "en-US" && !locale.default) {
          locale.default = true;
          await helpers.withRetry(
            () => locale.update(),
            `set_${locale.code}_as_default`
          );
          logger.success(`Set "${locale.code}" as default locale`);
        } else if (locale.code !== "en-US" && locale.default) {
          locale.default = false;
          await helpers.withRetry(
            () => locale.update(),
            `unset_${locale.code}_as_default`
          );
          logger.info(`Unset "${locale.code}" as default locale`);
        }
        await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);
      } catch (err) {
        logger.error(`Failed to update locale ${locale.code}`, err);
      }
    }

    // Create missing locales in target environment
    for (const locale of sourceLocales.items) {
      try {
        logger.info(`Processing locale: ${locale.code}`);

        if (!targetLocaleCodes.includes(locale.code)) {
          await helpers.withRetry(
            () =>
              target.environment.createLocale({
                code: locale.code,
                name: locale.name,
                fallbackCode: locale.fallbackCode || null,
                optional: locale.optional,
                contentManagementApi: locale.contentManagementApi,
                contentDeliveryApi: locale.contentDeliveryApi,
                default: false, // Default is set separately
              }),
            `create_locale_${locale.code}`
          );
          logger.success(`Created locale "${locale.code}" in target`);
          await helpers.sleep(1000); // Longer delay after creating a locale
        } else {
          logger.info(
            `Locale "${locale.code}" already exists in target, skipping`
          );
        }
      } catch (err) {
        logger.error(`Failed to create locale ${locale.code}`, err);
      }
    }

    logger.success("Locale synchronization completed");
  } catch (err) {
    logger.error("Locale synchronization failed", err);
    throw err;
  }
}

async function deleteDuplicateContentTypes(
  targetSpaceId = CONFIG.TARGET_SPACE,
  targetEnvId = CONFIG.TARGET_ENV
) {
  try {
    logger.info(
      `Finding duplicate content types in ${targetSpaceId}/${targetEnvId}`
    );

    const target = await helpers.withRetry(
      () => helpers.getEnvironments(targetSpaceId, targetEnvId),
      "get_target_environments_for_duplicates"
    );

    const targetContentTypes = await helpers.withRetry(
      () => target.environment.getContentTypes({ limit: 1000 }),
      "fetch_target_content_types_for_duplicates"
    );

    // Find duplicate content types by name
    const nameMap = {};
    for (const ct of targetContentTypes.items) {
      if (!nameMap[ct.name]) {
        nameMap[ct.name] = [];
      }
      nameMap[ct.name].push(ct);
    }

    // Count duplicates
    let duplicateCount = 0;
    Object.values(nameMap).forEach((dups) => {
      if (dups.length > 1) duplicateCount += dups.length - 1;
    });

    logger.info(`Found ${duplicateCount} duplicate content types to delete`);

    // Delete all but the first occurrence of each duplicate
    for (const name in nameMap) {
      const dups = nameMap[name];
      if (dups.length > 1) {
        logger.info(
          `Content type "${name}" has ${dups.length} duplicates, keeping one and deleting the rest`
        );

        // Keep the first, delete the rest
        for (let i = 1; i < dups.length; i++) {
          const ct = dups[i];
          try {
            if (ct.sys.publishedVersion) {
              await helpers.withRetry(
                () => ct.unpublish(),
                `unpublish_duplicate_ct_${ct.sys.id}`
              );
              logger.info(`Unpublished duplicate content type: ${ct.sys.id}`);
            }

            await helpers.withRetry(
              () => ct.delete(),
              `delete_duplicate_ct_${ct.sys.id}`
            );

            logger.success(
              `Deleted duplicate content type: ${ct.sys.id} (${ct.name})`
            );
            await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);
          } catch (err) {
            logger.error(
              `Failed to delete duplicate content type: ${ct.sys.id}`,
              err
            );
          }
        }
      }
    }

    logger.success(`Duplicate content type deletion completed`);
  } catch (err) {
    logger.error("Error deleting duplicate content types", err);
    throw err;
  }
}

async function deleteOmittedFieldsFromContentTypes(
  targetSpaceId = CONFIG.TARGET_SPACE,
  targetEnvId = CONFIG.TARGET_ENV
) {
  try {
    logger.info(
      `Finding content types with omitted fields in ${targetSpaceId}/${targetEnvId}`
    );

    const target = await helpers.withRetry(
      () => helpers.getEnvironments(targetSpaceId, targetEnvId),
      "get_target_environments_for_omitted_fields"
    );

    const targetContentTypes = await helpers.withRetry(
      () => target.environment.getContentTypes({ limit: 1000 }),
      "fetch_target_content_types_for_omitted_fields"
    );

    let contentTypesWithOmittedFields = 0;
    let totalOmittedFields = 0;

    for (const ct of targetContentTypes.items) {
      try {
        const omittedFields = ct.fields.filter((f) => f.omitted);
        if (omittedFields.length > 0) {
          contentTypesWithOmittedFields++;
          totalOmittedFields += omittedFields.length;

          logger.info(
            `Content type ${ct.sys.id} has ${omittedFields.length} omitted fields, removing them`
          );

          // Always fetch the latest version before updating
          const latestCT = await helpers.withRetry(
            () => target.environment.getContentType(ct.sys.id),
            `get_latest_ct_for_omit_cleanup_${ct.sys.id}`
          );

          // Remove omitted fields
          latestCT.fields = latestCT.fields.filter((f) => !f.omitted);

          // Update and publish
          const updatedCT = await helpers.withRetry(
            () => latestCT.update(),
            `update_ct_remove_omitted_fields_${ct.sys.id}`
          );

          await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);

          const freshCT = await helpers.withRetry(
            () => target.environment.getContentType(updatedCT.sys.id),
            `get_fresh_ct_for_omit_cleanup_${ct.sys.id}`
          );

          await helpers.withRetry(
            () => freshCT.publish(),
            `publish_ct_after_omit_cleanup_${ct.sys.id}`
          );

          logger.success(
            `Removed ${omittedFields.length} omitted fields from content type: ${freshCT.sys.id}`
          );
          await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);
        }
      } catch (err) {
        logger.error(
          `Failed to process omitted fields for content type: ${ct.sys.id}`,
          err
        );
      }
    }

    logger.success(
      `Found and processed ${contentTypesWithOmittedFields} content types with a total of ${totalOmittedFields} omitted fields`
    );
  } catch (err) {
    logger.error("Error deleting omitted fields", err);
    throw err;
  }
}

/**
 * Delete all entries of specified content types and then delete the content types themselves.
 *
 * @param {string|string[]} contentTypeIds - Content type ID or array of IDs to delete
 * @param {string} targetSpaceId - Target space ID
 * @param {string} targetEnvId - Target environment ID
 * @returns {Promise<void>}
 */
async function deleteEntriesAndContentType(
  contentTypeIds,
  targetSpaceId = CONFIG.SPACE_ID_DE_DE,
  targetEnvId = CONFIG.ENV_DE_DE
) {
  try {
    // Convert single content type ID to array for consistent processing
    const typeIds = Array.isArray(contentTypeIds)
      ? contentTypeIds
      : [contentTypeIds];

    logger.info(
      `Starting deletion process for ${
        typeIds.length
      } content type(s) in ${targetSpaceId}/${targetEnvId}: ${typeIds.join(
        ", "
      )}`
    );
    const target = await helpers.withRetry(
      () => helpers.getEnvironments(targetSpaceId, targetEnvId),
      "get_target_env_for_bulk_delete"
    ); // Process each content type
    for (const contentTypeId of typeIds) {
      try {
        // Fetch all entries of the content type
        const entries = await helpers.withRetry(
          () =>
            target.environment.getEntries({
              content_type: contentTypeId,
              limit: 1000,
            }),
          `fetch_entries_of_${contentTypeId}`
        );

        logger.info(
          `Found ${entries.items.length} entries for content type: ${contentTypeId}`
        ); // Process entries in batches to respect rate limits
        const batchSize = 10;
        for (let i = 0; i < entries.items.length; i += batchSize) {
          const batch = entries.items.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (entry) => {
              try {
                const entryId = entry.sys.id;
                logger.info(`🔍 Processing entry: ${entryId}`);

                // NEW: Check if the entry being deleted is archived
                // If archived, skip unlinking process and delete directly
                if (entry.sys.archivedAt) {
                  logger.info(
                    `📦 Entry ${entryId} is archived - skipping unlinking, will delete directly`
                  );

                  // Process archived entry deletion directly
                  if (entry.isArchived && entry.isArchived()) {
                    await helpers.withRetry(
                      () => entry.unarchive(),
                      `unarchive_entry_${entry.sys.id}`
                    );
                    logger.info(`📤 Unarchived entry: ${entry.sys.id}`);
                  }

                  if (entry.isPublished && entry.isPublished()) {
                    await helpers.withRetry(
                      () => entry.unpublish(),
                      `unpublish_entry_${entry.sys.id}`
                    );
                    logger.info(`📤 Unpublished entry: ${entry.sys.id}`);
                  }

                  await helpers.withRetry(
                    () => entry.delete(),
                    `delete_entry_${entry.sys.id}`
                  );

                  logger.success(
                    `🗑️  Deleted archived entry: ${entry.sys.id} (skipped unlinking)`
                  );
                  return; // Skip the rest of the processing for this entry
                }

                // Check if entry is linked by other entries (only for non-archived entries)
                const linkResult = await isEntryLinked(
                  target.environment,
                  entryId
                );

                if (linkResult.isLinked) {
                  logger.warn(
                    `🔗 Entry ${entryId} is linked by ${linkResult.linkedBy.length} other entries - attempting to unlink...`
                  );

                  // Attempt to unlink the entry from all references
                  const unlinkResult = await unlinkEntryFromAllReferences(
                    target.environment,
                    entryId
                  );

                  if (unlinkResult.success && unlinkResult.totalUpdated > 0) {
                    logger.success(
                      `✅ Successfully unlinked entry ${entryId} from ${unlinkResult.totalUpdated} entries`
                    );

                    // Small delay to ensure updates are processed
                    await new Promise((resolve) => setTimeout(resolve, 2000));

                    // Verify entry is no longer linked
                    const recheckResult = await isEntryLinked(
                      target.environment,
                      entryId
                    );
                    if (recheckResult.isLinked) {
                      logger.error(
                        `❌ Entry ${entryId} is still linked after unlinking attempt - skipping deletion`
                      );
                      return; // Skip this entry
                    }
                  } else if (unlinkResult.errors.length > 0) {
                    logger.error(
                      `❌ Failed to unlink entry ${entryId} - skipping deletion. Errors: ${unlinkResult.errors.length}`
                    );
                    return; // Skip this entry
                  }
                }

                // Process each entry with retry - now safe to delete
                if (entry.isArchived && entry.isArchived()) {
                  await helpers.withRetry(
                    () => entry.unarchive(),
                    `unarchive_entry_${entry.sys.id}`
                  );
                  logger.info(`📤 Unarchived entry: ${entry.sys.id}`);
                }

                if (entry.isPublished && entry.isPublished()) {
                  await helpers.withRetry(
                    () => entry.unpublish(),
                    `unpublish_entry_${entry.sys.id}`
                  );
                  logger.info(`📤 Unpublished entry: ${entry.sys.id}`);
                }

                await helpers.withRetry(
                  () => entry.delete(),
                  `delete_entry_${entry.sys.id}`
                );

                logger.success(`🗑️  Deleted entry: ${entry.sys.id}`);
              } catch (err) {
                logger.error(`Failed to process entry: ${entry.sys.id}`, err);
              }
            })
          );

          // Wait between batches to avoid rate limiting
          await helpers.sleep(CONFIG.RATE_LIMIT_DELAY * 2);
          logger.info(
            `Processed ${Math.min(i + batchSize, entries.items.length)}/${
              entries.items.length
            } entries`
          );
        } // Delete the content type after all entries are deleted
        try {
          const ct = await helpers.withRetry(
            () => target.environment.getContentType(contentTypeId),
            `get_ct_for_deletion_${contentTypeId}`
          );

          if (ct.sys.publishedVersion) {
            await helpers.withRetry(
              () => ct.unpublish(),
              `unpublish_ct_${contentTypeId}`
            );
            logger.info(`Unpublished content type: ${contentTypeId}`);
            await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);
          }

          await helpers.withRetry(
            () => ct.delete(),
            `delete_ct_${contentTypeId}`
          );

          logger.success(`Deleted content type: ${contentTypeId}`);
        } catch (err) {
          logger.error(`Failed to delete content type: ${contentTypeId}`, err);
        }

        // Add delay between content types
        await helpers.sleep(CONFIG.RATE_LIMIT_DELAY * 2);
      } catch (err) {
        logger.error(
          `Error deleting entries or content type: ${contentTypeId}`,
          err
        );
      }
    }

    logger.success(`Completed deletion of ${typeIds.length} content type(s)`);
  } catch (err) {
    logger.error(`Error in bulk content type deletion process`, err);
  }
}

/**
 * Delete all content types and their entries in a space/environment.
 * Can be configured to only delete specific content types.
 *
 * @param {string} targetSpaceId - Target space ID
 * @param {string} targetEnvId - Target environment ID
 * @param {Array<string>} [contentTypeFilter] - Optional array of content type IDs to filter
 * @returns {Promise<void>}
 */
async function deleteAllEntriesAndContentType(
  targetSpaceId = CONFIG.TARGET_SPACE,
  targetEnvId = CONFIG.TARGET_ENV,
  contentTypeFilter = null
) {
  try {
    logger.info(
      `Starting bulk deletion process in ${targetSpaceId}/${targetEnvId}`
    );

    const target = await helpers.withRetry(
      () => helpers.getEnvironments(targetSpaceId, targetEnvId),
      "get_target_env_for_bulk_delete"
    );

    const contentTypes = await helpers.withRetry(
      () => target.environment.getContentTypes({ limit: 1000 }),
      "fetch_content_types_for_bulk_delete"
    );

    logger.info(`Found ${contentTypes.items.length} content types to process`);

    let processedCount = 0;
    let deletedCount = 0;

    for (const contentType of contentTypes.items) {
      processedCount++;

      // Apply filter if provided
      if (
        contentTypeFilter &&
        !contentTypeFilter.includes(contentType.sys.id)
      ) {
        logger.info(
          `Skipping content type: ${contentType.sys.id} (${processedCount}/${contentTypes.items.length})`
        );
        continue;
      }

      logger.info(
        `Processing content type: ${contentType.sys.id} (${processedCount}/${contentTypes.items.length})`
      );

      await deleteEntriesAndContentType(
        contentType.sys.id,
        targetSpaceId,
        targetEnvId
      );
      deletedCount++;

      // Wait to avoid rate limiting
      await helpers.sleep(CONFIG.RATE_LIMIT_DELAY * 2);
    }

    logger.success(
      `Bulk deletion completed. Deleted ${deletedCount}/${contentTypes.items.length} content types`
    );
  } catch (err) {
    logger.error(`Error during bulk deletion process`, err);
  }
}

/**
 * Updates a field ID in a content type.
 * This creates a new field with the new ID and marks the old field as omitted.
 *
 * @param {string} contentTypeId - Content type ID
 * @param {string} oldFieldId - Old field ID to replace
 * @param {string} newFieldId - New field ID
 * @param {string} targetSpaceId - Target space ID
 * @param {string} targetEnvId - Target environment ID
 * @returns {Promise<void>}
 */
async function updateFieldId(
  contentTypeId,
  oldFieldId = "oldFieldId",
  newFieldId = "newFieldId",
  targetSpaceId = CONFIG.TARGET_SPACE,
  targetEnvId = CONFIG.TARGET_ENV
) {
  try {
    logger.info(
      `Updating field ID from "${oldFieldId}" to "${newFieldId}" in content type: ${contentTypeId}`
    );

    const target = await helpers.withRetry(
      () => helpers.getEnvironments(targetSpaceId, targetEnvId),
      `get_target_env_for_field_update_${contentTypeId}`
    );

    // Fetch the content type
    const contentType = await helpers.withRetry(
      () => target.environment.getContentType(contentTypeId),
      `get_ct_for_field_update_${contentTypeId}`
    );

    // Find the field to update
    const field = contentType.fields.find((f) => f.id === oldFieldId);
    if (!field) {
      logger.error(
        `Field with ID "${oldFieldId}" not found in content type "${contentTypeId}"`
      );
      return;
    }

    // Omit the old field
    field.omitted = true;

    // Add the new field (clone the old field, but with new ID and not omitted)
    const newField = { ...field, id: newFieldId, omitted: false };
    contentType.fields.push(newField);

    await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);

    // Update the content type with retry
    const updatedContentType = await helpers.withRetry(
      () => contentType.update(),
      `update_ct_with_field_id_change_${contentTypeId}`
    );

    await helpers.sleep(CONFIG.RATE_LIMIT_DELAY);

    // Always fetch the latest version before publishing
    const freshCT = await helpers.withRetry(
      () => target.environment.getContentType(updatedContentType.sys.id),
      `get_fresh_ct_for_field_update_${contentTypeId}`
    );

    // Publish with retry on rate limit
    await helpers.withRetry(
      () => freshCT.publish(),
      `publish_ct_with_field_id_change_${contentTypeId}`
    );

    logger.success(
      `Updated field ID in content type "${contentTypeId}" from "${oldFieldId}" to "${newFieldId}"`
    );
  } catch (err) {
    logger.error(
      `Error updating field ID in content type ${contentTypeId}`,
      err
    );
  }
}

if (require.main === module) {
  const [, , cmd, ...args] = process.argv;

  // Display help information
  function showHelp() {
    logger.info(`
            Contentful Management Script - Available Commands:
            -------------------------------------------------
            sync               - Sync content types from source to target environment
            sync-locale        - Sync locales from source to target environment
            delete-omitted     - Delete omitted fields from content types
            delete-duplicates  - Delete duplicate content types
            delete-content-entries [contentTypeIds...] - Delete entries and content types (space-separated list)
            delete-all-content - Delete all content types and their entries
            update-field-id [contentTypeId] [oldFieldId] [newFieldId] - Update field ID in a content type
            help               - Show this help information

            Example: node cf-contentType.js sync
        `);
  }

  // Process commands
  (async () => {
    try {
      switch (cmd) {
        case "sync":
          await syncContentTypes();
          break;
        case "migrate-content-type":
          await migrateSingleContentType("pgDataLayer");
          break;

        case "delete-omitted":
          await deleteOmittedFieldsFromContentTypes();
          break;

        case "delete-duplicates":
          await deleteDuplicateContentTypes();
          break;
        case "delete-content-entries":
          const contentTypeIds =
            args.length > 0
              ? args
              : [
                  "landingHeader",
                  "featuredContent",
                  "additionalProductDescription",
                  "articleListGeneral",
                  "articleListItem",
                  "brandList",
                  "brandListItem",
                ]; // Default if no args provided
          logger.info(
            `Deleting entries for content type(s): ${contentTypeIds.join(", ")}`
          );
          await deleteEntriesAndContentType(contentTypeIds);
          break;

        case "delete-all-content":
          const filter = args.length > 0 ? args : null;
          if (filter) {
            logger.info(`Deleting content with filter: ${filter.join(", ")}`);
          }
          await deleteAllEntriesAndContentType(
            CONFIG.TARGET_SPACE,
            CONFIG.TARGET_ENV,
            filter
          );
          break;

        case "sync-locale":
          await syncLocales();
          break;

        case "update-field-id":
          const ctId = args[0] || "seoHead";
          const oldId = args[1] || "deDeHrefLang";
          const newId = args[2] || "enGBHrefLang";
          await updateFieldId(ctId, oldId, newId);
          break;

        case "help":
          showHelp();
          break;

        default:
          logger.error(`Unknown command: ${cmd}`);
          showHelp();
          break;
      }
    } catch (err) {
      logger.error(`Command execution failed: ${cmd}`, err);
      process.exit(1);
    }
  })();
}
