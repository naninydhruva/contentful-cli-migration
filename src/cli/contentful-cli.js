const contentful = require("contentful-management");
const logger = require("../utils/logger");
const EntryDeletionProcessor = require("../utils/entry-deletion-processor");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Centralized configuration for all environments
const ALL_CONFIG = {
  "uk": {
    spaceId: process.env.SPACE_ID_EN_GB,
    environmentId: process.env.ENV_EN_GB,
    token: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  },
  "de": {
    spaceId: process.env.SPACE_ID_DE_DE,
    environmentId: process.env.ENV_DE_DE,
    token: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  },
  "fr": {
    spaceId: process.env.SPACE_ID_FR_FR,
    environmentId: process.env.ENV_FR_FR,
    token: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  },
  "mobile-app": {
    spaceId: process.env.MOBILE_APP_SPACE_ID,
    environmentId: process.env.MOBILE_APP_ENV,
    token: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  },
};

/**
 * A wrapper to retry a function with exponential backoff and timeout.
 * @param {Function} fn The async function to execute.
 * @param {number} maxRetries Maximum number of retries.
 * @param {number} timeoutMs Timeout in milliseconds.
 * @returns {Promise<any>}
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
 * Creates and returns a Contentful environment instance.
 * @param {string} context The key for the desired environment (e.g., 'source-gb').
 * @returns {Promise<import('contentful-management').Environment>}
 */
async function getContentfulEnvironment(context) {
  const config = ALL_CONFIG[context];
  if (!config || !config.spaceId || !config.environmentId || !config.token) {
    throw new Error(
      `Configuration for '${context}' is missing or incomplete. Check your .env file.`
    );
  }

  const client = contentful.createClient({ accessToken: config.token });
  const space = await client.getSpace(config.spaceId);
  return space.getEnvironment(config.environmentId);
}

/**
 * Fetch all entries/assets with pagination support
 * @param {import('contentful-management').Environment} environment
 * @param {string} type - "entries" or "assets"
 * @param {object} query - Query parameters
 * @returns {Promise<Array>} - All items
 */
async function fetchAllWithPagination(environment, type, query = {}) {
  // Validate inputs
  if (!environment) {
    throw new Error(
      `fetchAllWithPagination: environment parameter is required`
    );
  }

  if (!type || (type !== "entries" && type !== "assets")) {
    throw new Error(
      `fetchAllWithPagination: type must be "entries" or "assets", got: ${type}`
    );
  }

  const getMethod = type === "entries" ? "getEntries" : "getAssets";

  // Validate that the method exists on the environment
  if (typeof environment[getMethod] !== "function") {
    throw new Error(
      `fetchAllWithPagination: environment.${getMethod} is not a function`
    );
  }

  let allItems = [];
  let skip = 0;
  const limit = query.limit || 1000;
  let total = Infinity;
  while (skip < total) {
    try {
      const queryWithPagination = { ...query, limit, skip };
      logger.info(
        `Fetching ${type} (${skip}-${skip + limit}) out of ${
          total !== Infinity ? total : "unknown"
        }`
      );

      const response = await retryWithBackoff(() =>
        environment[getMethod](queryWithPagination)
      );

      // Validate response structure
      if (!response) {
        throw new Error(
          `fetchAllWithPagination: Received null/undefined response from ${getMethod}`
        );
      }

      if (typeof response.total !== "number") {
        throw new Error(
          `fetchAllWithPagination: response.total is not a number, got: ${typeof response.total} (${
            response.total
          })`
        );
      }

      if (!Array.isArray(response.items)) {
        throw new Error(
          `fetchAllWithPagination: response.items is not an array, got: ${typeof response.items}`
        );
      }

      if (total === Infinity) {
        total = response.total;
        logger.info(`Total ${type} found: ${total}`);
      }

      allItems = allItems.concat(response.items);
      skip += limit;

      // Small delay between requests to avoid rate limiting
      if (skip < total) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      logger.error(`Error fetching ${type} at skip ${skip}:`, error.message);
      logger.error(`Error details:`, {
        errorName: error.name,
        errorStack: error.stack,
        environmentType: typeof environment,
        getMethodType: typeof environment?.[getMethod],
      });
      throw error;
    }
  }

  logger.info(`Successfully fetched ${allItems.length} ${type}`);
  return allItems;
}

// --- Publishing Logic (from publish-content.js) ---

async function safeGetLink(environment, link) {
  try {
    // Validate link structure first
    if (!link || typeof link !== "object") {
      logger.warn("safeGetLink: Invalid link object provided");
      return null;
    }

    if (!link.sys || typeof link.sys !== "object") {
      logger.warn("safeGetLink: Link missing sys object");
      return null;
    }

    if (!link.sys.id || typeof link.sys.id !== "string") {
      logger.warn("safeGetLink: Link missing or invalid sys.id");
      return null;
    }

    if (
      !link.sys.linkType ||
      (link.sys.linkType !== "Entry" && link.sys.linkType !== "Asset")
    ) {
      logger.warn(
        `safeGetLink: Invalid or missing linkType: ${link.sys.linkType}`
      );
      return null;
    }

    // Attempt to fetch the linked resource using explicit method calls
    let resource;
    if (link.sys.linkType === "Entry") {
      resource = await retryWithBackoff(() =>
        environment.getEntry(link.sys.id)
      );
    } else if (link.sys.linkType === "Asset") {
      resource = await retryWithBackoff(() =>
        environment.getAsset(link.sys.id)
      );
    } else {
      throw new Error(`Invalid linkType: ${link.sys.linkType}`);
    }

    // Verify the resource exists and is valid
    if (!resource || !resource.sys || !resource.sys.id) {
      logger.warn(
        `safeGetLink: Retrieved ${link.sys.linkType} ${link.sys.id} is invalid`
      );
      return null;
    }

    return link;
  } catch (e) {
    const linkId = link?.sys?.id || "unknown";
    const linkType = link?.sys?.linkType || "unknown";

    if (e.name === "NotFound" || e.status === 404) {
      logger.warn(
        `🔗 Removing link to missing ${linkType}: ${linkId} (404 Not Found)`
      );
      return null;
    }

    // Handle other errors (rate limits, network issues, etc.)
    logger.error(`Error validating link ${linkType} ${linkId}:`, e.message);

    // For non-404 errors, we might want to keep the link and let it fail later
    // rather than removing potentially valid links due to temporary issues
    if (e.name === "RateLimitExceeded" || e.status === 429) {
      logger.warn(
        `Rate limit hit while validating link ${linkId}, keeping link`
      );
      return link;
    }

    // For validation errors (422), also remove the link as it's likely invalid
    if (e.status === 422) {
      logger.warn(
        `🔗 Removing link to invalid ${linkType}: ${linkId} (422 Validation Error)`
      );
      return null;
    }

    // For other errors, remove the link to be safe
    logger.warn(
      `🔗 Removing link to ${linkType}: ${linkId} due to error: ${e.message}`
    );
    return null;
  }
}

/**
 * Enhanced version of cleanEntryLinks that provides detailed information about what was cleaned
 * @param {import('contentful-management').Entry} entry - The entry to clean
 * @param {import('contentful-management').Environment} environment - The Contentful environment
 * @returns {Promise<{hasMissingLinks: boolean, removedLinksCount: number, removedEntryLinks: number, removedAssetLinks: number}>}
 */
