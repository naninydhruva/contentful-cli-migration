const contentful = require("contentful-management");
require("dotenv").config();
const logger = console; // Replace with your logger if needed

// Set up Contentful client
const sdkClient = contentful.createClient({
  accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
});

const SPACE_ID = process.env.MOBILE_APP_SPACE_ID;
const ENVIRONMENT_ID = process.env.MOBILE_APP_ENV;

const getPagesByType = async (type) => {
  if (!type) {
    logger.error("⛔ ERROR: Missing page type parameter");
    throw new Error("Missing page type parameter");
  }
  try {
    logger.info(`ℹ️ Fetching pages of type: ${type}...`);
    logger.info(
      `Using SPACE_ID: ${SPACE_ID}, ENVIRONMENT_ID: ${ENVIRONMENT_ID}`
    );
    const space = await sdkClient.getSpace(SPACE_ID);
    const env = await space.getEnvironment(ENVIRONMENT_ID);
    const resp = await env.getEntries({
      content_type: "page",
      include: 3,
      limit: 300,
      "fields.seoHead.sys.contentType.sys.id": "seoHead",
      "fields.seoHead.fields.pageType": type,
    });

    return resp;
  } catch (error) {
    logger.error(`⛔ ERROR: Failed to get pages by type '${type}':`, error);
    throw error;
  }
};

const getOptions = async () => {
  try {
    const space = await sdkClient.getSpace(SPACE_ID);
    const env = await space.getEnvironment(ENVIRONMENT_ID);
    const resp = await env.getEntries({
      content_type: "options",
      limit: 600,
    });
    return resp;
  } catch (error) {
    logger.error("⛔ ERROR: Failed to get product options:", error);
    throw error;
  }
};

const updateOptionsData = async () => {
  const optionsEntries = await getOptions();
  let total = optionsEntries.items.length;
  let processed = 0;
  for (const entry of optionsEntries.items) {
    // Only update if optionName does not exist or is empty (for all locales)
    let shouldUpdate = false;
    for (const locale of Object.keys(entry.fields.optionText || {})) {
      if (
        !entry.fields.optionName ||
        !entry.fields.optionName[locale] ||
        entry.fields.optionName[locale].trim() === ""
      ) {
        if (!entry.fields.optionName) entry.fields.optionName = {};
        entry.fields.optionName[locale] = entry.fields.optionText[locale];
        shouldUpdate = true;
      }
    }
    ++processed;
    if (shouldUpdate) {
      await entry.update();
      console.log(`Updated entry ID: ${entry.sys.id} (${processed}/${total})`);
      await sleep(1000); // To avoid hitting rate limits
      const space = await sdkClient.getSpace(SPACE_ID);
      const env = await space.getEnvironment(ENVIRONMENT_ID);
      const latestVersionEntry = await env.getEntry(entry.sys.id);
      await latestVersionEntry.publish();
      console.log(
        `Published entry ID: ${entry.sys.id} (${processed}/${total})`
      );
      await sleep(1000); // To avoid hitting rate limits
      continue;
    }
    console.log(`Skipped entry ID: ${entry.sys.id} (${processed}/${total})`);
  }
};

const updateProductData = async () => {
  const pages = await getPagesByType("product");
  for (const entry of pages.items) {
    const navigationName = entry.fields.navigationName;
    // For each items in fields.content[0], get entry of type productDetails or not
    if (entry.fields.content && Array.isArray(entry.fields.content["en-US"])) {
      const contentArr = entry.fields.content["en-US"];
      if (contentArr.length > 0) {
        const firstContent = contentArr[0];
        logger.info(`First content entry: ${JSON.stringify(firstContent)}`);
        if (
          firstContent &&
          firstContent.sys &&
          firstContent.sys.linkType === "Entry"
        ) {
          const space = await sdkClient.getSpace(SPACE_ID);
          const env = await space.getEnvironment(ENVIRONMENT_ID);
          const contentEntry = await env.getEntry(firstContent.sys.id);
          logger.info(`Content entry ID: ${contentEntry.sys.id}`);
          const isProductDetails =
            contentEntry.sys.contentType.sys.id === "productDetails";
          if (isProductDetails) {
            // update horizontal card Title in the contentEntry if missing with navigationName
            if (!contentEntry.fields.horizontalCardTitle) {
              contentEntry.fields.horizontalCardTitle = navigationName;
              logger.info(
                `Updated horizontal card Title for entry ID: ${contentEntry.sys.id}`
              );
            }
            contentEntry.update();
            new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
    }
  }
};

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

(async () => {
  await updateOptionsData();
})();
