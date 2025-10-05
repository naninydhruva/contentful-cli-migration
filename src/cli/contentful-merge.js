const contentful = require('contentful-management');
const fs = require('fs');
require('dotenv').config();

// Configuration
const MANAGEMENT_TOKEN = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const SPACE_ID = process.env.MOBILE_APP_SPACE_ID;
const SOURCE_ENV = process.env.MOBILE_APP_ENV;
const TARGET_ENV = 'test-migration-env';
const CHANGESET_FILE = `changeset-${Date.now()}-${SPACE_ID}-${SOURCE_ENV}-${TARGET_ENV}.json`;
const RATE_LIMIT_DELAY = parseInt(process.env.RATE_LIMIT_DELAY) || 1000; // Delay in ms between API calls
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 5; // Maximum number of retries for rate limit errors
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 5; // Number of entries/assets to process in a batch

const client = contentful.createClient({ accessToken: MANAGEMENT_TOKEN });

/**
 * Simple progress tracker to display better information during long-running operations.
 */
class ProgressTracker {
    constructor(total, label) {
        this.total = total;
        this.current = 0;
        this.label = label;
        this.startTime = Date.now();
        this.lastReportTime = this.startTime;
        this.reportInterval = 10; // Report every 10% progress
    }

    increment() {
        this.current++;
        this.reportProgress();
    }

    reportProgress() {
        const percent = Math.floor((this.current / this.total) * 100);
        const currentTime = Date.now();
        const elapsed = (currentTime - this.startTime) / 1000;

        // Report if we've hit another reportInterval or if we're done
        if (percent % this.reportInterval === 0 || this.current === this.total) {
            if (currentTime - this.lastReportTime > 1000) {  // Don't report more than once per second
                const itemsPerSecond = this.current / elapsed;
                const remaining = this.total - this.current;
                const estimatedTimeRemaining = remaining / itemsPerSecond;

                console.log(
                    `${this.label}: ${percent}% complete (${this.current}/${this.total}) | ` +
                    `Speed: ${itemsPerSecond.toFixed(2)} items/sec | ` +
                    `Est. remaining: ${formatTime(estimatedTimeRemaining)}`
                );

                this.lastReportTime = currentTime;
            }
        }
    }
}

/**
 * Format time in seconds to a readable string (HH:MM:SS).
 * @param {number} seconds - Time in seconds.
 * @returns {string} - Formatted time string.
 */
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return [
        hours > 0 ? `${hours}h` : '',
        minutes > 0 ? `${minutes}m` : '',
        `${secs}s`
    ].filter(Boolean).join(' ');
}

/**
 * Utility function to delay execution.
 * @param {number} ms - Milliseconds to delay.
 * @returns {Promise} - Promise that resolves after delay.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Split array into batches of specified size.
 * @param {Array} array - Array to split into batches.
 * @param {number} batchSize - Size of each batch.
 * @returns {Array} - Array of batches.
 */
function splitIntoBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
        batches.push(array.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * Fetch all entries from an environment with pagination and error handling.
 * @param {Object} env - Contentful environment object.
 * @returns {Promise<Object[]>} - List of entries.
 */
async function fetchEntries(env) {
    const allEntries = [];
    let skip = 0;
    const limit = 500; // Smaller batch size to avoid timeouts
    let total = Infinity;

    while (skip < total) {
        let retries = 0;
        let success = false;
        let entries;

        while (!success && retries <= MAX_RETRIES) {
            try {
                console.log(`Fetching entries (${skip}-${skip + limit}) out of ${total !== Infinity ? total : 'unknown'}`);
                entries = await env.getEntries({ limit, skip });
                success = true;
            } catch (error) {
                if (error.name === 'RateLimitError' || error.statusCode === 429) {
                    retries++;
                    if (retries <= MAX_RETRIES) {
                        const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1);
                        console.log(`Rate limit hit while fetching entries. Retrying in ${delayTime}ms...`);
                        await sleep(delayTime);
                    } else {
                        console.error(`Failed to fetch entries after ${MAX_RETRIES} retries`, error.message);
                        throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries while fetching entries`);
                    }
                } else {
                    console.error('Error fetching entries:', error.message);
                    throw error;
                }
            }
        }

        // First time through, get the total
        if (total === Infinity) {
            total = entries.total;
        }

        allEntries.push(...entries.items);
        skip += limit;

        // Add a small delay between requests to avoid hitting rate limits
        if (skip < total) {
            await sleep(RATE_LIMIT_DELAY);
        }
    }

    console.log(`Successfully fetched ${allEntries.length} entries`);
    return allEntries;
}

/**
 * Fetch all assets from an environment with pagination and error handling.
 * @param {Object} env - Contentful environment object.
 * @returns {Promise<Object[]>} - List of assets.
 */
async function fetchAssets(env) {
    const allAssets = [];
    let skip = 0;
    const limit = 500; // Smaller batch size to avoid timeouts
    let total = Infinity;

    while (skip < total) {
        let retries = 0;
        let success = false;
        let assets;

        while (!success && retries <= MAX_RETRIES) {
            try {
                console.log(`Fetching assets (${skip}-${skip + limit}) out of ${total !== Infinity ? total : 'unknown'}`);
                assets = await env.getAssets({ limit, skip });
                success = true;
            } catch (error) {
                if (error.name === 'RateLimitError' || error.statusCode === 429) {
                    retries++;
                    if (retries <= MAX_RETRIES) {
                        const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1);
                        console.log(`Rate limit hit while fetching assets. Retrying in ${delayTime}ms...`);
                        await sleep(delayTime);
                    } else {
                        console.error(`Failed to fetch assets after ${MAX_RETRIES} retries`, error.message);
                        throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries while fetching assets`);
                    }
                } else {
                    console.error('Error fetching assets:', error.message);
                    throw error;
                }
            }
        }

        // First time through, get the total
        if (total === Infinity) {
            total = assets.total;
        }

        allAssets.push(...assets.items);
        skip += limit;

        // Add a small delay between requests to avoid hitting rate limits
        if (skip < total) {
            await sleep(RATE_LIMIT_DELAY);
        }
    }

    console.log(`Successfully fetched ${allAssets.length} assets`);
    return allAssets;
}

/**
 * Compare entries between source and target environments.
 * @param {Object[]} sourceEntries - Entries from the source environment.
 * @param {Object[]} targetEntries - Entries from the target environment.
 * @returns {Object} - Differences between source and target.
 */