async function cleanEntryLinksWithDetails(entry, environment) {
  const result = {
    hasMissingLinks: false,
    removedLinksCount: 0,
    removedEntryLinks: 0,
    removedAssetLinks: 0,
  };

  try {
    // Validate entry structure
    if (!entry || typeof entry !== "object") {
      logger.warn(
        "cleanEntryLinksWithDetails: Entry object is null, undefined, or not an object"
      );
      return result;
    }

    if (!entry.sys || typeof entry.sys !== "object") {
      logger.warn(
        "cleanEntryLinksWithDetails: Entry missing or invalid sys object"
      );
      return result;
    }

    if (!entry.sys.id || typeof entry.sys.id !== "string") {
      logger.warn(
        "cleanEntryLinksWithDetails: Entry missing or invalid sys.id"
      );
      return result;
    }

    const entryId = entry.sys.id;

    if (!entry.fields || typeof entry.fields !== "object") {
      logger.log(
        `cleanEntryLinksWithDetails: Entry ${entryId} has no fields object or invalid fields type`
      );
      return result;
    }

    const fields = entry.fields;

    // Safely get field keys
    let fieldKeys;
    try {
      fieldKeys = Object.keys(fields);
    } catch (fieldKeysError) {
      logger.error(
        `cleanEntryLinksWithDetails: Entry ${entryId} - Error accessing fields object: ${fieldKeysError.message}`
      );
      return result;
    }

    for (const fieldKey of fieldKeys) {
      try {
        const fieldData = fields[fieldKey];

        // Skip null or undefined field data
        if (!fieldData || typeof fieldData !== "object") {
          continue;
        }

        // Safely get locale keys
        let localeKeys;
        try {
          localeKeys = Object.keys(fieldData);
        } catch (localeError) {
          logger.warn(
            `cleanEntryLinksWithDetails: Entry ${entryId}, field ${fieldKey} - Error accessing locales: ${localeError.message}`
          );
          continue;
        }

        for (const locale of localeKeys) {
          try {
            // Safely access locale value
            if (!Object.prototype.hasOwnProperty.call(fieldData, locale)) {
              continue;
            }

            const value = fieldData[locale];

            // Skip null or undefined values
            if (value === null || value === undefined) {
              continue;
            }

            // Handle arrays of links
            if (Array.isArray(value)) {
              const cleaned = [];
              for (let i = 0; i < value.length; i++) {
                try {
                  const item = value[i];

                  // Check if item is a valid link object
                  if (
                    item &&
                    typeof item === "object" &&
                    item.sys &&
                    item.sys.type === "Link"
                  ) {
                    const validLink = await safeGetLink(environment, item);
                    if (validLink) {
                      cleaned.push(validLink);
                    } else {
                      result.hasMissingLinks = true;
                      result.removedLinksCount++;

                      if (item.sys.linkType === "Entry") {
                        result.removedEntryLinks++;
                      } else if (item.sys.linkType === "Asset") {
                        result.removedAssetLinks++;
                      }

                      logger.log(
                        `cleanEntryLinksWithDetails: Entry ${entryId}, field ${fieldKey}, locale ${locale} - Removed broken ${item.sys.linkType} link at index ${i} (ID: ${item.sys.id})`
                      );
                    }
                  } else if (item !== null && item !== undefined) {
                    // Keep non-link items as they are
                    cleaned.push(item);
                  }
                } catch (itemError) {
                  logger.warn(
                    `cleanEntryLinksWithDetails: Entry ${entryId}, field ${fieldKey}, locale ${locale}, item ${i} - Error processing array item: ${itemError.message}`
                  );
                  continue;
                }
              }

              // Update the field with cleaned array
              fields[fieldKey][locale] = cleaned;
            } else if (
              value &&
              typeof value === "object" &&
              value.sys &&
              value.sys.type === "Link"
            ) {
              // Handle single link objects
              try {
                const validLink = await safeGetLink(environment, value);
                if (!validLink) {
                  fields[fieldKey][locale] = null;
                  result.hasMissingLinks = true;
                  result.removedLinksCount++;

                  if (value.sys.linkType === "Entry") {
                    result.removedEntryLinks++;
                  } else if (value.sys.linkType === "Asset") {
                    result.removedAssetLinks++;
                  }

                  logger.log(
                    `cleanEntryLinksWithDetails: Entry ${entryId}, field ${fieldKey}, locale ${locale} - Removed broken ${value.sys.linkType} link (ID: ${value.sys.id})`
                  );
                }
              } catch (linkError) {
                logger.warn(
                  `cleanEntryLinksWithDetails: Entry ${entryId}, field ${fieldKey}, locale ${locale} - Error validating link: ${linkError.message}`
                );
                // Set to null to be safe
                fields[fieldKey][locale] = null;
                result.hasMissingLinks = true;
                result.removedLinksCount++;
              }
            }
            // For other value types (strings, numbers, objects without sys.type="Link"), leave them as is
          } catch (valueError) {
            logger.warn(
              `cleanEntryLinksWithDetails: Entry ${entryId}, field ${fieldKey}, locale ${locale} - Error processing value: ${valueError.message}`
            );
            continue;
          }
        }
      } catch (fieldError) {
        logger.warn(
          `cleanEntryLinksWithDetails: Entry ${entryId}, field ${fieldKey} - Error processing field: ${fieldError.message}`
        );
        continue;
      }
    }

    return result;
  } catch (error) {
    const entryId = entry?.sys?.id || "unknown";
    logger.error(
      `cleanEntryLinksWithDetails: Unexpected error processing entry ${entryId}: ${error.message}`
    );
    return result;
  }
}

function isChanged(entity) {
  return (
    !!entity.sys.publishedVersion &&
    entity.sys.version >= entity.sys.publishedVersion + 2
  );
}

/**
 * Check if an entry has meaningful data (non-empty fields) with detailed locale and field analysis
 * Handles locale-oriented field structure from Contentful Management API
 * @param {import('contentful-management').Entry} entry - The entry to check
 * @param {boolean} returnDetails - If true, returns detailed analysis instead of just boolean
 * @returns {boolean|object} - True if entry has data, false if empty, or detailed object if returnDetails=true
 */
