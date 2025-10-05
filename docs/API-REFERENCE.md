# API Reference

This document provides comprehensive API reference for all Contentful Management Tools.

## 🛠️ Core CLI Tools

### contentful-cli.js - Enhanced Publishing CLI

**Location**: `src/cli/contentful-cli.js`

#### Commands

```bash
# Enhanced publishing with all features
node src/cli/contentful-cli.js publish <environment>
node src/cli/contentful-cli.js publish-entries-only <environment>
node src/cli/contentful-cli.js publish-assets-only <environment>
```

#### Key Functions

**`fetchAllWithPagination(entityType, queryParams, environment)`**
- Universal pagination handler
- **Parameters**: entityType ('entries'|'assets'), queryParams (object), environment
- **Returns**: Promise<Array> - All items across all pages
- **Features**: Automatic rate limiting, progress tracking, error recovery

**`publishEntries(environment)`**
- Enhanced entry publishing with validation
- **Features**: Link cleaning, validation error processing, smart deletion
- **Returns**: Promise with processing statistics

**`cleanEntryLinks(entry, environment)`**
- Clean broken links from entry fields
- **Parameters**: entry (object), environment
- **Returns**: Promise<object> - Cleaned entry with statistics

**`createValidationReport(validationErrors, deletedEntries, environment)`**
- Generate comprehensive JSON audit reports
- **Parameters**: Arrays of errors and deletions, environment name
- **Returns**: Promise<string> - Generated report file path

#### Environment Support
- `always-uk` - UK English (Space: aqfuj2z95p5p)
- `always-de` - German (Space: e40ce46hdlh0)
- `always-fr` - French (Space: 2lrezuyi0bgv)
- `mobile-app` - Mobile (Space: yaek2eheu5pz)

### contentful-advanced-migration.js - Deep Migration

**Location**: `src/cli/contentful-advanced-migration.js`

#### Usage

```bash
node src/cli/contentful-advanced-migration.js --entry <ENTRY_ID> [options]
```

#### Key Functions

**`migrateEntry(entryId, options)`**
- Deep recursive entry migration
- **Features**: Linked entries, assets, configurable depth
- **Parameters**: entryId (string), options (object)
- **Returns**: Promise<object> - Migration results

**`migrateAsset(assetId, options)`**
- Asset migration with file handling
- **Features**: Cross-space file migration, locale processing
- **Parameters**: assetId (string), options (object)
- **Returns**: Promise<object> - Migration results

#### Options
- `--entry <ids>` - Entry IDs to migrate (comma-separated)
- `--exclude <ids>` - Entry IDs to exclude
- `--depth <number>` - Maximum recursion depth (default: 4)
- `--publish <true|false>` - Auto-publish after migration
- `--source-space <id>` - Source space ID
- `--target-space <id>` - Target space ID

### cf-source-target-cli.js - Content Type Transformation

**Location**: `src/cli/cf-source-target-cli.js`

#### Usage

```bash
node src/cli/cf-source-target-cli.js --migration-type <type> [options]
```

#### Key Functions

**`migrateEntry(entryId, sourceEnv, targetEnv)`**
- Transform entries between content types
- **Parameters**: entryId, source/target environments
- **Features**: Field mapping, reference processing, locale handling

**`migrateAsset(assetId, sourceEnv, targetEnv)`**
- Asset migration with cross-space support
- **Features**: Cross-space URL handling, file download/upload
- **Parameters**: assetId, source/target environments

**`handleCrossSpaceAssetMigration(asset, assetId, locale, fileInfo)`**
- Automatic cross-space asset handling
- **Features**: File download, re-upload, URL updating
- **Returns**: Promise<object> - Upload metadata

#### Migration Types
- `entry` - Entry-only migration
- `asset` - Asset-only migration  
- `both` - Combined entry and asset migration

#### Configuration
Uses `config/content-type-mappings.json`:
```json
[
  {
    "sourceContentType": "blogPost",
    "targetContentType": "article", 
    "fieldMappings": {
      "title": "headline",
      "body": "content"
    }
  }
]
```

### cf-contentType.js - Content Type Management

**Location**: `src/cli/cf-contentType.js`

#### Commands

```bash
node src/cli/cf-contentType.js help
node src/cli/cf-contentType.js sync
node src/cli/cf-contentType.js delete-content-entries
```

## 🔧 Utility Functions

### logger.js - Enhanced Logging

**Location**: `src/utils/logger.js`

#### Methods

**`logger.info(message, ...args)`**
- General information logging
- **Color**: Blue
- **Usage**: Progress updates, status information

**`logger.success(message, ...args)`**
- Success operation logging
- **Color**: Green
- **Usage**: Completion confirmations

**`logger.warn(message, ...args)`**
- Warning message logging
- **Color**: Yellow
- **Usage**: Non-critical issues