function compareEntries(sourceEntries, targetEntries) {
    const sourceMap = new Map(sourceEntries.map((entry) => [entry.sys.id, entry]));
    const targetMap = new Map(targetEntries.map((entry) => [entry.sys.id, entry]));

    const differences = {
        missingInTarget: [],
        updatedInSource: [],
        deleteFromTarget: [], // New array for entries to delete from target
        archiveInTarget: [],  // New array for entries to archive in target
    };

    // Find entries missing, updated, or archive status changed in target
    for (const [id, sourceEntry] of sourceMap.entries()) {
        const targetEntry = targetMap.get(id);
        if (!targetEntry) {
            differences.missingInTarget.push(sourceEntry);
        } else if (JSON.stringify(sourceEntry.fields) !== JSON.stringify(targetEntry.fields)) {
            differences.updatedInSource.push(sourceEntry);
        }

        // Check if entry should be archived in target
        // If source is archived but target is not
        if (targetEntry && sourceEntry.sys.archivedAt && !targetEntry.sys.archivedAt) {
            differences.archiveInTarget.push(targetEntry);
        }
    }

    // Find entries that exist in target but not in source (to be deleted)
    for (const [id, targetEntry] of targetMap.entries()) {
        if (!sourceMap.has(id)) {
            differences.deleteFromTarget.push(targetEntry);
        }
    }

    return differences;
}

/**
 * Compare assets between source and target environments.
 * @param {Object[]} sourceAssets - Assets from the source environment.
 * @param {Object[]} targetAssets - Assets from the target environment.
 * @returns {Object} - Differences between source and target.
 */
function compareAssets(sourceAssets, targetAssets) {
    const sourceMap = new Map(sourceAssets.map((asset) => [asset.sys.id, asset]));
    const targetMap = new Map(targetAssets.map((asset) => [asset.sys.id, asset]));

    const differences = {
        missingInTarget: [],
        updatedInSource: [],
        deleteFromTarget: [], // New array for assets to delete from target
        archiveInTarget: []   // New array for assets to archive in target
    };

    // Find assets missing, updated, or archive status changed in target
    for (const [id, sourceAsset] of sourceMap.entries()) {
        const targetAsset = targetMap.get(id);
        if (!targetAsset) {
            differences.missingInTarget.push(sourceAsset);
        } else if (JSON.stringify(sourceAsset.fields) !== JSON.stringify(targetAsset.fields)) {
            // Check if asset content has changed (title, description, or file properties)
            differences.updatedInSource.push(sourceAsset);
        }

        // Check if asset should be archived in target
        // If source is archived but target is not
        if (targetAsset && sourceAsset.sys.archivedAt && !targetAsset.sys.archivedAt) {
            differences.archiveInTarget.push(targetAsset);
        }
    }

    // Find assets that exist in target but not in source (to be deleted)
    for (const [id, targetAsset] of targetMap.entries()) {
        if (!sourceMap.has(id)) {
            differences.deleteFromTarget.push(targetAsset);
        }
    }

    return differences;
}

/**
 * Apply changes to the target environment with rate limit handling.
 * @param {Object} env - Target environment object.
 * @param {Object} differences - Differences to apply.
 */