function hasEntryData(entry, returnDetails = false) {
  const details = {
    hasData: false,
    entryId: null,
    contentType: null,
    totalFields: 0,
    fieldsWithData: 0,
    emptyFields: 0,
    localeAnalysis: {},
    fieldAnalysis: {},
    errors: [],
  };

  try {
    // Validate entry object structure
    if (!entry || typeof entry !== "object") {
      const error = "Entry object is null, undefined, or not an object";
      logger.warn(`hasEntryData: ${error}`);
      if (returnDetails) {
        details.errors.push(error);
        return details;
      }
      return false;
    }

    if (!entry.sys || typeof entry.sys !== "object") {
      const error = "Entry missing or invalid sys object";
      logger.warn(`hasEntryData: ${error}`);
      if (returnDetails) {
        details.errors.push(error);
        return details;
      }
      return false;
    }

    if (!entry.sys.id || typeof entry.sys.id !== "string") {
      const error = "Entry missing or invalid sys.id";
      logger.warn(`hasEntryData: ${error}`);
      if (returnDetails) {
        details.errors.push(error);
        return details;
      }
      return false;
    }

    const entryId = entry.sys.id;
    details.entryId = entryId;
    details.contentType = entry.sys.contentType?.sys?.id || "unknown";

    if (!entry.fields || typeof entry.fields !== "object") {
      const error = `Entry ${entryId} has no fields object or invalid fields type`;
      logger.log(error);
      if (returnDetails) {
        details.errors.push(error);
        return details;
      }
      return false;
    }

    // Safely get field keys
    let fieldKeys;
    try {
      fieldKeys = Object.keys(entry.fields);
      details.totalFields = fieldKeys.length;
    } catch (fieldKeysError) {
      const error = `Entry ${entryId}: Error accessing fields object - ${fieldKeysError.message}`;
      logger.error(error);
      if (returnDetails) {
        details.errors.push(error);
        return details;
      }
      return false;
    }

    if (fieldKeys.length === 0) {
      const error = `Entry ${entryId} has no fields`;
      logger.log(error);
      if (returnDetails) {
        details.errors.push(error);
        return details;
      }
      return false;
    }

    let hasAnyMeaningfulData = false;
    const localeDataCount = {};

    // Check if any field has meaningful content
    for (const fieldKey of fieldKeys) {
      try {
        const fieldData = entry.fields[fieldKey];
        const fieldAnalysis = {
          hasData: false,
          locales: {},
          dataTypes: new Set(),
          errors: [],
        };

        // Enhanced validation for field data
        if (fieldData === null || fieldData === undefined) {
          fieldAnalysis.errors.push("Field data is null or undefined");
          details.fieldAnalysis[fieldKey] = fieldAnalysis;
          details.emptyFields++;
          continue;
        }

        // Field data should be an object containing locale keys
        if (typeof fieldData !== "object") {
          const error = `Field data is not an object (${typeof fieldData})`;
          logger.warn(`Entry ${entryId}, field ${fieldKey}: ${error}`);
          fieldAnalysis.errors.push(error);
          details.fieldAnalysis[fieldKey] = fieldAnalysis;
          details.emptyFields++;
          continue;
        }

        // Safely get locale keys
        let localeKeys;
        try {
          localeKeys = Object.keys(fieldData);
        } catch (localeError) {
          const error = `Error accessing locales - ${localeError.message}`;
          logger.warn(`Entry ${entryId}, field ${fieldKey}: ${error}`);
          fieldAnalysis.errors.push(error);
          details.fieldAnalysis[fieldKey] = fieldAnalysis;
          details.emptyFields++;
          continue;
        }

        if (localeKeys.length === 0) {
          const error = "No locales found";
          logger.log(`Entry ${entryId}, field ${fieldKey}: ${error}`);
          fieldAnalysis.errors.push(error);
          details.fieldAnalysis[fieldKey] = fieldAnalysis;
          details.emptyFields++;
          continue;
        }

        let fieldHasData = false;

        // Check each locale for this field
        for (const locale of localeKeys) {
          try {
            // Initialize locale tracking
            if (!localeDataCount[locale]) {
              localeDataCount[locale] = { fieldsWithData: 0, totalFields: 0 };
            }
            localeDataCount[locale].totalFields++;

            // Additional safety check for locale access
            if (!Object.prototype.hasOwnProperty.call(fieldData, locale)) {
              const error = `Locale ${locale} not accessible`;
              logger.warn(`Entry ${entryId}, field ${fieldKey}: ${error}`);
              fieldAnalysis.locales[locale] = { hasData: false, error };
              continue;
            }

            const value = fieldData[locale];
            const localeAnalysis = {
              hasData: false,
              dataType: typeof value,
              isEmpty: false,
              isArray: Array.isArray(value),
              isObject:
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value),
              isLink: false,
              arrayLength: Array.isArray(value) ? value.length : 0,
              objectKeys:
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value)
                  ? Object.keys(value).length
                  : 0,
            };

            // Skip null, undefined, empty strings
            if (value === null || value === undefined || value === "") {
              localeAnalysis.isEmpty = true;
              fieldAnalysis.locales[locale] = localeAnalysis;
              continue;
            }

            // Skip empty arrays
            if (Array.isArray(value) && value.length === 0) {
              localeAnalysis.isEmpty = true;
              fieldAnalysis.locales[locale] = localeAnalysis;
              continue;
            }

            // Handle arrays of values (could be links or other data)
            if (Array.isArray(value) && value.length > 0) {
              fieldAnalysis.dataTypes.add("array");
              const hasValidArrayContent = value.some((item) => {
                if (item === null || item === undefined || item === "") {
                  return false;
                }
                // Check for valid link objects
                if (
                  typeof item === "object" &&
                  item.sys &&
                  item.sys.type === "Link" &&
                  item.sys.id
                ) {
                  localeAnalysis.isLink = true;
                  fieldAnalysis.dataTypes.add("link");
                  return true;
                }
                // Any other non-empty value
                if (typeof item === "string")
                  fieldAnalysis.dataTypes.add("string");
                else if (typeof item === "number")
                  fieldAnalysis.dataTypes.add("number");
                else if (typeof item === "boolean")
                  fieldAnalysis.dataTypes.add("boolean");
                else fieldAnalysis.dataTypes.add(typeof item);

                return item !== null && item !== undefined && item !== "";
              });

              if (hasValidArrayContent) {
                localeAnalysis.hasData = true;
                fieldHasData = true;
                hasAnyMeaningfulData = true;
                localeDataCount[locale].fieldsWithData++;
              }
              fieldAnalysis.locales[locale] = localeAnalysis;
              continue;
            }

            // Handle objects (including Link objects)
            if (
              typeof value === "object" &&
              value !== null &&
              !Array.isArray(value)
            ) {
              try {
                const objectKeys = Object.keys(value);

                if (objectKeys.length === 0) {
                  localeAnalysis.isEmpty = true;
                  fieldAnalysis.locales[locale] = localeAnalysis;
                  continue; // Skip empty objects
                }

                // Check for valid Link objects
                if (
                  value.sys &&
                  value.sys.type === "Link" &&
                  value.sys.id &&
                  value.sys.linkType
                ) {
                  localeAnalysis.hasData = true;
                  localeAnalysis.isLink = true;
                  fieldAnalysis.dataTypes.add("link");
                  fieldHasData = true;
                  hasAnyMeaningfulData = true;
                  localeDataCount[locale].fieldsWithData++;
                  fieldAnalysis.locales[locale] = localeAnalysis;
                  continue;
                }

                // Check for other meaningful object content
                const hasMeaningfulContent = objectKeys.some((objKey) => {
                  try {
                    const objValue = value[objKey];

                    if (
                      objValue === null ||
                      objValue === undefined ||
                      objValue === ""
                    ) {
                      return false;
                    }

                    // Handle nested objects
                    if (typeof objValue === "object" && objValue !== null) {
                      // Check for nested Link objects
                      if (
                        objValue.sys &&
                        objValue.sys.type === "Link" &&
                        objValue.sys.id
                      ) {
                        localeAnalysis.isLink = true;
                        fieldAnalysis.dataTypes.add("link");
                        return true;
                      }

                      // Check if nested object has content
                      try {
                        const nestedKeys = Object.keys(objValue);
                        return (
                          nestedKeys.length > 0 &&
                          nestedKeys.some((nestedKey) => {
                            try {
                              if (
                                !Object.prototype.hasOwnProperty.call(
                                  objValue,
                                  nestedKey
                                )
                              ) {
                                return false;
                              }

                              const nestedValue = objValue[nestedKey];
                              if (
                                nestedValue === null ||
                                nestedValue === undefined
                              ) {
                                return false;
                              }

                              if (
                                typeof nestedValue === "object" &&
                                nestedValue !== null
                              ) {
                                try {
                                  const nestedValueKeys =
                                    Object.keys(nestedValue);
                                  return (
                                    nestedValueKeys.length > 0 &&
                                    nestedValueKeys.some((key) => {
                                      try {
                                        const prop = nestedValue[key];
                                        return (
                                          prop !== null &&
                                          prop !== undefined &&
                                          prop !== ""
                                        );
                                      } catch (propError) {
                                        return false;
                                      }
                                    })
                                  );
                                } catch (nestedValueError) {
                                  logger.warn(
                                    `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error checking nested value properties - ${nestedValueError.message}`
                                  );
                                  return false;
                                }
                              }

                              return (
                                nestedValue !== null &&
                                nestedValue !== undefined &&
                                nestedValue !== ""
                              );
                            } catch (nestedKeyError) {
                              logger.warn(
                                `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error accessing nested key ${nestedKey} - ${nestedKeyError.message}`
                              );
                              return false;
                            }
                          })
                        );
                      } catch (nestedError) {
                        logger.warn(
                          `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error checking nested object - ${nestedError.message}`
                        );
                        return false;
                      }
                    }

                    // Any other non-empty value
                    fieldAnalysis.dataTypes.add(typeof objValue);
                    return true;
                  } catch (objPropertyError) {
                    logger.warn(
                      `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error checking object property ${objKey} - ${objPropertyError.message}`
                    );
                    return false;
                  }
                });

                if (hasMeaningfulContent) {
                  localeAnalysis.hasData = true;
                  fieldHasData = true;
                  hasAnyMeaningfulData = true;
                  localeDataCount[locale].fieldsWithData++;
                  fieldAnalysis.dataTypes.add("object");
                }
              } catch (objectError) {
                const error = `Error processing object - ${objectError.message}`;
                logger.warn(
                  `Entry ${entryId}, field ${fieldKey}, locale ${locale}: ${error}`
                );
                localeAnalysis.error = error;
              }
              fieldAnalysis.locales[locale] = localeAnalysis;
              continue;
            }

            // If we get here, we have meaningful primitive content (string, number, boolean, etc.)
            localeAnalysis.hasData = true;
            fieldHasData = true;
            hasAnyMeaningfulData = true;
            localeDataCount[locale].fieldsWithData++;
            fieldAnalysis.dataTypes.add(typeof value);
            fieldAnalysis.locales[locale] = localeAnalysis;
          } catch (valueError) {
            const error = `Error processing value - ${valueError.message}`;
            logger.warn(
              `Entry ${entryId}, field ${fieldKey}, locale ${locale}: ${error}`
            );
            fieldAnalysis.locales[locale] = { hasData: false, error };
          }
        }

        fieldAnalysis.hasData = fieldHasData;
        fieldAnalysis.dataTypes = Array.from(fieldAnalysis.dataTypes);
        details.fieldAnalysis[fieldKey] = fieldAnalysis;

        if (fieldHasData) {
          details.fieldsWithData++;
        } else {
          details.emptyFields++;
        }
      } catch (fieldError) {
        const error = `Error processing field - ${fieldError.message}`;
        logger.warn(`Entry ${entryId}, field ${fieldKey}: ${error}`);
        details.fieldAnalysis[fieldKey] = { hasData: false, error };
        details.emptyFields++;
      }
    }

    // Generate locale analysis summary
    for (const [locale, counts] of Object.entries(localeDataCount)) {
      details.localeAnalysis[locale] = {
        fieldsWithData: counts.fieldsWithData,
        totalFields: counts.totalFields,
        percentageWithData:
          counts.totalFields > 0
            ? Math.round((counts.fieldsWithData / counts.totalFields) * 100)
            : 0,
      };
    }

    details.hasData = hasAnyMeaningfulData;

    if (!hasAnyMeaningfulData) {
      logger.log(`Entry ${entryId} has no meaningful data in any field`);
    }

    return returnDetails ? details : hasAnyMeaningfulData;
  } catch (error) {
    const entryId = entry?.sys?.id || "unknown";
    const errorMsg = `Unexpected error processing entry ${entryId} - ${error.message}`;
    logger.error(`hasEntryData: ${errorMsg}`);

    if (returnDetails) {
      details.errors.push(errorMsg);
      return details;
    }

    // Return false on error to be safe (don't process potentially corrupted entries)
    return false;
  }
}

