/**
 * Simple Contentful Entries Retriever
 *
 * A focused script that retrieves all entries of a specified content type from Contentful
 * and exports them as a complete JSON file.
 */

const contentful = require("contentful-management");
const fs = require("fs");
require("dotenv").config();

// Simplified configuration
const CONFIG = {
  ACCESS_TOKEN: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  SPACE_ID: process.env.SPACE_ID_FR_FR,
  ENVIRONMENT: "main-website-redesign", // Can be changed to any environment
  CONTENT_TYPE_ID: "seoHead", // Set your content type ID here
};

// Initialize the Contentful client
const client = contentful.createClient({
  accessToken: CONFIG.ACCESS_TOKEN,
});

/**
 * Simple function to get all entries of a specific content type
 * @param {string} contentTypeId - The ID of the content type to fetch
 * @returns {Promise<Array>} - Array of entries
 */
async function getEntriesByContentType(contentTypeId) {
  try {
    // Connect to Contentful
    console.log("Connecting to Contentful...");
    const space = await client.getSpace(CONFIG.SPACE_ID);
    const environment = await space.getEnvironment(CONFIG.ENVIRONMENT);

    console.log(`Fetching entries of content type: ${contentTypeId}...`); // Use pagination to get all entries
    let allEntries = [];
    let skip = 0;
    let hasMoreEntries = true;
    const limit = 1000; // Increased limit to 1000 entries per request

    while (hasMoreEntries) {
      // Get batch of entries
      const response = await environment.getEntries({
        content_type: contentTypeId,
        limit,
        skip,
      });

      // Add to collection
      allEntries = allEntries.concat(response.items);
      console.log(
        `Fetched ${response.items.length} entries. Total: ${allEntries.length}`
      );

      // Check if we need to continue pagination
      skip += limit;
      hasMoreEntries = response.total > skip;
    }

    console.log(
      `Successfully retrieved ${allEntries.length} entries of type '${contentTypeId}'`
    );
    return allEntries;
  } catch (error) {
    console.error("Error fetching entries:", error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  // Get content type ID from command line
  const contentTypeId = CONFIG.CONTENT_TYPE_ID || "page";

  if (!CONFIG.ACCESS_TOKEN || !CONFIG.SPACE_ID) {
    console.error(
      "Missing required environment variables. Check your .env file."
    );
    console.log("Required: CONTENTFUL_MANAGEMENT_TOKEN, SPACE_ID_FR_FR");
    process.exit(1);
  }
  try {
    const entries = await getEntriesByContentType(contentTypeId);

    // Generate filename with content type and timestamp
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const outputFilename = `${contentTypeId}-entries-${timestamp}.json`;

    console.log(`=== Exporting Entries to JSON ===`);
    console.log(`Content Type: ${contentTypeId}`);
    console.log(`Total Entries: ${entries.length}`);

    // Save all entries to JSON file
    fs.writeFileSync(outputFilename, JSON.stringify(entries, null, 2));
    console.log(`\nEntries successfully exported to: ${outputFilename}`);

    // Optional: Display titles of first 3 entries as examples
    if (entries.length > 0) {
      console.log("\nSample entries (first 3):");
      entries.slice(0, 3).forEach((entry, index) => {
        const title = entry.fields.title
          ? Object.values(entry.fields.title)[0]
          : "Untitled";
        console.log(`${index + 1}. ${title} (ID: ${entry.sys.id})`);
      });
    }
  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

// Run the script if executed directly
if (require.main === module) {
  main();
}

// Export the function for use in other scripts
module.exports = {
  getEntriesByContentType,
};