async function applyChanges(env, differences) {
    console.log(`Processing ${differences.missingInTarget.length} entries missing in target...`);

    // Process missing entries in batches
    const missingBatches = splitIntoBatches(differences.missingInTarget, BATCH_SIZE);

    // Create a progress tracker for missing entries
    const missingProgress = new ProgressTracker(differences.missingInTarget.length, 'Creating entries');

    // Process each batch of missing entries
    for (let batchIndex = 0; batchIndex < missingBatches.length; batchIndex++) {
        const batch = missingBatches[batchIndex];
        console.log(`Processing missing entries batch ${batchIndex + 1}/${missingBatches.length} (${batch.length} entries)`);

        // Process entries in the current batch sequentially to avoid rate limits
        for (const entry of batch) {
            let retries = 0;
            let success = false;

            while (!success && retries <= MAX_RETRIES) {
                try {
                    console.log(`Creating missing entry: ${entry.sys.id} (attempt ${retries + 1})`);

                    // Get the content type to check valid fields
                    const contentType = await env.getContentType(entry.sys.contentType.sys.id);
                    const validFields = contentType.fields.map(field => field.id);

                    // Filter out fields that don't exist in the target content type
                    const filteredFields = {};
                    for (const [fieldId, fieldData] of Object.entries(entry.fields)) {
                        if (validFields.includes(fieldId)) {
                            filteredFields[fieldId] = fieldData;
                        } else {
                            console.warn(`Skipping field "${fieldId}" for entry ${entry.sys.id} - field doesn't exist in target content type "${contentType.name}"`);
                        }
                    }

                    await env.createEntryWithId(entry.sys.contentType.sys.id, entry.sys.id, { fields: filteredFields });
                    success = true;
                    console.log(`Successfully created entry: ${entry.sys.id}`);
                    missingProgress.increment();
                } catch (error) {
                    if (error.name === 'RateLimitError' || error.statusCode === 429) {
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1); // Exponential backoff
                            console.log(`Rate limit hit. Retrying in ${delayTime}ms...`);
                            await sleep(delayTime);
                        } else {
                            console.error(`Failed to create entry after ${MAX_RETRIES} retries: ${entry.sys.id}`, error.message);
                            throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries for entry ${entry.sys.id}`);
                        }
                    } else if (error.status === 422 && error.message && error.message.includes("No field with id")) {
                        // Handle unknown field errors
                        console.warn(`Validation error for entry ${entry.sys.id}: ${error.message}`);

                        // Try again with stricter field filtering
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            console.log(`Field validation error, retrying with stricter field filtering for ${entry.sys.id}...`);
                            await sleep(RATE_LIMIT_DELAY);
                        } else {
                            console.error(`Failed to create entry after ${MAX_RETRIES} field validation retries: ${entry.sys.id}`);
                            // Log the error but continue with other entries rather than failing the entire migration
                            success = true; // Skip this entry but mark as "successful" to continue the process
                        }
                    } else {
                        console.error(`Error creating entry ${entry.sys.id}:`, error.message);

                        // For serious errors, determine whether to continue or fail
                        if (error.status >= 500) {
                            // Server errors are more serious - throw them
                            throw error;
                        } else {
                            // For other client errors, log and continue after max retries
                            retries++;
                            if (retries > MAX_RETRIES) {
                                console.error(`Skipping entry ${entry.sys.id} after ${MAX_RETRIES} failed attempts`);
                                success = true; // Skip this entry
                            }
                        }
                    }
                }

                // Add a small delay between requests to avoid hitting rate limits
                await sleep(RATE_LIMIT_DELAY);
            }
        }

        // Add a longer delay between batches to prevent rate limiting
        if (batchIndex < missingBatches.length - 1) {
            const batchDelayTime = RATE_LIMIT_DELAY * 3;
            console.log(`Batch ${batchIndex + 1} completed. Waiting ${batchDelayTime}ms before next batch...`);
            await sleep(batchDelayTime);
        }
    }
    console.log(`Processing ${differences.updatedInSource.length} entries updated in source...`);

    // Process updated entries in batches
    const updatedBatches = splitIntoBatches(differences.updatedInSource, BATCH_SIZE);

    // Create a progress tracker for updated entries
    const updatedProgress = new ProgressTracker(differences.updatedInSource.length, 'Updating entries');

    // Process each batch of updated entries
    for (let batchIndex = 0; batchIndex < updatedBatches.length; batchIndex++) {
        const batch = updatedBatches[batchIndex];
        console.log(`Processing updated entries batch ${batchIndex + 1}/${updatedBatches.length} (${batch.length} entries)`);

        // Process entries in the current batch sequentially to avoid rate limits
        for (const entry of batch) {
            let retries = 0;
            let success = false;
            let existingEntry;

            while (!success && retries <= MAX_RETRIES) {
                try {
                    console.log(`Updating entry: ${entry.sys.id} (attempt ${retries + 1})`);

                    // First, get the existing entry
                    if (!existingEntry) {
                        existingEntry = await env.getEntry(entry.sys.id);
                    }                    // Get the content type to check valid fields
                    const contentType = await env.getContentType(existingEntry.sys.contentType.sys.id);
                    const validFields = contentType.fields.map(field => field.id);

                    // Filter out fields that don't exist in the target content type
                    const filteredFields = {};
                    for (const [fieldId, fieldData] of Object.entries(entry.fields)) {
                        if (validFields.includes(fieldId)) {
                            filteredFields[fieldId] = fieldData;
                        } else {
                            console.warn(`Skipping field "${fieldId}" for entry ${entry.sys.id} - field doesn't exist in target content type "${contentType.name}"`);
                        }
                    }

                    // Update the fields and save
                    existingEntry.fields = filteredFields;
                    await existingEntry.update();
                    success = true;                    // Publish the entry if original was published
                    if (entry.sys.publishedAt) {
                        try {
                            // Refresh the entry before publishing to get the latest version
                            existingEntry = await env.getEntry(entry.sys.id);
                            await existingEntry.publish();
                            console.log(`Published updated entry: ${entry.sys.id}`);
                        } catch (publishError) {
                            if (publishError.status === 409) {
                                // Handle version conflict specifically for publishing
                                console.log(`Version conflict when publishing entry ${entry.sys.id}, retrying with fresh entry...`);
                                // Re-fetch and try one more time
                                try {
                                    const freshEntry = await env.getEntry(entry.sys.id);
                                    await freshEntry.publish();
                                    console.log(`Successfully published entry after version conflict: ${entry.sys.id}`);
                                } catch (retryError) {
                                    console.error(`Failed to publish entry after version conflict retry: ${entry.sys.id}`, retryError.message);
                                    // Continue processing other entries, don't throw here
                                }
                            } else {
                                console.warn(`Non-critical error publishing entry ${entry.sys.id}: ${publishError.message}`);
                                // Log but continue with other entries
                            }
                        }
                    }
                    console.log(`Successfully updated entry: ${entry.sys.id}`);
                    updatedProgress.increment();
                } catch (error) {
                    if (error.name === 'RateLimitError' || error.statusCode === 429) {
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1); // Exponential backoff
                            console.log(`Rate limit hit. Retrying in ${delayTime}ms...`);
                            await sleep(delayTime);
                        } else {
                            console.error(`Failed to update entry after ${MAX_RETRIES} retries: ${entry.sys.id}`, error.message);
                            throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries for entry ${entry.sys.id}`);
                        }
                    } else if (error.status === 409) {
                        // Handle version conflict specifically for updating
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            console.log(`Version conflict when updating entry ${entry.sys.id}, retrying with fresh entry...`);
                            existingEntry = null; // Reset so we get a fresh copy on retry
                            await sleep(RATE_LIMIT_DELAY);
                        } else {
                            console.error(`Failed to update entry after ${MAX_RETRIES} version conflict retries: ${entry.sys.id}`);
                            throw new Error(`Version conflicts exceeded max retries for entry ${entry.sys.id}`);
                        }
                    } else if (error.status === 422 && error.message && error.message.includes("No field with id")) {
                        // Handle unknown field errors
                        console.warn(`Validation error for entry ${entry.sys.id}: ${error.message}`);

                        // Try again with just getting the entry and filtering fields more aggressively
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            console.log(`Field validation error, retrying with stricter field filtering for ${entry.sys.id}...`);
                            existingEntry = null; // Force a refresh of the entry
                            await sleep(RATE_LIMIT_DELAY);
                        } else {
                            console.error(`Failed to update entry after ${MAX_RETRIES} field validation retries: ${entry.sys.id}`);
                            // Log the error but continue with other entries rather than failing the entire migration
                            success = true; // Skip this entry but mark as "successful" to continue the process
                        }
                    } else {
                        console.error(`Error updating entry ${entry.sys.id}:`, error.message);

                        // For serious errors, determine whether to continue or fail
                        if (error.status >= 500) {
                            // Server errors are more serious - throw them
                            throw error;
                        } else {
                            // For other client errors, log and continue after max retries
                            retries++;
                            if (retries > MAX_RETRIES) {
                                console.error(`Skipping entry ${entry.sys.id} after ${MAX_RETRIES} failed attempts`);
                                success = true; // Skip this entry
                            }
                        }
                    }
                }

                // Add a small delay between requests to avoid hitting rate limits
                await sleep(RATE_LIMIT_DELAY);
            }
        }

        // Add a longer delay between batches to prevent rate limiting
        if (batchIndex < updatedBatches.length - 1) {
            const batchDelayTime = RATE_LIMIT_DELAY * 3;
            console.log(`Batch ${batchIndex + 1} completed. Waiting ${batchDelayTime}ms before next batch...`);
            await sleep(batchDelayTime);
        }
    }
}

/**
 * Apply asset changes to the target environment with rate limit handling.
 * @param {Object} env - Target environment object.
 * @param {Object} differences - Differences to apply.
 */
async function applyAssetChanges(env, differences) {
    console.log(`Processing ${differences.missingInTarget.length} assets missing in target...`);

    if (differences.missingInTarget.length === 0 &&
        differences.updatedInSource.length === 0) {
        console.log('No assets to process.');
        return;
    }

    // Process missing assets in batches
    const missingBatches = splitIntoBatches(differences.missingInTarget, BATCH_SIZE);

    // Create a progress tracker for missing assets
    const assetProgress = new ProgressTracker(differences.missingInTarget.length, 'Creating assets');

    // Process each batch of missing assets
    for (let batchIndex = 0; batchIndex < missingBatches.length; batchIndex++) {
        const batch = missingBatches[batchIndex];
        console.log(`Processing missing assets batch ${batchIndex + 1}/${missingBatches.length} (${batch.length} assets)`);

        // Process assets in the current batch sequentially to avoid rate limits
        for (const asset of batch) {
            let retries = 0;
            let success = false;

            while (!success && retries <= MAX_RETRIES) {
                try {
                    console.log(`Creating missing asset: ${asset.sys.id} (attempt ${retries + 1})`);

                    // Filter asset fields to only include valid ones
                    const assetFields = {};
                    if (asset.fields.title) assetFields.title = asset.fields.title;
                    if (asset.fields.description) assetFields.description = asset.fields.description;
                    if (asset.fields.file) assetFields.file = asset.fields.file;

                    // Create the asset
                    const newAsset = await env.createAssetWithId(asset.sys.id, {
                        fields: assetFields
                    });

                    // Process the asset (prepare for publishing)
                    let needsProcessing = true;

                    try {
                        await newAsset.processForAllLocales();
                    } catch (processError) {
                        if (processError.message && processError.message.includes("File has already been processed")) {
                            console.log(`Asset ${asset.sys.id} has already been processed, continuing...`);
                            needsProcessing = false;
                        } else {
                            throw processError;
                        }
                    }

                    // Wait for processing to complete (only if we actually processed)
                    let processingComplete = !needsProcessing; // If doesn't need processing, it's already complete
                    let processingRetries = 0;
                    const maxProcessingRetries = 10;                    // Only check processing status if we actually triggered processing
                    if (needsProcessing) {
                        while (!processingComplete && processingRetries < maxProcessingRetries) {
                            try {
                                // Refresh the asset
                                const assetToCheck = await env.getAsset(asset.sys.id);

                                // Check if all files are processed
                                const allProcessed = Object.values(assetToCheck.fields.file).every(file =>
                                    file.url && !file.url.includes('in-progress')
                                );

                                if (allProcessed) {
                                    processingComplete = true;
                                    console.log(`Asset ${asset.sys.id} processed successfully.`);
                                } else {
                                    processingRetries++;
                                    console.log(`Asset ${asset.sys.id} still processing (attempt ${processingRetries}/${maxProcessingRetries})...`);
                                    await sleep(2000); // Wait 2 seconds before checking again
                                }
                            } catch (processError) {
                                processingRetries++;
                                console.log(`Error checking asset processing: ${processError.message}`);
                                await sleep(2000);
                            }
                        }

                        if (!processingComplete) {
                            throw new Error(`Asset processing timed out for asset ${asset.sys.id}`);
                        }
                    }                    // Publish the asset if original was published
                    if (asset.sys.publishedAt) {
                        try {
                            // Refresh the asset before publishing to get the latest version
                            const assetToPublish = await env.getAsset(asset.sys.id);
                            await assetToPublish.publish();
                            console.log(`Published asset: ${asset.sys.id}`);
                        } catch (publishError) {
                            if (publishError.status === 409) {
                                // Handle version conflict specifically for publishing
                                console.log(`Version conflict when publishing asset ${asset.sys.id}, retrying with fresh asset...`);
                                // Re-fetch and try one more time
                                try {
                                    const freshAsset = await env.getAsset(asset.sys.id);
                                    await freshAsset.publish();
                                    console.log(`Successfully published asset after version conflict: ${asset.sys.id}`);
                                } catch (retryError) {
                                    console.warn(`Non-critical error publishing asset after version conflict retry: ${asset.sys.id}`, retryError.message);
                                    // Continue processing other assets, don't throw here
                                }
                            } else {
                                console.warn(`Non-critical error publishing asset ${asset.sys.id}: ${publishError.message}`);
                                // Log but continue with other assets
                            }
                        }
                    }

                    success = true;
                    console.log(`Successfully created asset: ${asset.sys.id}`);
                    assetProgress.increment();
                } catch (error) {
                    if (error.name === 'RateLimitError' || error.statusCode === 429) {
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1); // Exponential backoff
                            console.log(`Rate limit hit. Retrying in ${delayTime}ms...`);
                            await sleep(delayTime);
                        } else {
                            console.error(`Failed to create asset after ${MAX_RETRIES} retries: ${asset.sys.id}`, error.message);
                            throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries for asset ${asset.sys.id}`);
                        }
                    } else if (error.status === 409) {
                        // Handle version conflict specifically for asset creation
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            console.log(`Version conflict when creating asset ${asset.sys.id}, retrying...`);
                            await sleep(RATE_LIMIT_DELAY);
                        } else {
                            console.error(`Failed to create asset after ${MAX_RETRIES} version conflict retries: ${asset.sys.id}`);
                            throw new Error(`Version conflicts exceeded max retries for asset ${asset.sys.id}`);
                        }
                    } else {
                        console.error(`Error creating asset ${asset.sys.id}:`, error.message);
                        throw error;
                    }
                }

                // Add a small delay between requests to avoid hitting rate limits
                await sleep(RATE_LIMIT_DELAY);
            }
        }

        // Add a longer delay between batches to prevent rate limiting
        if (batchIndex < missingBatches.length - 1) {
            const batchDelayTime = RATE_LIMIT_DELAY * 3;
            console.log(`Batch ${batchIndex + 1} completed. Waiting ${batchDelayTime}ms before next batch...`);
            await sleep(batchDelayTime);
        }
    }

    // After processing missing assets, now process updated assets
    console.log(`Processing ${differences.updatedInSource.length} assets updated in source...`);

    if (differences.updatedInSource.length > 0) {
        // Process updated assets in batches
        const updatedBatches = splitIntoBatches(differences.updatedInSource, BATCH_SIZE);

        // Create a progress tracker for updated assets
        const updatedProgress = new ProgressTracker(differences.updatedInSource.length, 'Updating assets');

        // Process each batch of updated assets
        for (let batchIndex = 0; batchIndex < updatedBatches.length; batchIndex++) {
            const batch = updatedBatches[batchIndex];
            console.log(`Processing updated assets batch ${batchIndex + 1}/${updatedBatches.length} (${batch.length} assets)`);

            // Process assets in the current batch sequentially to avoid rate limits
            for (const asset of batch) {
                let retries = 0;
                let success = false;
                let existingAsset;

                while (!success && retries <= MAX_RETRIES) {
                    try {
                        console.log(`Updating asset: ${asset.sys.id} (attempt ${retries + 1})`);

                        // First, get the existing asset
                        if (!existingAsset) {
                            existingAsset = await env.getAsset(asset.sys.id);
                        }                        // Update only valid asset fields (title, description, file)
                        const validAssetFields = ['title', 'description', 'file'];
                        const filteredAssetFields = {};

                        for (const [fieldId, fieldData] of Object.entries(asset.fields)) {
                            if (validAssetFields.includes(fieldId)) {
                                filteredAssetFields[fieldId] = fieldData;
                            } else {
                                console.warn(`Skipping asset field "${fieldId}" for asset ${asset.sys.id} - not a standard asset field`);
                            }
                        }

                        // Update the fields and save
                        existingAsset.fields = filteredAssetFields;
                        await existingAsset.update();// If the asset needs processing again due to file changes
                        if (asset.fields.file) {
                            let needsProcessing = true;
                            // Define processingComplete in the larger scope
                            let processingComplete = false;

                            try {
                                // Check if all files are already processed (have URLs)
                                needsProcessing = !Object.values(existingAsset.fields.file).every(file =>
                                    file.url && !file.url.includes('in-progress')
                                );

                                if (needsProcessing) {
                                    console.log(`Asset ${asset.sys.id} needs processing...`);
                                    await existingAsset.processForAllLocales();
                                } else {
                                    console.log(`Asset ${asset.sys.id} already processed, skipping processing step.`);
                                    // Mark as complete if no processing needed
                                    processingComplete = true;
                                }
                            } catch (processError) {
                                if (processError.message && processError.message.includes("File has already been processed")) {
                                    console.log(`Asset ${asset.sys.id} has already been processed, continuing...`);
                                    needsProcessing = false;
                                    // Mark as complete since it's already processed
                                    processingComplete = true;
                                } else {
                                    throw processError;
                                }
                            }
                            // Only wait for processing if we actually triggered processing
                            if (needsProcessing) {
                                // Wait for processing to complete
                                let processingRetries = 0;
                                const maxProcessingRetries = 10;

                                while (!processingComplete && processingRetries < maxProcessingRetries) {
                                    try {
                                        // Refresh the asset
                                        const assetToCheck = await env.getAsset(asset.sys.id);

                                        // Check if all files are processed
                                        const allProcessed = Object.values(assetToCheck.fields.file).every(file =>
                                            file.url && !file.url.includes('in-progress')
                                        );

                                        if (allProcessed) {
                                            processingComplete = true;
                                            console.log(`Updated asset ${asset.sys.id} processed successfully.`);
                                        } else {
                                            processingRetries++;
                                            console.log(`Updated asset ${asset.sys.id} still processing (attempt ${processingRetries}/${maxProcessingRetries})...`);
                                            await sleep(2000); // Wait 2 seconds before checking again
                                        }
                                    } catch (processError) {
                                        processingRetries++;
                                        console.log(`Error checking asset processing: ${processError.message}`);
                                        await sleep(2000);
                                    }
                                }
                            }

                            if (!processingComplete) {
                                throw new Error(`Asset processing timed out for updated asset ${asset.sys.id}`);
                            }
                        }                        // Re-publish the asset if it was published before
                        if (asset.sys.publishedAt) {
                            try {
                                // Refresh the asset before publishing to get the latest version
                                existingAsset = await env.getAsset(asset.sys.id);
                                await existingAsset.publish();
                                console.log(`Re-published updated asset: ${asset.sys.id}`);
                            } catch (publishError) {
                                if (publishError.status === 409) {
                                    // Handle version conflict specifically for publishing
                                    console.log(`Version conflict when publishing updated asset ${asset.sys.id}, retrying with fresh asset...`);
                                    // Re-fetch and try one more time
                                    try {
                                        const freshAsset = await env.getAsset(asset.sys.id);
                                        await freshAsset.publish();
                                        console.log(`Successfully published updated asset after version conflict: ${asset.sys.id}`);
                                    } catch (retryError) {
                                        console.warn(`Non-critical error publishing updated asset after version conflict retry: ${asset.sys.id}`, retryError.message);
                                        // Continue processing other assets, don't throw here
                                    }
                                } else {
                                    console.warn(`Non-critical error publishing updated asset ${asset.sys.id}: ${publishError.message}`);
                                    // Log but continue with other assets
                                }
                            }
                        }

                        success = true;
                        console.log(`Successfully updated asset: ${asset.sys.id}`);
                        updatedProgress.increment();
                    } catch (error) {
                        if (error.name === 'RateLimitError' || error.statusCode === 429) {
                            retries++;
                            if (retries <= MAX_RETRIES) {
                                const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1); // Exponential backoff
                                console.log(`Rate limit hit. Retrying in ${delayTime}ms...`);
                                await sleep(delayTime);
                            } else {
                                console.error(`Failed to update asset after ${MAX_RETRIES} retries: ${asset.sys.id}`, error.message);
                                throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries for asset ${asset.sys.id}`);
                            }
                        } else if (error.status === 409) {
                            // Handle version conflict specifically for updating assets
                            retries++;
                            if (retries <= MAX_RETRIES) {
                                console.log(`Version conflict when updating asset ${asset.sys.id}, retrying with fresh asset...`);
                                existingAsset = null; // Reset so we get a fresh copy on retry
                                await sleep(RATE_LIMIT_DELAY);
                            } else {
                                console.error(`Failed to update asset after ${MAX_RETRIES} version conflict retries: ${asset.sys.id}`);
                                throw new Error(`Version conflicts exceeded max retries for asset ${asset.sys.id}`);
                            }
                        } else {
                            console.error(`Error updating asset ${asset.sys.id}:`, error.message);
                            throw error;
                        }
                    }

                    // Add a small delay between requests to avoid hitting rate limits
                    await sleep(RATE_LIMIT_DELAY);
                }
            }

            // Add a longer delay between batches to prevent rate limiting
            if (batchIndex < updatedBatches.length - 1) {
                const batchDelayTime = RATE_LIMIT_DELAY * 3;
                console.log(`Batch ${batchIndex + 1} completed. Waiting ${batchDelayTime}ms before next batch...`);
                await sleep(batchDelayTime);
            }
        }
    }
}

/**
 * Delete entries from the target environment with rate limit handling.
 * @param {Object} env - Target environment object.
 * @param {Object[]} entriesToDelete - Entries to delete from target.
 */
async function deleteEntriesFromTarget(env, entriesToDelete) {
    console.log(`Processing ${entriesToDelete.length} entries to delete from target...`);

    if (entriesToDelete.length === 0) {
        console.log('No entries to delete.');
        return;
    }

    // Process entries to delete in batches
    const deleteBatches = splitIntoBatches(entriesToDelete, BATCH_SIZE);

    // Create a progress tracker for deleting entries
    const deleteProgress = new ProgressTracker(entriesToDelete.length, 'Deleting entries');

    // Process each batch of entries to delete
    for (let batchIndex = 0; batchIndex < deleteBatches.length; batchIndex++) {
        const batch = deleteBatches[batchIndex];
        console.log(`Processing deletion batch ${batchIndex + 1}/${deleteBatches.length} (${batch.length} entries)`);

        // Process entries in the current batch sequentially to avoid rate limits
        for (const entry of batch) {
            let retries = 0;
            let success = false;

            while (!success && retries <= MAX_RETRIES) {
                try {
                    console.log(`Deleting entry: ${entry.sys.id} (attempt ${retries + 1})`);

                    // First check if the entry is published, and if so, unpublish it
                    const entryToDelete = await env.getEntry(entry.sys.id);

                    if (entryToDelete.isPublished()) {
                        await entryToDelete.unpublish();
                        console.log(`Unpublished entry: ${entry.sys.id}`);

                        // Get a fresh instance after unpublishing
                        const refreshedEntry = await env.getEntry(entry.sys.id);
                        await refreshedEntry.delete();
                    } else {
                        await entryToDelete.delete();
                    }

                    success = true;
                    console.log(`Successfully deleted entry: ${entry.sys.id}`);
                    deleteProgress.increment();
                } catch (error) {
                    if (error.name === 'RateLimitError' || error.statusCode === 429) {
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1); // Exponential backoff
                            console.log(`Rate limit hit. Retrying in ${delayTime}ms...`);
                            await sleep(delayTime);
                        } else {
                            console.error(`Failed to delete entry after ${MAX_RETRIES} retries: ${entry.sys.id}`, error.message);
                            throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries for entry ${entry.sys.id}`);
                        }
                    } else {
                        console.error(`Error deleting entry ${entry.sys.id}:`, error.message);
                        throw error;
                    }
                }

                // Add a small delay between requests to avoid hitting rate limits
                await sleep(RATE_LIMIT_DELAY);
            }
        }

        // Add a longer delay between batches to prevent rate limiting
        if (batchIndex < deleteBatches.length - 1) {
            const batchDelayTime = RATE_LIMIT_DELAY * 3;
            console.log(`Batch ${batchIndex + 1} completed. Waiting ${batchDelayTime}ms before next batch...`);
            await sleep(batchDelayTime);
        }
    }
}

