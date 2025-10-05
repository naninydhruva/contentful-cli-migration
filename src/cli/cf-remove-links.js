// Removes all references/links to a given entry ID in Contentful
// Usage: node cf-remove-links.js <configPath>

const contentful = require("contentful-management");
const fs = require("fs");
require("dotenv").config();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeEntryLinks(spaceId, accessToken, environmentId, entryId) {
  try {
    const client = contentful.createClient({ accessToken });
    const space = await client.getSpace(spaceId);
    const environment = await space.getEnvironment(environmentId);

    // Search for entries that reference the given entryId
    const entries = await environment.getEntries({
      links_to_entry: entryId,
      limit: 1000, // adjust as needed
    });

    if (!entries.items.length) {
      console.log(`No entries found referencing entryId: ${entryId}`);
      return;
    }

    for (const entry of entries.items) {
      let updated = false;
      for (const fieldKey of Object.keys(entry.fields)) {
        for (const locale of Object.keys(entry.fields[fieldKey])) {
          const value = entry.fields[fieldKey][locale];
          // Remove links in arrays or single link fields
          if (Array.isArray(value)) {
            const filtered = value.filter(
              (v) =>
                !(v && v.sys && v.sys.type === "Link" && v.sys.id === entryId)
            );
            if (filtered.length !== value.length) {
              entry.fields[fieldKey][locale] = filtered;
              updated = true;
            }
          } else if (
            value &&
            value.sys &&
            value.sys.type === "Link" &&
            value.sys.id === entryId
          ) {
            entry.fields[fieldKey][locale] = null;
            updated = true;
          }
        }
      }
      if (updated) {
        try {
          await entry.update();
          // Add delay to ensure update is processed
          await sleep(1000);
          // Fetch the latest version of the entry before publishing
          const latestEntry = await environment.getEntry(entry.sys.id);
          await latestEntry.publish();
          await sleep(1000);
          console.log(`Removed link from entry ${entry.sys.id}`);
        } catch (err) {
          console.error(
            `Error updating/publishing entry ${entry.sys.id}:`,
            err.message
          );
        }
      } else {
        console.log(`No link found in entry ${entry.sys.id}`);
      }
    }
    console.log("Link removal complete.");
  } catch (error) {
    console.error("Error during link removal:", error.message);
  }
}

const CONFIG = {
  // Contentful credentials from environment variables
  ACCESS_TOKEN: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  SPACE_ID: process.env.SPACE_ID_FR_FR,
  ENVIRONMENT_ID: process.env.ENV_FR_FR,
  ENTRY_ID: "5aa4mNskxpArBdKJksOcKK",
  // Processing configuration - Optimized for higher throughput
  RETRY_ATTEMPTS: 7, // Increased from 5 to handle more rate limit scenarios
  RETRY_DELAY: 2000, // Reduced from 5000ms to 2000ms for faster recovery
  RATE_LIMIT_DELAY: 2000, // Reduced from 5000ms to 1000ms for better throughput
  BATCH_SIZE: 50, // Reduced from 100 to 50 for more manageable concurrent load
  MAX_ENTRIES: 7000,

  // Bulk operation settings
  DRY_RUN: false,
  PUBLISH_AFTER_UPDATE: true,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
};
removeEntryLinks(
  CONFIG.SPACE_ID,
  CONFIG.ACCESS_TOKEN,
  CONFIG.ENVIRONMENT_ID,
  CONFIG.ENTRY_ID
);
