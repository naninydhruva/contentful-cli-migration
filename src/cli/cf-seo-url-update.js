const fs = require("fs");
const path = require("path");
require("dotenv").config();
const contentful = require("contentful-management");

// Load config
const configPath = path.join(
  __dirname,
  "../../config/content-type-mappings.json"
);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Environment variables
const SPACE_ID = config.spaceId || process.env.SPACE_ID_DE_DE;
const ACCESS_TOKEN =
  config.accessToken || process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const ENVIRONMENT_ID = config.environmentId || process.env.ENV_DE_DE;
const CONTENT_TYPE_ID = "seoHead";

if (!SPACE_ID || !ACCESS_TOKEN || !CONTENT_TYPE_ID) {
  console.error(
    "Missing required configuration: spaceId, accessToken, or contentTypeId."
  );
  process.exit(1);
}

// Helper: Replace accented letters with English equivalents
function replaceAccents(str) {
  if (!str) return str;
  // Normalize and remove diacritics
  let s = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Convert to lowercase
  s = s.toLowerCase();
  // Trim spaces
  s = s.trim();
  // Replace special characters except '/' and '-'
  s = s.replace(/[^a-z0-9\/-]+/g, "-");
  // Replace multiple consecutive '-' with single '-'
  s = s.replace(/-+/g, "-");
  // Remove '-' at start/end except if followed by '/'
  s = s.replace(/^-+/, "").replace(/-+$/, "");
  // Ensure starts with '/'
  if (!s.startsWith("/")) s = "/" + s;
  // Ensure ends with '/'
  if (!s.endsWith("/")) s += "/";
  return s;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeUpdateAndPublish(entry, env, maxRetries = 5) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const updatedEntry = await entry.update();
      console.log(`Updated entry ${entry.sys.id}`);
      await sleep(2000);
      const latestEntry = await env.getEntry(entry.sys.id);
      await latestEntry.publish();
      console.log(`Published entry ${entry.sys.id}`);
      return;
    } catch (err) {
      if (
        err.name === "RateLimitExceeded" ||
        (err.response && err.response.status === 429)
      ) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // exponential backoff, max 10s
        console.warn(
          `Rate limit hit for entry ${
            entry.sys.id
          }, retrying in ${delay}ms (attempt ${attempt + 1})...`
        );
        await sleep(delay);
        attempt++;
      } else {
        throw err;
      }
    }
  }
  throw new Error(
    `Failed to update/publish entry ${entry.sys.id} after ${maxRetries} retries due to rate limits.`
  );
}

async function updateEntries() {
  const client = contentful.createClient({
    accessToken: ACCESS_TOKEN,
  });
  const space = await client.getSpace(SPACE_ID);
  const env = await space.getEnvironment(ENVIRONMENT_ID);
  const entries = await env.getEntries({
    content_type: CONTENT_TYPE_ID,
    limit: 600,
  });

  console.log(`Found ${entries.items.length} entries to process.`);

  let count = 0;
  for (const entry of entries.items) {
    count++;
    let updated = false;
    console.log(
      `Processing entry ${count}/${entries.items.length} (ID: ${entry.sys.id})`
    );
    // Update url field
    if (entry.fields.url) {
      for (const locale of Object.keys(entry.fields.url)) {
        const original = entry.fields.url[locale];
        const replaced = replaceAccents(original);
        if (original !== replaced) {
          entry.fields.url[locale] = replaced;
          updated = true;
          console.log(
            `Updated url field for entry ${entry.sys.id} locale ${locale}: ${original} -> ${replaced}`
          );
        }
      }
    }

    // Resolve and update canonicalLinks reference entry's url field
    if (entry.fields.canonicalLinks) {
      for (const locale of Object.keys(entry.fields.canonicalLinks)) {
        const refs = entry.fields.canonicalLinks[locale];
        if (Array.isArray(refs)) {
          for (const ref of refs) {
            if (
              ref &&
              ref.sys &&
              ref.sys.type === "Link" &&
              ref.sys.linkType === "Entry"
            ) {
              const canonicalEntryId = ref.sys.id;
              try {
                const canonicalEntry = await env.getEntry(canonicalEntryId);
                console.log(
                  `Processing canonical entry  ${canonicalEntryId} for entry ${entry.sys.id}`
                );
                if (
                  canonicalEntry.fields.canonical &&
                  canonicalEntry.fields.canonical[locale]
                ) {
                  const original = canonicalEntry.fields.canonical[locale];
                  console.log(
                    `Processing canonical entry ${canonicalEntryId} for locale ${locale}`
                  );
                  const replaced = replaceAccents(original);
                  if (original !== replaced) {
                    canonicalEntry.fields.canonical[locale] = replaced;
                    await safeUpdateAndPublish(canonicalEntry, env);
                    console.log(
                      `Updated and published canonical entry ${canonicalEntryId} for locale ${locale}`
                    );
                  }
                }
              } catch (err) {
                console.error(
                  `Error updating canonical entry ${canonicalEntryId}:`,
                  err
                );
              }
            }
          }
        }
      }
      if (updated) {
        try {
          await safeUpdateAndPublish(entry, env);
        } catch (err) {
          console.error(
            `Error updating/publishing entry ${entry.sys.id}:`,
            err
          );
        }
      }
    }
    console.log(
      "URL and canonicalLink fields updated and published for all entries."
    );
  }
}
updateEntries().catch((err) => {
  console.error("Error updating entries:", err);
  process.exit(1);
});