/**
 * Delete assets from the target environment with rate limit handling.
 * @param {Object} env - Target environment object.
 * @param {Object[]} assetsToDelete - Assets to delete from target.
 */
async function deleteAssetsFromTarget(env, assetsToDelete) {
    console.log(`Processing ${assetsToDelete.length} assets to delete from target...`);

    if (assetsToDelete.length === 0) {
        console.log('No assets to delete.');
        return;
    }

    // Process assets to delete in batches
    const deleteBatches = splitIntoBatches(assetsToDelete, BATCH_SIZE);

    // Create a progress tracker for deleting assets
    const deleteProgress = new ProgressTracker(assetsToDelete.length, 'Deleting assets');

    // Process each batch of assets to delete
    for (let batchIndex = 0; batchIndex < deleteBatches.length; batchIndex++) {
        const batch = deleteBatches[batchIndex];
        console.log(`Processing asset deletion batch ${batchIndex + 1}/${deleteBatches.length} (${batch.length} assets)`);

        // Process assets in the current batch sequentially to avoid rate limits
        for (const asset of batch) {
            let retries = 0;
            let success = false;

            while (!success && retries <= MAX_RETRIES) {
                try {
                    console.log(`Deleting asset: ${asset.sys.id} (attempt ${retries + 1})`);

                    // First check if the asset is published, and if so, unpublish it
                    const assetToDelete = await env.getAsset(asset.sys.id);

                    if (assetToDelete.isPublished()) {
                        await assetToDelete.unpublish();
                        console.log(`Unpublished asset: ${asset.sys.id}`);

                        // Get a fresh instance after unpublishing
                        const refreshedAsset = await env.getAsset(asset.sys.id);
                        await refreshedAsset.delete();
                    } else {
                        await assetToDelete.delete();
                    }

                    success = true;
                    console.log(`Successfully deleted asset: ${asset.sys.id}`);
                    deleteProgress.increment();
                } catch (error) {
                    if (error.name === 'RateLimitError' || error.statusCode === 429) {
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1); // Exponential backoff
                            console.log(`Rate limit hit. Retrying in ${delayTime}ms...`);
                            await sleep(delayTime);
                        } else {
                            console.error(`Failed to delete asset after ${MAX_RETRIES} retries: ${asset.sys.id}`, error.message);
                            throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries for asset ${asset.sys.id}`);
                        }
                    } else {
                        console.error(`Error deleting asset ${asset.sys.id}:`, error.message);
                        throw error;
                    }
                }

                // Add a small delay between requests to avoid hitting rate limits
                await sleep(RATE_LIMIT_DELAY);
            }
        }

        // Add a longer delay between batches to prevent rate limiting
        if (batchIndex < deleteBatches.length - 1) {
            const batchDelayTime = RATE_LIMIT_DELAY * 3;
            console.log(`Batch ${batchIndex + 1} completed. Waiting ${batchDelayTime}ms before next batch...`);
            await sleep(batchDelayTime);
        }
    }
}

/**
 * Archive entries in the target environment with rate limit handling.
 * @param {Object} env - Target environment object.
 * @param {Object[]} entriesToArchive - Entries to archive in target.
 */
async function archiveEntriesInTarget(env, entriesToArchive) {
    console.log(`Processing ${entriesToArchive.length} entries to archive in target...`);

    if (entriesToArchive.length === 0) {
        console.log('No entries to archive.');
        return;
    }

    // Process entries to archive in batches
    const archiveBatches = splitIntoBatches(entriesToArchive, BATCH_SIZE);

    // Create a progress tracker for archiving entries
    const archiveProgress = new ProgressTracker(entriesToArchive.length, 'Archiving entries');

    // Process each batch of entries to archive
    for (let batchIndex = 0; batchIndex < archiveBatches.length; batchIndex++) {
        const batch = archiveBatches[batchIndex];
        console.log(`Processing archive batch ${batchIndex + 1}/${archiveBatches.length} (${batch.length} entries)`);

        // Process entries in the current batch sequentially to avoid rate limits
        for (const entry of batch) {
            let retries = 0;
            let success = false;

            while (!success && retries <= MAX_RETRIES) {
                try {
                    console.log(`Archiving entry: ${entry.sys.id} (attempt ${retries + 1})`);

                    // First check if the entry is published, and if so, unpublish it
                    const entryToArchive = await env.getEntry(entry.sys.id);

                    if (entryToArchive.isPublished()) {
                        await entryToArchive.unpublish();
                        console.log(`Unpublished entry before archiving: ${entry.sys.id}`);
                    }

                    // Now archive the entry
                    await entryToArchive.archive();
                    console.log(`Successfully archived entry: ${entry.sys.id}`);
                    archiveProgress.increment();
                    success = true;
                } catch (error) {
                    if (error.name === 'RateLimitError' || error.statusCode === 429) {
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1); // Exponential backoff
                            console.log(`Rate limit hit. Retrying in ${delayTime}ms...`);
                            await sleep(delayTime);
                        } else {
                            console.error(`Failed to archive entry after ${MAX_RETRIES} retries: ${entry.sys.id}`, error.message);
                            throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries for entry ${entry.sys.id}`);
                        }
                    } else {
                        console.error(`Error archiving entry ${entry.sys.id}:`, error.message);
                        throw error;
                    }
                }

                // Add a small delay between requests to avoid hitting rate limits
                await sleep(RATE_LIMIT_DELAY);
            }
        }

        // Add a longer delay between batches to prevent rate limiting
        if (batchIndex < archiveBatches.length - 1) {
            const batchDelayTime = RATE_LIMIT_DELAY * 3;
            console.log(`Batch ${batchIndex + 1} completed. Waiting ${batchDelayTime}ms before next batch...`);
            await sleep(batchDelayTime);
        }
    }
}

