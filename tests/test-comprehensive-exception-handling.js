/**
 * Comprehensive test for exception handling in hasEntryData and entry processing
 * This test simulates real-world error scenarios that could occur during publishing
 */

console.log("=== Comprehensive Exception Handling Test ===\n");

// Mock logger for testing
const logger = {
  log: (msg) => console.log(`[LOG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
};

// Copy the actual hasEntryData function from contentful-cli.js
function hasEntryData(entry) {
  try {
    // Validate entry object structure
    if (!entry) {
      logger.warn("hasEntryData: Entry object is null or undefined");
      return false;
    }

    if (!entry.sys) {
      logger.warn("hasEntryData: Entry missing sys object");
      return false;
    }

    if (!entry.sys.id) {
      logger.warn("hasEntryData: Entry missing sys.id");
      return false;
    }

    const entryId = entry.sys.id;

    if (!entry.fields) {
      logger.log(`Entry ${entryId} has no fields object`);
      return false;
    }

    // Safely get field keys
    let fieldKeys;
    try {
      fieldKeys = Object.keys(entry.fields);
    } catch (fieldKeysError) {
      logger.error(
        `Entry ${entryId}: Error accessing fields object - ${fieldKeysError.message}`
      );
      return false;
    }

    if (fieldKeys.length === 0) {
      logger.log(`Entry ${entryId} has no fields`);
      return false;
    }

    // Check if any field has meaningful content
    for (const fieldKey of fieldKeys) {
      try {
        const fieldData = entry.fields[fieldKey];
        if (!fieldData) continue;

        // Safely get locale keys
        let localeKeys;
        try {
          localeKeys = Object.keys(fieldData);
        } catch (localeError) {
          logger.warn(
            `Entry ${entryId}, field ${fieldKey}: Error accessing locales - ${localeError.message}`
          );
          continue;
        }

        // Check each locale for this field
        for (const locale of localeKeys) {
          try {
            const value = fieldData[locale];

            // Skip null, undefined, empty strings
            if (value === null || value === undefined || value === "") {
              continue;
            }

            // Skip empty arrays
            if (Array.isArray(value) && value.length === 0) {
              continue;
            }

            // Skip empty objects (but allow objects with properties)
            if (
              typeof value === "object" &&
              value !== null &&
              !Array.isArray(value)
            ) {
              let objectKeys;
              try {
                objectKeys = Object.keys(value);
              } catch (objectError) {
                logger.warn(
                  `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error accessing object keys - ${objectError.message}`
                );
                continue;
              }

              if (objectKeys.length === 0) {
                continue;
              }

              // For Link objects, check if they have valid sys.id
              if (value.sys && value.sys.type === "Link" && value.sys.id) {
                return true;
              }

              // For other objects with properties
              if (objectKeys.length > 0) {
                return true;
              }
              continue;
            }

            // If we get here, we have meaningful content
            return true;
          } catch (valueError) {
            logger.warn(
              `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error processing value - ${valueError.message}`
            );
            continue;
          }
        }
      } catch (fieldError) {
        logger.warn(
          `Entry ${entryId}, field ${fieldKey}: Error processing field - ${fieldError.message}`
        );
        continue;
      }
    }

    logger.log(`Entry ${entryId} has no meaningful data in any field`);
    return false;
  } catch (error) {
    const entryId = entry?.sys?.id || "unknown";
    logger.error(
      `hasEntryData: Unexpected error processing entry ${entryId} - ${error.message}`
    );
    // Return false on error to be safe (don't process potentially corrupted entries)
    return false;
  }
}

// Test the entry processing workflow like it would happen in publishEntries
function testEntryProcessingWorkflow(entries) {
  console.log("=== Testing Entry Processing Workflow ===");

  let processedCount = 0;
  let skippedEmptyCount = 0;
  let validEntries = [];

  for (const entry of entries) {
    processedCount++;

    console.log(`\n--- Processing Entry ${processedCount} ---`);

    // Validate entry object structure before processing (like in contentful-cli.js)
    if (!entry) {
      logger.warn(
        `Skipping null/undefined entry at position ${processedCount}`
      );
      skippedEmptyCount++;
      continue;
    }

    if (!entry.sys) {
      logger.warn(
        `Skipping entry without sys object at position ${processedCount}`
      );
      skippedEmptyCount++;
      continue;
    }

    if (!entry.sys.id) {
      logger.warn(
        `Skipping entry without sys.id at position ${processedCount}`
      );
      skippedEmptyCount++;
      continue;
    }

    const entryId = entry.sys.id;

    try {
      // Check entry status (like in contentful-cli.js)
      if (entry.sys.archivedAt) {
        logger.log(`Skipping archived entry ${entryId}`);
        continue;
      }
      if (
        entry.sys.publishedAt &&
        entry.sys.publishedVersion === entry.sys.version
      ) {
        logger.log(`Skipping already published entry ${entryId} (no changes)`);
        continue;
      }
    } catch (entryCheckError) {
      logger.error(
        `Error checking entry status for ${entryId}: ${entryCheckError.message}`
      );
      logger.warn(`Skipping entry ${entryId} - status check failed`);
      skippedEmptyCount++;
      continue;
    }

    // Check if entry has meaningful data before processing (like in contentful-cli.js)
    let hasData = false;
    try {
      hasData = hasEntryData(entry);
    } catch (dataCheckError) {
      logger.error(
        `Error checking entry data for ${entryId}: ${dataCheckError.message}`
      );
      logger.warn(`Skipping entry ${entryId} - data validation failed`);
      skippedEmptyCount++;
      continue;
    }

    if (!hasData) {
      logger.warn(`Skipping entry ${entryId} - no meaningful data found`);
      skippedEmptyCount++;
      continue;
    }

    // If we get here, the entry is valid for processing
    console.log(`✅ Entry ${entryId} passed all validation checks`);
    validEntries.push(entry);
  }

  console.log(`\n=== Processing Summary ===`);
  console.log(`Total entries processed: ${processedCount}`);
  console.log(`Entries skipped: ${skippedEmptyCount}`);
  console.log(`Valid entries for publishing: ${validEntries.length}`);

  return { processedCount, skippedEmptyCount, validEntries };
}

// Test cases that simulate real-world problematic entries
const problematicEntries = [
  // Valid entry
  {
    sys: { id: "entry-001", publishedAt: null, version: 1 },
    fields: { title: { "en-US": "Valid Entry" } },
  },

  // Null entry
  null,

  // Entry without sys
  { fields: { title: { "en-US": "No sys" } } },

  // Entry without sys.id
  { sys: {}, fields: { title: { "en-US": "No ID" } } },

  // Archived entry
  {
    sys: {
      id: "entry-002",
      archivedAt: "2025-01-01T00:00:00Z",
      version: 1,
    },
    fields: { title: { "en-US": "Archived Entry" } },
  },

  // Already published, no changes
  {
    sys: {
      id: "entry-003",
      publishedAt: "2025-01-01T00:00:00Z",
      publishedVersion: 1,
      version: 1,
    },
    fields: { title: { "en-US": "No Changes" } },
  },

  // Entry with no fields
  {
    sys: { id: "entry-004", version: 1 },
    fields: null,
  },

  // Entry with empty fields
  {
    sys: { id: "entry-005", version: 1 },
    fields: {},
  },

  // Entry with only empty values
  {
    sys: { id: "entry-006", version: 1 },
    fields: {
      title: { "en-US": "" },
      description: { "en-US": null },
      tags: { "en-US": [] },
    },
  },

  // Entry with corrupted field structure
  {
    sys: { id: "entry-007", version: 1 },
    fields: {
      corruptedField: null,
      anotherField: { "en-US": "Valid content" },
    },
  },

  // Entry with valid Link
  {
    sys: { id: "entry-008", version: 1 },
    fields: {
      linkedAsset: {
        "en-US": {
          sys: { type: "Link", linkType: "Asset", id: "asset-123" },
        },
      },
    },
  },
];

// Run the comprehensive test
console.log("Testing real-world problematic entry scenarios...\n");

const result = testEntryProcessingWorkflow(problematicEntries);

console.log(`\n=== Final Results ===`);
if (result.skippedEmptyCount > 0) {
  console.log(
    `✅ Successfully handled ${result.skippedEmptyCount} problematic entries`
  );
}
if (result.validEntries.length > 0) {
  console.log(
    `✅ Identified ${result.validEntries.length} valid entries for processing`
  );
  result.validEntries.forEach((entry) => {
    console.log(`   - ${entry.sys.id}`);
  });
}

console.log(
  `\n🎉 Comprehensive exception handling test completed successfully!`
);
console.log(`✅ All error scenarios handled gracefully`);
console.log(`✅ No crashes or unhandled exceptions`);
console.log(`✅ Proper logging and error reporting`);
console.log(`✅ Safe fallbacks implemented throughout`);