async function publishAssets(environment) {
  logger.info("Fetching assets to publish with pagination...");

  try {
    // Fetch all draft assets with pagination
    const draftAssets = await fetchAllWithPagination(environment, "assets", {
      "sys.publishedAt[exists]": false,
      "sys.archivedAt[exists]": false,
    });

    // Fetch all changed assets with pagination and filter directly
    const changedAssets = await fetchAllWithPagination(environment, "assets", {
      "sys.publishedAt[exists]": true,
      "sys.archivedAt[exists]": false,
    });

    // Filter changed assets that actually need republishing
    const changedAssetsNeedingUpdate = changedAssets.filter((asset) => {
      try {
        return isChanged(asset) && !asset.sys.archivedAt;
      } catch (error) {
        logger.warn(
          `Error checking if asset ${
            asset?.sys?.id || "unknown"
          } needs update:`,
          error.message
        );
        return false;
      }
    });

    logger.info(
      `Found ${changedAssetsNeedingUpdate.length} changed assets that need republishing`
    );

    // Consolidate all assets into a single array, avoiding duplicates
    const draftIds = new Set(draftAssets.map((a) => a.sys.id));
    const allAssetsToProcess = [...draftAssets];

    // Add changed assets that aren't already in drafts
    for (const asset of changedAssetsNeedingUpdate) {
      if (!draftIds.has(asset.sys.id)) {
        allAssetsToProcess.push(asset);
      }
    }

    // Filter out assets that don't need publishing
    const assetsToPublish = allAssetsToProcess.filter((asset) => {
      if (asset.sys.archivedAt) {
        logger.log(`Skipping archived asset ${asset.sys.id}`);
        return false;
      }
      if (
        asset.sys.publishedAt &&
        asset.sys.publishedVersion === asset.sys.version
      ) {
        logger.log(
          `Skipping already published asset ${asset.sys.id} (no changes)`
        );
        return false;
      }
      return true;
    });

    if (assetsToPublish.length === 0) {
      logger.info("No assets to publish.");
      return;
    }

    logger.info(
      `Found ${assetsToPublish.length} assets to publish using batch processing.`
    );

    // Process assets in batches for better performance
    const batchSize = 10;
    const batches = [];
    for (let i = 0; i < assetsToPublish.length; i += batchSize) {
      batches.push(assetsToPublish.slice(i, i + batchSize));
    }

    let successCount = 0;
    let errorCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      logger.info(
        `Processing batch ${batchIndex + 1}/${batches.length} (${
          batch.length
        } assets)...`
      );

      const batchPromises = batch.map(async (asset) => {
        try {
          if (!asset || !asset.sys || !asset.sys.id) {
            throw new Error("Invalid asset object");
          }
          await retryWithBackoff(() => asset.publish());
          logger.success(`Published asset ${asset.sys.id}`);
          return { success: true, asset };
        } catch (error) {
          return { success: false, asset, error };
        }
      });

      let batchResults;
      try {
        batchResults = await Promise.allSettled(batchPromises);
      } catch (promiseError) {
        logger.error(`Promise.allSettled failed: ${promiseError.message}`);
        errorCount += batchPromises.length;
        continue;
      }

      // Handle results and errors
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];

        if (!result) {
          logger.error(`Batch result at index ${i} is null or undefined`);
          errorCount++;
          continue;
        }

        if (
          result.status === "fulfilled" &&
          result.value &&
          result.value.success
        ) {
          successCount++;
        } else {
          errorCount++;
          const { asset, error } =
            result.status === "fulfilled" && result.value
              ? result.value
              : { asset: null, error: result.reason || "Unknown error" };

          if (asset && error) {
            // Check if this is a validation error
            if (
              error.status === 422 ||
              (error.message && error.message.includes("Validation error"))
            ) {
              const validationDetails =
                error.details && error.details.errors
                  ? error.details.errors
                      .map(
                        (e) =>
                          `${e.path ? e.path.join(".") : "unknown"}: ${
                            e.details || "unknown error"
                          }`
                      )
                      .join(", ")
                  : "Unknown validation error";

              logger.warn(
                `Asset ${
                  asset.sys ? asset.sys.id : "unknown"
                } has validation errors (${validationDetails}). Checking if it's linked before deletion...`
              );

              try {
                const assetId = asset.sys ? asset.sys.id : null;
                if (!assetId) {
                  logger.error(
                    "Cannot check asset links - asset ID is missing"
                  );
                  continue;
                }

                const linkResult = await isAssetLinked(environment, assetId);
                if (linkResult.isLinked) {
                  logger.warn(
                    `Asset ${assetId} is linked by other entries. Skipping deletion to preserve references.`
                  );
                  if (linkResult.linkedBy.length > 0) {
                    logger.info(
                      `Linked by: ${linkResult.linkedBy
                        .map((e) => `${e.id} (${e.contentType})`)
                        .join(", ")}`
                    );
                  }
                  logger.error(
                    `Asset ${assetId} has validation errors but cannot be deleted due to existing links. Manual intervention may be required.`
                  );
                } else {
                  logger.info(
                    `Asset ${assetId} is not linked. Proceeding with deletion...`
                  );

                  // Unpublish, unarchive, and delete
                  if (asset.isPublished && asset.isPublished()) {
                    await retryWithBackoff(() => asset.unpublish());
                    logger.log(`Unpublished asset ${assetId}`);
                  }
                  if (asset.isArchived && asset.isArchived()) {
                    await retryWithBackoff(() => asset.unarchive());
                    logger.log(`Unarchived asset ${assetId}`);
                  }
                  await retryWithBackoff(() => asset.delete());
                  logger.success(
                    `Deleted invalid asset ${assetId} due to validation errors (was not linked)`
                  );
                }
              } catch (deleteError) {
                logger.error(
                  `Failed to delete invalid asset ${assetId}:`,
                  deleteError?.message || "Unknown deletion error"
                );
              }
            } else {
              logger.error(
                `Failed to publish asset ${asset?.sys?.id || "unknown"}:`,
                error?.message || "Unknown error"
              );
            }
          } else {
            logger.error(
              "Asset processing failed - missing asset or error information"
            );
          }
        }
      }

      // Small delay between batches to avoid rate limiting
      if (batchIndex < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (successCount > 0) {
      logger.info(`Successfully published ${successCount} assets`);
    }
    if (errorCount > 0) {
      logger.warn(`Failed to publish ${errorCount} assets`);
    }
  } catch (error) {
    logger.error(`Fatal error in publishAssets: ${error.message}`);
    throw error;
  }
}