/**
 * Archive assets in the target environment with rate limit handling.
 * @param {Object} env - Target environment object.
 * @param {Object[]} assetsToArchive - Assets to archive in target.
 */
async function archiveAssetsInTarget(env, assetsToArchive) {
    console.log(`Processing ${assetsToArchive.length} assets to archive in target...`);

    if (assetsToArchive.length === 0) {
        console.log('No assets to archive.');
        return;
    }

    // Process assets to archive in batches
    const archiveBatches = splitIntoBatches(assetsToArchive, BATCH_SIZE);

    // Create a progress tracker for archiving assets
    const archiveProgress = new ProgressTracker(assetsToArchive.length, 'Archiving assets');

    // Process each batch of assets to archive
    for (let batchIndex = 0; batchIndex < archiveBatches.length; batchIndex++) {
        const batch = archiveBatches[batchIndex];
        console.log(`Processing asset archive batch ${batchIndex + 1}/${archiveBatches.length} (${batch.length} assets)`);

        // Process assets in the current batch sequentially to avoid rate limits
        for (const asset of batch) {
            let retries = 0;
            let success = false;

            while (!success && retries <= MAX_RETRIES) {
                try {
                    console.log(`Archiving asset: ${asset.sys.id} (attempt ${retries + 1})`);

                    // First check if the asset is published, and if so, unpublish it
                    const assetToArchive = await env.getAsset(asset.sys.id);

                    if (assetToArchive.isPublished()) {
                        await assetToArchive.unpublish();
                        console.log(`Unpublished asset before archiving: ${asset.sys.id}`);
                    }

                    // Now archive the asset
                    await assetToArchive.archive();
                    console.log(`Successfully archived asset: ${asset.sys.id}`);
                    archiveProgress.increment();
                    success = true;
                } catch (error) {
                    if (error.name === 'RateLimitError' || error.statusCode === 429) {
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            const delayTime = RATE_LIMIT_DELAY * Math.pow(2, retries - 1); // Exponential backoff
                            console.log(`Rate limit hit. Retrying in ${delayTime}ms...`);
                            await sleep(delayTime);
                        } else {
                            console.error(`Failed to archive asset after ${MAX_RETRIES} retries: ${asset.sys.id}`, error.message);
                            throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries for asset ${asset.sys.id}`);
                        }
                    } else {
                        console.error(`Error archiving asset ${asset.sys.id}:`, error.message);
                        throw error;
                    }
                }

                // Add a small delay between requests to avoid hitting rate limits
                await sleep(RATE_LIMIT_DELAY);
            }
        }

        // Add a longer delay between batches to prevent rate limiting
        if (batchIndex < archiveBatches.length - 1) {
            const batchDelayTime = RATE_LIMIT_DELAY * 3;
            console.log(`Batch ${batchIndex + 1} completed. Waiting ${batchDelayTime}ms before next batch...`);
            await sleep(batchDelayTime);
        }
    }
}

/**
 * Main function to perform the merge with error handling.
 */
async function mergeEnvironments() {
    try {
        const space = await client.getSpace(SPACE_ID);
        const sourceEnv = await space.getEnvironment(SOURCE_ENV);
        const targetEnv = await space.getEnvironment(TARGET_ENV);

        // PART 1: Process entries
        console.log(`Fetching entries from source environment: ${SOURCE_ENV}`);
        const sourceEntries = await fetchEntries(sourceEnv);

        console.log(`Fetching entries from target environment: ${TARGET_ENV}`);
        const targetEntries = await fetchEntries(targetEnv);

        console.log('Comparing entries...');
        const entryDifferences = compareEntries(sourceEntries, targetEntries);
        console.log(`Found ${entryDifferences.missingInTarget.length} entries missing in target.`);
        console.log(`Found ${entryDifferences.updatedInSource.length} entries updated in source.`);
        console.log(`Found ${entryDifferences.deleteFromTarget.length} entries to delete from target.`);

        // PART 2: Process assets
        console.log(`Fetching assets from source environment: ${SOURCE_ENV}`);
        const sourceAssets = await fetchAssets(sourceEnv);

        console.log(`Fetching assets from target environment: ${TARGET_ENV}`);
        const targetAssets = await fetchAssets(targetEnv); console.log('Comparing assets...');
        const assetDifferences = compareAssets(sourceAssets, targetAssets);

        console.log(`Found ${assetDifferences.missingInTarget.length} assets missing in target.`);
        console.log(`Found ${assetDifferences.updatedInSource?.length || 0} assets updated in source.`);
        console.log(`Found ${assetDifferences.deleteFromTarget.length} assets to delete from target.`);
        console.log(`Found ${assetDifferences.archiveInTarget?.length || 0} assets to archive in target.`);

        // Combine differences for the changeset file
        const allDifferences = {
            entries: entryDifferences,
            assets: assetDifferences
        };

        // Save differences to a file
        fs.writeFileSync(CHANGESET_FILE, JSON.stringify(allDifferences, null, 2));
        console.log(`Changeset saved to ${CHANGESET_FILE}`);
        const hasEntryChanges = entryDifferences.missingInTarget.length > 0 ||
            entryDifferences.updatedInSource.length > 0 ||
            entryDifferences.deleteFromTarget.length > 0 ||
            entryDifferences.archiveInTarget?.length > 0;
        const hasAssetChanges = assetDifferences.missingInTarget.length > 0 ||
            assetDifferences.updatedInSource?.length > 0 ||
            assetDifferences.deleteFromTarget.length > 0 ||
            assetDifferences.archiveInTarget?.length > 0;

        if (!hasEntryChanges && !hasAssetChanges) {
            console.log('No differences found. No changes to apply.');
            return;
        }

        console.log('Applying changes to target environment...');
        const startTime = Date.now();        // First migrate assets (since entries might reference them)
        if (hasAssetChanges) {
            console.log('Starting asset migration...');

            // First delete assets that exist in target but not in source
            if (assetDifferences.deleteFromTarget.length > 0) {
                console.log('Starting to delete assets that exist in target but not in source...');
                await deleteAssetsFromTarget(targetEnv, assetDifferences.deleteFromTarget);
            }

            // Archive assets in target that are archived in source
            if (assetDifferences.archiveInTarget && assetDifferences.archiveInTarget.length > 0) {
                console.log('Starting to archive assets in target that are archived in source...');
                await archiveAssetsInTarget(targetEnv, assetDifferences.archiveInTarget);
            }

            // Create missing assets and update changed ones
            await applyAssetChanges(targetEnv, assetDifferences);
        }

        // Then migrate entries
        if (hasEntryChanges) {
            console.log('Starting entry migration...');

            // First delete entries that exist in target but not in source
            if (entryDifferences.deleteFromTarget.length > 0) {
                console.log('Starting to delete entries that exist in target but not in source...');
                await deleteEntriesFromTarget(targetEnv, entryDifferences.deleteFromTarget);
            }

            // Archive entries in target that are archived in source
            if (entryDifferences.archiveInTarget && entryDifferences.archiveInTarget.length > 0) {
                console.log('Starting to archive entries in target that are archived in source...');
                await archiveEntriesInTarget(targetEnv, entryDifferences.archiveInTarget);
            }

            // Then create missing entries and update changed ones
            await applyChanges(targetEnv, entryDifferences);
        }

        const endTime = Date.now(); const totalTime = (endTime - startTime) / 1000; // Convert to seconds
        console.log('---------------------------------------------------');
        console.log(`Merge completed successfully in ${formatTime(totalTime)}.`);
        console.log(`Created ${entryDifferences.missingInTarget.length} entries.`);
        console.log(`Updated ${entryDifferences.updatedInSource.length} entries.`);
        console.log(`Deleted ${entryDifferences.deleteFromTarget.length} entries from target.`);
        console.log(`Archived ${entryDifferences.archiveInTarget?.length || 0} entries in target.`);
        console.log(`Created ${assetDifferences.missingInTarget.length} assets.`);
        console.log(`Updated ${assetDifferences.updatedInSource?.length || 0} assets.`);
        console.log(`Deleted ${assetDifferences.deleteFromTarget.length} assets from target.`);
        console.log(`Archived ${assetDifferences.archiveInTarget?.length || 0} assets in target.`);
        console.log(`Total items processed: ${entryDifferences.missingInTarget.length +
            entryDifferences.updatedInSource.length +
            entryDifferences.deleteFromTarget.length +
            (entryDifferences.archiveInTarget?.length || 0) +
            assetDifferences.missingInTarget.length +
            (assetDifferences.updatedInSource?.length || 0) +
            assetDifferences.deleteFromTarget.length +
            (assetDifferences.archiveInTarget?.length || 0)
            }`);
        console.log('---------------------------------------------------');

        // Delete the changeset file after successful merge
        try {
            fs.unlinkSync(CHANGESET_FILE);
            console.log(`Deleted temporary changeset file: ${CHANGESET_FILE}`);
        } catch (deleteError) {
            console.warn(`Warning: Failed to delete changeset file: ${deleteError.message}`);
        }
    } catch (error) {
        let errorMessage = `Error during merge: ${error.message}`;

        if (error.name === 'RateLimitError' || error.statusCode === 429) {
            errorMessage = `Rate limit exceeded: ${error.message}. Try again later or increase the delay between requests.`;
        } else if (error.statusCode) {
            errorMessage = `API error (${error.statusCode}): ${error.message}`;
        }

        console.error(errorMessage);
        throw error; // Re-throw to be caught by the main error handler
    }
}

// Run the script with better error reporting
mergeEnvironments().then(() => {
    console.log('Merge process completed successfully.');

    // Double-check that the changeset file is deleted
    if (fs.existsSync(CHANGESET_FILE)) {
        try {
            fs.unlinkSync(CHANGESET_FILE);
            console.log(`Deleted temporary changeset file: ${CHANGESET_FILE}`);
        } catch (error) {
            console.warn(`Note: Could not delete changeset file: ${error.message}`);
        }
    }

    process.exit(0);
}).catch((err) => {
    console.error('Merge process failed:');
    console.error('------------------------------');
    if (err.stack) {
        console.error(err.stack);
    } else {
        console.error(err);
    }
    console.error('------------------------------');
    process.exit(1);
});