**`logger.error(message, ...args)`**
- Error message logging
- **Color**: Red
- **Usage**: Errors and failures

**`logger.createChild(name)`**
- Create specialized logger instance
- **Parameters**: name (string) - Logger instance name
- **Returns**: Logger instance with prefixed output

### get-contentful-entries.js - Entry Retrieval

**Location**: `src/utils/get-contentful-entries.js`

#### Functions

**`getEntriesByContentType(contentTypeId)`**
- Retrieve all entries of specific content type
- **Parameters**: contentTypeId (string)
- **Returns**: Promise<Array> - All entries with pagination
- **Features**: Automatic pagination, progress tracking

**Usage Example**:
```javascript
const { getEntriesByContentType } = require('./src/utils/get-contentful-entries');
const entries = await getEntriesByContentType('blogPost');
```

## 📊 Data Structures

### Validation Report Structure

```json
{
  "reportGenerated": "2025-08-04T09:01:39.800Z",
  "environment": "always-de",
  "summary": {
    "totalValidationErrors": 2,
    "totalDeletedEntries": 1,
    "missingRequiredFieldErrors": 1
  },
  "validationErrors": [
    {
      "entryId": "abc123",
      "contentType": "blogPost",
      "errors": [
        {
          "name": "required",
          "path": ["fields", "title", "en-US"],
          "details": "Required field is missing",
          "isMissingRequired": true
        }
      ]
    }
  ],
  "deletedEntries": [
    {
      "entryId": "abc123",
      "deletedAt": "2025-08-04T09:01:39.750Z", 
      "reason": "422 validation error with missing required fields"
    }
  ]
}
```

### Link Cleaning Statistics

```json
{
  "entryId": "abc123",
  "totalLinksProcessed": 5,
  "brokenLinksRemoved": 2,
  "linksByType": {
    "entries": 3,
    "assets": 2
  },
  "removedByType": {
    "entries": 1,
    "assets": 1
  }
}
```

## 🔄 Error Handling

### Common Error Types

**Rate Limiting**
- **Error**: `RateLimitExceeded`
- **Handling**: Automatic exponential backoff retry
- **Max Retries**: 5 attempts

**Validation Errors**
- **Error**: HTTP 422 with missing required fields
- **Handling**: Smart deletion of unreferenced entries
- **Reporting**: Complete audit trail

**Asset Processing Errors**
- **Error**: Cross-space file URL issues
- **Handling**: Automatic file download and re-upload
- **Fallback**: Original reference preservation

### Error Recovery Patterns

```javascript
// Retry with exponential backoff
await retryWithBackoff(async () => {
  return await contentfulOperation();
}, 'operation-name');

// Safe error handling with fallback
try {
  const result = await processEntry(entry);
  return result;
} catch (error) {
  logger.error(`Processing failed: ${error.message}`);
  return fallbackValue;
}
```

## 🧪 Testing API

### Test Functions

**`runIntegrationTest()`**
- **Location**: `tests/test-final-integration.js`
- **Purpose**: Complete functionality validation
- **Returns**: Promise<boolean> - Test success status

**`testLinkCleaning()`**
- **Location**: `tests/test-enhanced-link-cleaning.js`
- **Purpose**: Link cleaning functionality validation
- **Features**: Broken link detection, removal verification

**`testValidationEnhancement()`**
- **Location**: `tests/test-validation-enhancement.js`
- **Purpose**: Validation error processing tests
- **Features**: 422 error handling, smart deletion logic

## 📝 Configuration Reference

### Environment Variables

```env
# Required
CONTENTFUL_MANAGEMENT_TOKEN=your_token_here

# Space IDs
SPACE_ID_UK_UK=space_id_for_uk
SPACE_ID_DE_DE=space_id_for_de  
SPACE_ID_FR_FR=space_id_for_fr
SPACE_ID_MOBILE=space_id_for_mobile

# Optional
LOG_LEVEL=INFO
LOG_TIMESTAMPS=true
```

### Content Type Mappings

**File**: `config/content-type-mappings.json`

```json
[
  {
    "sourceContentType": "sourceType",
    "targetContentType": "targetType",
    "fieldMappings": {
      "sourceField": "targetField"
    }
  }
]
```

## 🚀 Performance Optimization

### Batch Processing
- **Entry Processing**: 100 entries per batch
- **Asset Processing**: 50 assets per batch
- **Memory Management**: Automatic cleanup between batches

### Rate Limiting
- **Default Delay**: 500ms between requests
- **Exponential Backoff**: 2^attempt seconds for rate limits
- **Max Retries**: 5 attempts per operation

### Caching
- **Content Types**: Cached for session duration
- **Processed Items**: Tracked to avoid duplicates
- **Environment Connections**: Reused across operations

---

**API Version**: 1.0.0  
**Last Updated**: August 4, 2025  
**Compatibility**: Node.js 14.x+