async function publishEntries(environment) {
  logger.info("Fetching entries to publish with pagination...");

  // Arrays to track validation errors and deletions for reporting
  const validationErrors = [];
  const deletedEntries = [];

  // Initialize entry deletion processor for mapping-based deletions
  const deletionProcessor = new EntryDeletionProcessor();
  const currentEnvironment = process.argv[3] || "unknown";

  try {
    // Validate environment parameter
    if (!environment) {
      throw new Error("publishEntries: environment parameter is required");
    }

    // Fetch all draft entries with pagination
    logger.info("Step 1: Fetching draft entries...");
    let draftEntries;
    try {
      draftEntries = await fetchAllWithPagination(environment, "entries", {
        "sys.publishedAt[exists]": false,
        "sys.archivedAt[exists]": false,
      });
      logger.info(`Successfully fetched ${draftEntries.length} draft entries`);
    } catch (draftError) {
      logger.error("Error fetching draft entries:", draftError.message);
      throw new Error(`Failed to fetch draft entries: ${draftError.message}`);
    }

    // Fetch all changed entries with pagination and filter directly
    logger.info("Step 2: Fetching changed entries...");
    let changedEntries;
    try {
      changedEntries = await fetchAllWithPagination(environment, "entries", {
        "sys.publishedAt[exists]": true,
        "sys.archivedAt[exists]": false,
      });
      logger.info(
        `Successfully fetched ${changedEntries.length} changed entries`
      );
    } catch (changedError) {
      logger.error("Error fetching changed entries:", changedError.message);
      throw new Error(
        `Failed to fetch changed entries: ${changedError.message}`
      );
    }

    // Filter changed entries that actually need republishing
    const changedEntriesNeedingUpdate = changedEntries.filter((entry) => {
      try {
        // Only include entries that have unpublished changes
        return isChanged(entry) && !entry.sys.archivedAt;
      } catch (error) {
        logger.warn(
          `Error checking if entry ${
            entry?.sys?.id || "unknown"
          } needs update:`,
          error.message
        );
        return false;
      }
    });

    logger.info(
      `Found ${changedEntriesNeedingUpdate.length} changed entries that need republishing`
    );

    // Consolidate all entries into a single array, avoiding duplicates
    const draftIds = new Set(draftEntries.map((e) => e.sys.id));
    const allEntriesToProcess = [...draftEntries];

    // Add changed entries that aren't already in drafts
    for (const entry of changedEntriesNeedingUpdate) {
      if (!draftIds.has(entry.sys.id)) {
        allEntriesToProcess.push(entry);
      }
    }

    logger.info(
      `Total entries to process: ${allEntriesToProcess.length} (${
        draftEntries.length
      } drafts + ${
        changedEntriesNeedingUpdate.length -
        (changedEntriesNeedingUpdate.length -
          (allEntriesToProcess.length - draftEntries.length))
      } changed)`
    ); // Process entries: validate, check data, and clean links
    logger.info(
      "Step 3: Processing entries, checking data, and cleaning links..."
    );

    // Step 3.1: Check for mapping-based deletions before processing for publishing
    logger.info("Step 3.1: Checking entries against deletion mapping rules...");
    let mappingBasedDeletions = [];
    try {
      mappingBasedDeletions = await deletionProcessor.processEntriesForDeletion(
        allEntriesToProcess,
        currentEnvironment,
        (entryId) => isEntryLinked(environment, entryId)
      );

      // Execute mapping-based deletions
      const toDelete = mappingBasedDeletions.filter(
        (candidate) => candidate.willDelete
      );
      if (toDelete.length > 0) {
        logger.info(
          `🗑️ Executing ${toDelete.length} mapping-based deletions...`
        );

        for (const candidate of toDelete) {
          try {
            const entry = candidate.entry;
            const entryId = entry.sys.id;

            logger.info(
              `Deleting entry ${entryId} (Rule: ${candidate.ruleName})`
            );

            // Unpublish, unarchive, and delete
            if (entry.isPublished && entry.isPublished()) {
              await retryWithBackoff(() => entry.unpublish());
              logger.log(`Unpublished entry ${entryId}`);
            }
            if (entry.isArchived && entry.isArchived()) {
              await retryWithBackoff(() => entry.unarchive());
              logger.log(`Unarchived entry ${entryId}`);
            }
            await retryWithBackoff(() => entry.delete());

            deletedEntries.push(entryId);
            logger.success(
              `🗑️ Deleted entry ${entryId} via mapping rule: ${candidate.reasons.join(
                ", "
              )}`
            );
          } catch (deleteError) {
            logger.error(
              `Failed to delete entry ${candidate.entry.sys.id}: ${deleteError.message}`
            );
          }
        }

        // Generate and save deletion report
        if (mappingBasedDeletions.length > 0) {
          const deletionReport = deletionProcessor.generateDeletionReport(
            mappingBasedDeletions,
            currentEnvironment
          );
          deletionProcessor.saveDeletionReport(
            deletionReport,
            currentEnvironment
          );
        }

        // Remove deleted entries from processing list
        const deletedIds = new Set(deletedEntries);
        const remainingEntries = allEntriesToProcess.filter(
          (entry) => !deletedIds.has(entry.sys.id)
        );
        logger.info(
          `📊 Removed ${
            allEntriesToProcess.length - remainingEntries.length
          } deleted entries from processing queue`
        );
        allEntriesToProcess.length = 0;
        allEntriesToProcess.push(...remainingEntries);
      } else {
        logger.info("✅ No entries match deletion mapping criteria");
      }
    } catch (mappingError) {
      logger.warn(
        `Failed to process mapping-based deletions: ${mappingError.message}`
      );
    }

    const entriesToPublish = [];
    let processedCount = 0;
    let skippedEmptyCount = 0;
    let skippedArchivedCount = 0;
    let skippedNoChangeCount = 0;
    let linkCleaningErrors = 0;

    for (const entry of allEntriesToProcess) {
      processedCount++;
      if (processedCount % 50 === 0) {
        logger.info(
          `Processing entry ${processedCount}/${allEntriesToProcess.length}...`
        );
      }

      // Validate entry object structure
      try {
        if (!entry || typeof entry !== "object") {
          logger.warn(`Skipping invalid entry at position ${processedCount}`);
          skippedEmptyCount++;
          continue;
        }

        if (!entry.sys || !entry.sys.id) {
          logger.warn(
            `Skipping entry without valid sys object at position ${processedCount}`
          );
          skippedEmptyCount++;
          continue;
        }

        const entryId = entry.sys.id;

        // Check entry status
        if (entry.sys.archivedAt) {
          logger.log(`Skipping archived entry ${entryId}`);
          skippedArchivedCount++;
          continue;
        }

        if (
          entry.sys.publishedAt &&
          !isChanged(entry) &&
          entry.sys.publishedVersion === entry.sys.version
        ) {
          logger.log(
            `Skipping already published entry ${entryId} (no changes)`
          );
          skippedNoChangeCount++;
          continue;
        } // Check if entry has meaningful data
        const entryDataAnalysis = hasEntryData(entry, true); // Get detailed analysis
        if (!entryDataAnalysis.hasData) {
          logger.warn(
            `Entry ${entryId} has no meaningful data - candidate for deletion`
          );

          // Check if this entry should be deleted based on deletion mapping or empty data policy
          try {
            logger.info(
              `🔍 Checking deletion policy for empty entry ${entryId}...`
            );

            // Check if entry is linked by other entries
            const linkResult = await isEntryLinked(environment, entryId);

            if (linkResult.isLinked) {
              logger.warn(
                `❌ Entry ${entryId} has no data but is linked by ${linkResult.linkedBy.length} other entries.`
              );
              logger.info(
                `🔗 Attempting to unlink entry ${entryId} from all references...`
              );

              // Attempt to unlink the entry from all references
              const unlinkResult = await unlinkEntryFromAllReferences(
                environment,
                entryId
              );

              if (unlinkResult.success && unlinkResult.totalUpdated > 0) {
                logger.success(
                  `✅ Successfully unlinked entry ${entryId} from ${unlinkResult.totalUpdated} entries`
                );

                // Small delay to ensure updates are processed
                await new Promise((resolve) => setTimeout(resolve, 2000));

                // Verify entry is no longer linked
                const recheckResult = await isEntryLinked(environment, entryId);
                if (!recheckResult.isLinked) {
                  logger.success(
                    `✅ Entry ${entryId} is now unlinked and can be safely deleted`
                  );

                  // Proceed with deletion
                  logger.info(`🗑️  Deleting empty entry ${entryId}...`);

                  // Unpublish, unarchive, and delete
                  if (entry.isPublished && entry.isPublished()) {
                    await retryWithBackoff(() => entry.unpublish());
                    logger.info(`Unpublished entry ${entryId}`);
                  }
                  if (entry.isArchived && entry.isArchived()) {
                    await retryWithBackoff(() => entry.unarchive());
                    logger.info(`Unarchived entry ${entryId}`);
                  }
                  await retryWithBackoff(() => entry.delete());

                  deletedEntries.push(entryId);
                  logger.success(
                    `🗑️  Deleted empty entry ${entryId} after unlinking from ${unlinkResult.totalUpdated} entries`
                  );

                  // Create detailed tracking for the validation report
                  const deletionDetails = extractValidationErrorDetails(
                    {
                      status: "empty-data-deletion",
                      details: {
                        errors: [
                          {
                            name: "EmptyDataDeletion",
                            details: `Entry had no meaningful data and was successfully unlinked from ${unlinkResult.totalUpdated} references`,
                            path: ["entry"],
                          },
                        ],
                      },
                    },
                    entryId
                  );
                  validationErrors.push(deletionDetails);

                  continue; // Skip to next entry
                } else {
                  logger.warn(
                    `⚠️  Entry ${entryId} still has ${recheckResult.linkedBy.length} references after unlinking attempt. Skipping deletion.`
                  );
                  if (recheckResult.linkedBy.length > 0) {
                    logger.info(
                      `Still linked by: ${recheckResult.linkedBy
                        .map((e) => `${e.id} (${e.contentType})`)
                        .join(", ")}`
                    );
                  }
                }
              } else {
                logger.error(
                  `Failed to unlink entry ${entryId}. Errors: ${unlinkResult.errors.length}`
                );
                if (unlinkResult.errors.length > 0) {
                  unlinkResult.errors.forEach((error) => {
                    logger.error(
                      `  - ${error.entryId || "Unknown"}: ${error.error}`
                    );
                  });
                }
              }
            } else {
              logger.info(
                `✅ Entry ${entryId} has no data and is not linked by other entries`
              );
              logger.info(`🗑️  Deleting empty entry ${entryId}...`);

              // Proceed with direct deletion since no unlinking is needed
              if (entry.isPublished && entry.isPublished()) {
                await retryWithBackoff(() => entry.unpublish());
                logger.info(`Unpublished entry ${entryId}`);
              }
              if (entry.isArchived && entry.isArchived()) {
                await retryWithBackoff(() => entry.unarchive());
                logger.info(`Unarchived entry ${entryId}`);
              }
              await retryWithBackoff(() => entry.delete());

              deletedEntries.push(entryId);
              logger.success(
                `🗑️  Deleted empty entry ${entryId} (was not linked)`
              );

              // Create detailed tracking for the validation report
              const deletionDetails = extractValidationErrorDetails(
                {
                  status: "empty-data-deletion",
                  details: {
                    errors: [
                      {
                        name: "EmptyDataDeletion",
                        details:
                          "Entry had no meaningful data and was not referenced by other entries",
                        path: ["entry"],
                      },
                    ],
                  },
                },
                entryId
              );
              validationErrors.push(deletionDetails);

              continue; // Skip to next entry
            }
          } catch (deletionError) {
            logger.error(
              `Failed to process empty entry ${entryId} for deletion: ${deletionError.message}`
            );
          }

          // If we reach here, the empty entry couldn't be deleted safely
          logger.warn(
            `Skipping empty entry ${entryId} - could not be safely deleted`
          );
          skippedEmptyCount++;
          continue;
        } // Clean links for the entry (remove non-existent linked entries/assets)
        try {
          logger.log(`Cleaning links for entry ${entryId}...`);
          const linkCleaningResult = await cleanEntryLinksWithDetails(
            entry,
            environment
          );

          if (linkCleaningResult.hasMissingLinks) {
            logger.info(
              `Entry ${entryId}: Found ${linkCleaningResult.removedLinksCount} broken links to remove`
            );

            if (linkCleaningResult.removedEntryLinks > 0) {
              logger.info(
                `  - Removed ${linkCleaningResult.removedEntryLinks} broken entry links`
              );
            }
            if (linkCleaningResult.removedAssetLinks > 0) {
              logger.info(
                `  - Removed ${linkCleaningResult.removedAssetLinks} broken asset links`
              );
            }

            try {
              // Update the entry with cleaned links
              logger.log(`Updating entry ${entryId} to save cleaned links...`);
              await retryWithBackoff(() => entry.update());
              logger.success(
                `Updated entry ${entryId} (removed ${linkCleaningResult.removedLinksCount} broken links)`
              );

              // Add delay after update to prevent rate limiting and ensure consistency
              await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (updateError) {
              logger.error(
                `Failed to update entry ${entryId} after cleaning links: ${updateError.message}`
              );

              // Check if this is a validation error that might prevent publishing
              if (updateError.status === 422) {
                logger.warn(
                  `Entry ${entryId} has validation errors after link cleaning. May need manual intervention.`
                );
              }

              // Continue anyway, but mark for potential issues
              linkCleaningErrors++;
            }
          } else {
            logger.log(`Entry ${entryId}: No broken links found`);
          }

          entriesToPublish.push(entry);
        } catch (linkError) {
          linkCleaningErrors++;
          logger.error(
            `Failed to clean links for entry ${entryId}: ${linkError.message}`
          );

          // Only add to publish list if the entry structure seems valid
          if (entry.sys && entry.sys.id) {
            logger.warn(
              `Adding entry ${entryId} to publish list despite link cleaning failure`
            );
            entriesToPublish.push(entry);
          } else {
            logger.error(`Skipping entry due to invalid structure`);
            skippedEmptyCount++;
          }
        }
      } catch (entryProcessingError) {
        const entryId = entry?.sys?.id || "unknown";
        logger.error(
          `Error processing entry ${entryId}: ${entryProcessingError.message}`
        );
        skippedEmptyCount++;
        continue;
      }
    }

    // Log processing summary
    logger.info(`=== Processing Summary ===`);
    logger.info(`Total entries processed: ${processedCount}`);
    logger.info(`Entries with no meaningful data: ${skippedEmptyCount}`);
    logger.info(`Archived entries skipped: ${skippedArchivedCount}`);
    logger.info(`Already published entries skipped: ${skippedNoChangeCount}`);
    logger.info(`Link cleaning errors: ${linkCleaningErrors}`);
    logger.info(`Entries ready to publish: ${entriesToPublish.length}`);

    if (entriesToPublish.length === 0) {
      logger.info("No entries to publish.");
      return;
    }

    // Publish entries in batches
    logger.info(
      `Step 4: Publishing ${entriesToPublish.length} entries using batch processing...`
    );
    const batchSize = 10;
    const batches = [];
    for (let i = 0; i < entriesToPublish.length; i += batchSize) {
      batches.push(entriesToPublish.slice(i, i + batchSize));
    }

    let successCount = 0;
    let errorCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      logger.info(
        `Processing batch ${batchIndex + 1}/${batches.length} (${
          batch.length
        } entries)...`
      );
      const batchPromises = batch.map(async (entry, index) => {
        try {
          if (!entry || !entry.sys || !entry.sys.id) {
            logger.error(
              `Invalid entry object at batch index ${index}:`,
              entry
            );
            throw new Error("Invalid entry object");
          }

          // Add small delay before publishing each entry to prevent rate limiting
          if (index > 0) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }

          await retryWithBackoff(() => entry.publish());
          logger.success(`Published entry ${entry.sys.id}`);
          return { success: true, entry };
        } catch (error) {
          logger.warn(
            `Failed to publish entry ${entry?.sys?.id || "unknown"}: ${
              error.message
            }`
          );
          return { success: false, entry, error };
        }
      });

      let batchResults;
      try {
        batchResults = await Promise.allSettled(batchPromises);
      } catch (promiseError) {
        logger.error(`Promise.allSettled failed: ${promiseError.message}`);
        errorCount += batchPromises.length;
        continue;
      }

      // Process batch results
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];

        if (!result) {
          logger.error(`Batch result at index ${i} is null or undefined`);
          errorCount++;
          continue;
        }

        if (
          result.status === "fulfilled" &&
          result.value &&
          result.value.success
        ) {
          successCount++;
        } else {
          errorCount++;
          const { entry, error } =
            result.status === "fulfilled" && result.value
              ? result.value
              : { entry: null, error: result.reason || "Unknown error" };
          if (entry && error) {
            // Handle validation errors with enhanced tracking and deletion logic
            if (
              error.status === 422 ||
              (error.message && error.message.includes("Validation error"))
            ) {
              const entryId = entry.sys ? entry.sys.id : "unknown";

              // Extract and track validation error details
              const validationErrorDetails = extractValidationErrorDetails(
                error,
                entryId
              );
              validationErrors.push(validationErrorDetails);

              const validationDetails =
                error.details && error.details.errors
                  ? error.details.errors
                      .map(
                        (e) =>
                          `${e.path ? e.path.join(".") : "unknown"}: ${
                            e.details || "unknown error"
                          }`
                      )
                      .join(", ")
                  : "Unknown validation error";

              logger.warn(
                `Entry ${entryId} has validation errors (${validationDetails})`
              );

              // Check if this is a missing required field error
              const isMissingRequired = isMissingRequiredFieldError(error);

              if (isMissingRequired) {
                logger.warn(
                  `🚨 Entry ${entryId} has missing required field(s). Will attempt deletion.`
                );

                try {
                  if (!entryId || entryId === "unknown") {
                    logger.error("Cannot delete entry - entry ID is missing");
                    continue;
                  }

                  // Check if entry is linked by other entries
                  const linkResult = await isEntryLinked(environment, entryId);
                  if (linkResult.isLinked) {
                    logger.warn(
                      `❌ Entry ${entryId} is linked by other entries. Cannot delete to preserve references.`
                    );
                    if (linkResult.linkedBy.length > 0) {
                      logger.info(
                        `Linked by: ${linkResult.linkedBy
                          .map((e) => `${e.id} (${e.contentType})`)
                          .join(", ")}`
                      );
                    }
                    logger.error(
                      `Entry ${entryId} has missing required fields but cannot be deleted due to existing links. Manual intervention required.`
                    );
                  } else {
                    logger.info(
                      `✅ Entry ${entryId} is not linked. Proceeding with deletion...`
                    );

                    // Unpublish, unarchive, and delete
                    if (entry.isPublished && entry.isPublished()) {
                      await retryWithBackoff(() => entry.unpublish());
                      logger.info(`Unpublished entry ${entryId}`);
                    }
                    if (entry.isArchived && entry.isArchived()) {
                      await retryWithBackoff(() => entry.unarchive());
                      logger.info(`Unarchived entry ${entryId}`);
                    }
                    await retryWithBackoff(() => entry.delete());

                    // Track successful deletion
                    deletedEntries.push(entryId);
                    logger.success(
                      `🗑️ Deleted entry ${entryId} due to missing required fields (was not linked)`
                    );
                  }
                } catch (deleteError) {
                  logger.error(
                    `Failed to delete entry with missing required fields ${entryId}:`,
                    deleteError?.message || "Unknown deletion error"
                  );
                }
              } else {
                logger.info(
                  `Entry ${entryId} has validation errors but not missing required fields. Skipping deletion.`
                );

                // Still try the existing link checking logic for other validation errors
                try {
                  const linkResult = await isEntryLinked(environment, entryId);
                  if (linkResult.isLinked) {
                    logger.warn(
                      `Entry ${entryId} is linked by other entries. Skipping deletion to preserve references.`
                    );
                  } else {
                    logger.info(
                      `Entry ${entryId} is not linked but validation error is not missing required fields. Skipping deletion.`
                    );
                  }
                } catch (linkCheckError) {
                  logger.warn(
                    `Failed to check links for entry ${entryId}: ${linkCheckError.message}`
                  );
                }
              }
            } else {
              logger.error(
                `Failed to publish entry ${entry?.sys?.id || "unknown"}:`,
                error?.message || "Unknown error"
              );
            }
          } else {
            logger.error(
              "Entry processing failed - missing entry or error information"
            );
          }
        }
      } // Smart delay between batches to avoid rate limiting
      // Increase delay if there were errors or if many entries had link cleaning
      if (batchIndex < batches.length - 1) {
        let delayMs = 1000; // Base delay

        // Increase delay if there were validation errors in this batch
        const batchErrorCount = batchResults.filter(
          (r) => r.status === "fulfilled" && r.value && !r.value.success
        ).length;

        if (batchErrorCount > 0) {
          delayMs = Math.min(delayMs + batchErrorCount * 500, 5000);
          logger.info(
            `Batch had ${batchErrorCount} errors, increasing delay to ${delayMs}ms`
          );
        }

        // Increase delay if we had many link cleaning operations
        if (linkCleaningErrors > 0) {
          delayMs = Math.min(delayMs + 500, 5000);
          logger.info(
            `Link cleaning operations detected, using delay of ${delayMs}ms`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } // Final summary
    if (successCount > 0) {
      logger.info(`Successfully published ${successCount} entries`);
    }
    if (errorCount > 0) {
      logger.warn(`Failed to publish ${errorCount} entries`);
    }

    // Generate validation report if there were any validation errors or deletions
    if (validationErrors.length > 0 || deletedEntries.length > 0) {
      logger.info("\n=== Validation Error Report ===");
      logger.info(`📊 Total validation errors: ${validationErrors.length}`);
      logger.info(`🗑️ Total entries deleted: ${deletedEntries.length}`);

      const missingRequiredCount = validationErrors.filter((e) =>
        e.errors.some((err) => err.isMissingRequired)
      ).length;
      logger.info(`🚨 Missing required field errors: ${missingRequiredCount}`);

      try {
        // Extract environment name from context or use default
        const envContext = process.argv[3] || "unknown";
        const reportPath = await createValidationReport(
          validationErrors,
          deletedEntries,
          envContext
        );
        logger.success(`📄 Detailed validation report created: ${reportPath}`);
      } catch (reportError) {
        logger.error(
          `Failed to create validation report: ${reportError.message}`
        );
      }
    } else {
      logger.info("✅ No validation errors or deletions to report");
    }
  } catch (error) {
    logger.error(`Fatal error in publishEntries: ${error.message}`);
    throw error;
  }
}

