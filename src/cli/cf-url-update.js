// Script to update a Contentful field by replacing non-English letters with English equivalents
// Usage: Set env variables ENV, SPACE, ACCESSTOKEN, CONTENTTYPE, FIELD

const contentful = require("contentful-management");
require("dotenv").config();

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
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
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

const env = process.env.ENV_DE_DE;
const spaceId = process.env.SPACE_ID_DE_DE;
const accessToken = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const contentType = "buttonLink";
const field = "url";

if (!env || !spaceId || !accessToken || !contentType || !field) {
  console.error(
    "Missing required environment variables: ENV, SPACE, ACCESSTOKEN, CONTENTTYPE, FIELD"
  );
  process.exit(1);
}

async function updateEntries() {
  const client = contentful.createClient({ accessToken });
  const space = await client.getSpace(spaceId);
  const environment = await space.getEnvironment(env);
  const entries = await environment.getEntries({
    content_type: contentType,
    limit: 600,
  });

  console.log(`Found ${entries.items.length} entries to process.`);
  let count = 0;

  for (const entry of entries.items) {
    count++;
    let updated = false;
    if (entry.fields[field]) {
      console.log(
        `Processing entry ${count}/${entries.items.length} (ID: ${entry.sys.id})\n`
      );
      for (const locale of Object.keys(entry.fields[field])) {
        console.log(`Processing entry ${entry.sys.id} locale ${locale}\n`);
        const original = entry.fields[field][locale];
        const replaced = replaceAccents(original);
        if (original !== replaced) {
          entry.fields[field][locale] = replaced;
          updated = true;
          console.log(
            `Updated field '${field}' for entry ${entry.sys.id} locale ${locale}: \n${original}\n -> ${replaced}`
          );
        } else {
          console.log(
            ` No changes for field '${field}' in entry ${entry.sys.id} locale ${locale}`
          );
        }
      }
    } else {
      console.log(`Field '${field}' not found in entry ${entry.sys.id}`);
    }
    if (updated) {
      try {
        await safeUpdateAndPublish(entry, environment);
      } catch (err) {
        console.error(`Error updating/publishing entry ${entry.sys.id}:`, err);
      }
    }
  }
  console.log(`Field '${field}' update complete for all entries.`);
}

updateEntries().catch((err) => {
  console.error("Error updating entries:", err);
  process.exit(1);
});