async function publishAll(environment) {
  logger.info("Starting complete publishing process...");

  // First, publish all assets
  logger.info("Step 1: Publishing assets...");
  await publishAssets(environment);

  // Wait for a delay before publishing entries
  const delaySeconds = 5;
  logger.info(
    `Step 2: Waiting ${delaySeconds} seconds before publishing entries...`
  );
  await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));

  // Then, publish all entries
  logger.info("Step 3: Publishing entries...");
  await publishEntries(environment);

  logger.success("Complete publishing process finished!");
}

// --- Generic Entity Processing (from entries-script.js) ---

/**
 * A generic function to perform actions on entries, assets, or content types.
 * @param {import('contentful-management').Environment} environment
 * @param {'Entry' | 'Asset' | 'ContentType'} entityType
 * @param {'delete' | 'unpublish' | 'archive'} action
 * @param {object} query The query to fetch entities.
 */
async function processEntities(
  environment,
  entityType,
  action,
  query = { limit: 1000 }
) {
  const getMethod = `get${entityType}s`;
  logger.info(`Fetching ${entityType}s with query: ${JSON.stringify(query)}`);
  const response = await retryWithBackoff(() => environment[getMethod](query));
  const items = response.items;

  if (items.length === 0) {
    logger.info(`No ${entityType}s found to ${action}.`);
    return;
  }

  logger.info(`Found ${items.length} ${entityType}s to ${action}.`);
  for (const item of items) {
    try {
      logger.info(`Processing ${entityType} ${item.sys.id}...`);

      if (action === "delete") {
        if (item.isPublished()) {
          await retryWithBackoff(() => item.unpublish());
          logger.info(`Unpublished ${entityType} ${item.sys.id}`);
        }
        if (item.isArchived && item.isArchived()) {
          await retryWithBackoff(() => item.unarchive());
          logger.info(`Unarchived ${entityType} ${item.sys.id}`);
        }
        await retryWithBackoff(() => item.delete());
        logger.success(`Deleted ${entityType} ${item.sys.id}`);
      } else if (action === "unpublish") {
        if (item.isPublished()) {
          await retryWithBackoff(() => item.unpublish());
          logger.success(`Unpublished ${entityType} ${item.sys.id}`);
        } else {
          logger.info(`${entityType} ${item.sys.id} is not published.`);
        }
      } else if (action === "archive") {
        if (item.isPublished()) {
          await retryWithBackoff(() => item.unpublish());
          logger.info(`Unpublished ${entityType} ${item.sys.id}`);
        }
        await retryWithBackoff(() => item.archive());
        logger.success(`Archived ${entityType} ${item.sys.id}`);
      }
    } catch (error) {
      logger.error(
        `Failed to ${action} ${entityType} ${item.sys.id}:`,
        error.message
      );
    }
  }
}

// --- Main CLI Execution ---

async function main() {
  const [command, context] = process.argv.slice(2);
  if (!command || !context) {
    logger.error("Usage: node contentful-cli.js <command> <environment>");
    logger.info(
      "Commands: publish, publish-assets-only, publish-entries-only, delete-drafts, delete-all-entries, delete-all-assets, unpublish-all-entries, archive-persona-data"
    );
    logger.info("Environments: always-uk, always-fr, mobile-app");
    process.exit(1);
  }

  try {
    logger.info(`Attempting to connect to environment: ${context}`);
    const environment = await getContentfulEnvironment(context);

    // Validate environment object
    if (!environment) {
      throw new Error("Failed to create environment - received null/undefined");
    }

    // Validate that environment has the required methods
    if (typeof environment.getEntries !== "function") {
      throw new Error("Environment object missing getEntries method");
    }

    if (typeof environment.getAssets !== "function") {
      throw new Error("Environment object missing getAssets method");
    }

    logger.info(
      `Successfully connected to space '${ALL_CONFIG[context].spaceId}' and environment '${context}'.`
    );
    logger.info(
      `Environment type: ${typeof environment}, has getEntries: ${typeof environment.getEntries}`
    );

    switch (command) {
      case "publish":
        await publishAll(environment);
        break;
      case "publish-assets-only":
        await publishAssets(environment);
        break;
      case "publish-entries-only":
        await publishEntries(environment);
        break;
      case "delete-drafts":
        await processEntities(environment, "Entry", "delete", {
          "sys.publishedAt[exists]": false,
        });
        break;
      case "delete-all-entries":
        await processEntities(environment, "Entry", "delete");
        break;
      case "delete-all-assets":
        await processEntities(environment, "Asset", "delete");
        break;
      case "delete-all-content-types":
        await processEntities(environment, "ContentType", "delete");
        break;
      case "unpublish-all-entries":
        await processEntities(environment, "Entry", "unpublish", {
          "sys.publishedAt[exists]": true,
        });
        break;
      case "archive-persona-data":
        await processEntities(environment, "Entry", "archive", {
          content_type: "personaData",
        });
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        process.exit(1);
    }
    logger.success("Operation completed successfully.");
  } catch (error) {
    logger.error(`A fatal error occurred: ${error.message}`);
    process.exit(1);
  }
}

// Only run main() if this file is executed directly (not when required as a module)
if (require.main === module) {
  main();
}

/**
 * Check if an asset is linked/referenced by any entries
 * @param {import('contentful-management').Environment} environment
 * @param {string} assetId - The asset ID to check
 * @returns {Promise<{isLinked: boolean, linkedBy: Array}>} - Returns link status and linking entries
 */
async function isAssetLinked(environment, assetId) {
  try {
    logger.info(`Checking if asset ${assetId} is linked by entries...`);

    // Search for entries that reference this asset
    const entries = await retryWithBackoff(() =>
      environment.getEntries({
        links_to_asset: assetId,
        limit: 10, // Get up to 10 linking entries for reporting
      })
    );

    const isLinked = entries.items.length > 0;
    const linkedBy = entries.items.map((entry) => ({
      id: entry.sys.id,
      contentType: entry.sys.contentType.sys.id,
      title: entry.fields.title || entry.fields.name || "No title",
    }));

    logger.info(
      `Asset ${assetId} ${isLinked ? "is" : "is not"} linked by ${
        entries.items.length
      } entries`
    );

    if (isLinked && entries.items.length > 0) {
      logger.info(
        `Linked by entries: ${linkedBy
          .map((e) => `${e.id} (${e.contentType})`)
          .join(", ")}`
      );
    }

    return { isLinked, linkedBy };
  } catch (error) {
    logger.error(`Error checking asset links for ${assetId}:`, error.message);
    // If we can't check, assume it's linked to be safe
    return { isLinked: true, linkedBy: [] };
  }
}

/**
 * Check if an entry is linked/referenced by any other entries
 * @param {import('contentful-management').Environment} environment
 * @param {string} entryId - The entry ID to check
 * @returns {Promise<{isLinked: boolean, linkedBy: Array}>} - Returns link status and linking entries
 */
async function isEntryLinked(environment, entryId) {
  try {
    logger.info(`Checking if entry ${entryId} is linked by other entries...`);

    // Search for entries that reference this entry
    const entries = await retryWithBackoff(() =>
      environment.getEntries({
        links_to_entry: entryId,
        limit: 10, // Get up to 10 linking entries for reporting
      })
    );

    const isLinked = entries.items.length > 0;
    const linkedBy = entries.items.map((entry) => ({
      id: entry.sys.id,
      contentType: entry.sys.contentType.sys.id,
      title: entry.fields.title || entry.fields.name || "No title",
    }));

    logger.info(
      `Entry ${entryId} ${isLinked ? "is" : "is not"} linked by ${
        entries.items.length
      } entries`
    );

    if (isLinked && entries.items.length > 0) {
      logger.info(
        `Linked by entries: ${linkedBy
          .map((e) => `${e.id} (${e.contentType})`)
          .join(", ")}`
      );
    }
    return { isLinked, linkedBy };
  } catch (error) {
    logger.error(`Error checking entry links for ${entryId}:`, error.message);
    // If we can't check, assume it's linked to be safe
    return { isLinked: true, linkedBy: [] };
  }
}

/**
 * Remove all links to a specific entry from other entries that reference it
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
        const removedLinks = [];

        logger.info(
          `🔍 Processing entry ${referencingEntryId} for links to ${entryId}...`
        );

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
        }

        // Update the entry if there were changes
        if (hasChanges) {
          try {
            logger.info(
              `💾 Updating entry ${referencingEntryId} to remove links...`
            );
            await retryWithBackoff(() => referencingEntry.update());

            result.unlinkedFrom.push({
              entryId: referencingEntryId,
              contentType: referencingEntry.sys.contentType.sys.id,
              removedLinks: removedLinks,
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
      logger.success(
        `🎉 Successfully unlinked entry ${entryId} from ${result.totalUpdated} entries`
      );
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

// --- Validation Error Tracking and Reporting ---

/**
 * Check if a validation error is due to missing required fields
 * @param {object} error - The error object from Contentful
 * @returns {boolean} - True if error is due to missing required fields
 */
function isMissingRequiredFieldError(error) {
  if (!error || !error.details || !error.details.errors) {
    return false;
  }

  return error.details.errors.some((err) => {
    const errorMessage = (err.details || "").toLowerCase();
    const errorName = (err.name || "").toLowerCase();

    return (
      errorMessage.includes("required") ||
      errorMessage.includes("mandatory") ||
      errorMessage.includes("must be present") ||
      errorMessage.includes("field is required") ||
      errorName.includes("required") ||
      errorName === "required"
    );
  });
}

/**
 * Extract validation error details for reporting
 * @param {object} error - The error object from Contentful
 * @param {string} entryId - The entry ID
 * @returns {object} - Formatted error details
 */
function extractValidationErrorDetails(error, entryId) {
  const details = {
    entryId,
    errorType: "validation",
    status: error.status || 422,
    timestamp: new Date().toISOString(),
    errors: [],
  };

  if (error.details && error.details.errors) {
    details.errors = error.details.errors.map((err) => ({
      field: err.path ? err.path.join(".") : "unknown",
      name: err.name || "unknown",
      details: err.details || "unknown error",
      isMissingRequired: isMissingRequiredFieldError({
        details: { errors: [err] },
      }),
    }));
  }

  return details;
}

/**
 * Create and save JSON report with validation errors and deletions
 * @param {Array} validationErrors - Array of validation error details
 * @param {Array} deletedEntries - Array of deleted entry IDs
 * @param {string} environment - Environment name
 */
async function createValidationReport(
  validationErrors,
  deletedEntries,
  environment
) {
  const report = {
    reportGenerated: new Date().toISOString(),
    environment: environment,
    summary: {
      totalValidationErrors: validationErrors.length,
      totalDeletedEntries: deletedEntries.length,
      missingRequiredFieldErrors: validationErrors.filter((e) =>
        e.errors.some((err) => err.isMissingRequired)
      ).length,
    },
    validationErrors: validationErrors,
    deletedEntries: deletedEntries.map((id) => ({
      entryId: id,
      deletedAt: new Date().toISOString(),
      reason: "422 validation error with missing required fields",
    })),
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `validation-report-${environment}-${timestamp}.json`;
  const filepath = path.join(process.cwd(), filename);

  try {
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    logger.info(`📄 Validation report saved to: ${filename}`);
    logger.info(
      `📊 Report summary: ${report.summary.totalValidationErrors} validation errors, ${report.summary.totalDeletedEntries} entries deleted`
    );
    return filepath;
  } catch (writeError) {
    logger.error(`Failed to save validation report: ${writeError.message}`);
    throw writeError;
  }
}

// Export the function for use by other modules
module.exports = { getContentfulEnvironment };
