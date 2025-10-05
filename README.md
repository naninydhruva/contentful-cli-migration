# Contentful Management Tools

A comprehensive suite of production-ready CLI tools for managing Contentful CMS content, featuring advanced migration, intelligent publishing, automated validation capabilities, and comprehensive link cleanup.

## 🚀 Key Features

- **🔄 Advanced Migration** - Deep recursive migration between Contentful spaces with asset handling
- **🧠 Intelligent Publishing** - Smart pagination, validation error processing, and broken link cleaning  
- **🔗 Link Cleanup & Validation** - Find and clean broken entry/asset links with comprehensive reporting
- **🗑️ Smart Deletion Mapping** - Configurable entry deletion based on content type and field criteria
- **🔗 Cross-Space Assets** - Automatic handling of assets from different Contentful spaces
- **✅ Data Validation** - Skip entries with no meaningful content, smart deletion of problematic entries
- **📊 Audit Reports** - Comprehensive JSON reports for compliance and monitoring
- **⚡ Production-Grade** - Rate limiting, error recovery, batch processing optimization

## ⚡ Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Contentful credentials

# Scan for broken links (safe, no changes)
node src/cli/cf-link-cleanup.js scan --max-entries 10

# Clean broken links (dry run first)
node src/cli/cf-link-cleanup.js clean --dry-run

# Enhanced publishing (recommended)
npm run publish-entry-only

# Run tests
npm test

# View all features
npm run demo
```

## 🎯 Quick Start

### 🔗 Link Cleanup & Validation (New!)
```bash
# Scan for broken links (safe, no changes made)
node src/cli/cf-link-cleanup.js scan

# Scan specific content type
node src/cli/cf-link-cleanup.js scan --content-type articleListGeneral

# Clean broken links (test first with dry-run)
node src/cli/cf-link-cleanup.js clean --dry-run --max-entries 10
node src/cli/cf-link-cleanup.js clean

# Clean and publish entries
node src/cli/cf-link-cleanup.js clean-and-publish

# Process specific space/environment
node src/cli/cf-link-cleanup.js scan --space-id your-space --env-id master

# See all options
node src/cli/cf-link-cleanup.js help
```

### Enhanced Publishing (Recommended)
```bash
# Publish entries with all enhancements (pagination, validation, link cleaning)
npm run publish-entry-only

# Publish to specific environment
node src/cli/contentful-cli.js publish-entries-only always-de

# Full publish with assets
node src/cli/contentful-cli.js publish always-uk
```

### Content Migration
```bash
# Migrate entries between spaces
npm run entry-migration -- --entry ENTRY_ID_TO_MIGRATE

# Transform content types
npm run content-transform -- --entry-id ENTRY_ID --config-file config/content-type-mappings.json
```

### Utility Commands
```bash
# Get entries by content type
npm run get-entries

# Run all tests
npm run test:all

# View demo output
npm run demo
```

### Smart Deletion Mapping
```bash
# Test deletion rules (dry run - no actual deletion)
npm run deletion-test always-de

# Validate deletion mapping configuration
npm run deletion-validate

# List deletion rules for environment
npm run deletion-rules always-uk

# Show deletion mapping summary
npm run deletion-summary

# Quick status check
npm run deletion-config
```

## 📁 Project Structure

```
contentful-cli-migration/
├── src/
│   ├── cli/                    # Command-line interface scripts
│   │   ├── contentful-cli.js           # Main enhanced CLI with all features
│   │   ├── cf-link-cleanup.js          # 🆕 Link cleanup and validation CLI
│   │   ├── contentful-advanced-migration.js  # Deep migration between spaces
│   │   ├── cf-source-target-cli.js     # Content type transformation
│   │   ├── cf-contentType.js           # Content type management
│   │   └── contentful-merge.js         # Content merging utilities
│   └── utils/                  # Utility functions and helpers
│       ├── logger.js                   # Enhanced logging with colors
│       ├── logger-color/               # Color utilities for logging
│       ├── get-contentful-entries.js   # Entry retrieval utilities
│       └── git-env.js                  # Environment management
├── tests/                      # Comprehensive test suite
│   ├── test-final-integration.js       # Integration tests
│   ├── test-enhanced-link-cleaning.js  # Link cleaning tests
│   ├── test-validation-enhancement.js  # Validation tests
│   └── [other test files]
├── docs/                       # Documentation and implementation guides
├── examples/                   # Demo scripts and usage examples
├── config/                     # Configuration files
│   └── content-type-mappings.json      # Content type mapping definitions
└── exports/                    # Export/import data files
```

## 🛠️ Installation

### Prerequisites
- Node.js 14.x or higher
- Contentful Management Token with appropriate permissions
- Access to Contentful spaces (source and target)

### Setup
1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd contentful-cli-migration
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Contentful credentials
   ```

4. **Verify installation**
   ```bash
   npm test
   ```

## 🗑️ Smart Deletion Mapping

The enhanced publishing system includes configurable entry deletion based on content type and field criteria. This allows you to automatically remove entries that match specific conditions during the publishing process.

### Configuration File

The deletion rules are defined in `config/entry-deletion-mappings.json`. This file contains:

- **Deletion Rules**: Define what entries should be deleted
- **Content Type Filtering**: Target specific content types or use wildcard (`*`)
- **Field Conditions**: Complex logic with AND/OR operators
- **Safety Checks**: Link verification and confirmation requirements
- **Environment Settings**: Per-environment configuration

### Example Deletion Rule

```json
{
  "id": "remove-empty-seo-entries",
  "name": "Remove SEO entries with no meaningful content",
  "enabled": true,
  "contentTypes": ["seoHead", "seoData"],
  "conditions": {
    "operator": "AND",
    "rules": [
      {
        "field": "title",
        "operator": "isEmpty",
        "description": "No title provided"
      },
      {
        "field": "description", 
        "operator": "isEmpty",
        "description": "No meta description"
      }
    ]
  },
  "safetyChecks": {
    "checkLinks": true,
    "skipIfReferenced": true,
    "requireConfirmation": false
  },
  "environments": ["always-de", "always-uk", "always-fr"]
}
```

### Available Operators

- **Field Checks**: `isEmpty`, `isNotEmpty`, `equals`, `notEquals`
- **String Operations**: `contains`, `startsWith`, `endsWith`
- **Date Comparisons**: `before`, `after`, `olderThan`, `newerThan`
- **Numeric**: `greaterThan`, `lessThan`
- **Logical**: `AND`, `OR` for combining conditions

### Safety Features

- **Link Checking**: Verifies if entries are referenced before deletion
- **Environment Limits**: Maximum deletions per run (configurable per environment)
- **Confirmation Requirements**: Optional confirmation for critical deletions
- **Audit Reports**: Detailed JSON reports of all deletion operations

### Command Line Options

- `--entry <ids>`: Comma-separated list of entry IDs to migrate (required)
- `--exclude <ids>`: Comma-separated list of entry IDs to exclude from migration
- `--source-space <id>`: Source space ID (default: from .env)
- `--source-env <id>`: Source environment ID (default: from .env)
- `--target-space <id>`: Target space ID (default: from .env)
- `--target-env <id>`: Target environment ID (default: from .env)
- `--token <token>`: Contentful management token (default: from .env)
- `--depth <number>`: Maximum depth for traversing linked entries (default: 4)
- `--publish <true|false>`: Whether to publish entries after migration (default: false)
- `--help`: Print usage information and exit

### Examples

Migrate a single entry with its linked entries:

```bash
node contentful-advanced-migration.js --entry 6g1YujbfYGGhoZXau9ubsM
```

Migrate multiple entries with exclusions:

```bash
node contentful-advanced-migration.js --entry 6g1YujbfYGGhoZXau9ubsM,7hZXvKbgX11iaPWbu2ubsB --exclude 9jKLmnoP23klNMopQrstUV
```

Migrate to a different space/environment than specified in .env:

```bash
node contentful-advanced-migration.js --entry 6g1YujbfYGGhoZXau9ubsM --target-space other_space_id --target-env other_env_id
```

Migrate and publish all entries:

```bash
node contentful-advanced-migration.js --entry 6g1YujbfYGGhoZXau9ubsM --publish true
```

Limit the depth of linked entries:

```bash
node contentful-advanced-migration.js --entry 6g1YujbfYGGhoZXau9ubsM --depth 2
```

## Logging

The script uses the custom logger module with colored output. You can configure the log level in the `.env` file:

```
LOG_LEVEL=INFO
LOG_TIMESTAMPS=true
```

Available log levels:
- DEBUG: Verbose output with all details
- INFO: General information about the migration process
- SUCCESS: Successful operations
- WARNING: Non-critical issues that don't stop the migration
- ERROR: Issues with specific entries or assets
- CRITICAL: Critical errors that stop the migration

## Error Handling

The script has robust error handling that:
- Logs all errors with detailed information
- Continues migration even if some entries fail
- Provides a summary of errors at the end of migration
- Exits with a non-zero status code if critical errors occur

## Known Limitations

1. The script doesn't handle circular references specially, but limits recursion with the depth parameter
2. Rate limiting is implemented with simple delays, not with adaptive backoff
3. Very large entries may require adjusting Node.js memory limits

## Source-Target Content Type Migration

The improved `cf-source-target-cli.js` script transforms entries between content types using configurable mappings.

### Key Features

- **Content Type Mappings**: Define source-to-target content type mappings in a configuration file
- **Referenced Entries**: Automatically migrates referenced entries according to the mappings
- **Asset Migration**: Migrates and processes linked assets
- **Field Mapping**: Maps fields between different content types with custom field name mappings
- **Rate Limiting**: Handles API rate limits with exponential backoff
- **Error Handling**: Robust error handling for various failure scenarios

### Configuration File

The script uses a JSON configuration file to define content type mappings. The default file is `content-type-mappings.json` in the script directory:

```json
[
  {
    "sourceContentType": "blogPost",
    "targetContentType": "article",
    "fieldMappings": {
      "title": "headline",
      "body": "content"
    }
  },
  {
    "sourceContentType": "author",
    "targetContentType": "person",
    "fieldMappings": {
      "name": "fullName",
      "bio": "biography"
    }
  }
]
```

### Usage

```bash
# Using NPM script
npm run content-transform -- --entry-id ENTRY_ID

# Direct invocation
node cf-source-target-cli.js --entry-id ENTRY_ID --config-file ./my-mappings.json
```

### Command Line Options

- `--entry-id`: ID of the entry to migrate (required)
- `--config-file`: Path to the content type mappings configuration file
- `--source-env`: Source environment ID
- `--source-space`: Source space ID
- `--target-env`: Target environment ID  
- `--target-space`: Target space ID
- `--publish`: Publish entries after migration
- `--verbose`: Enable detailed logging

### How It Works

1. The script reads content type mappings from the configuration file
2. It loads the specified entry from the source environment
3. Based on the entry's content type, it finds the appropriate mapping
4. For each field in the source entry:
   - Maps the field name according to the configuration
   - Processes any linked assets by copying them to the target environment
   - Recursively processes any referenced entries according to their mappings
5. Creates or updates the entry in the target environment with the mapped fields
6. Optionally publishes the migrated entries and assets

This approach allows for complex content transformations while maintaining relationships between entries and ensuring assets are properly handled.

## Cross-Space Asset Migration

The cross-space asset migration feature automatically handles assets that reference files from different Contentful spaces. This is particularly useful when assets have been copied between spaces or when migrating content that includes assets from multiple sources.

### Key Features

- **Automatic Detection**: Identifies asset file URLs that reference different spaces
- **File Migration**: Downloads files from source space and uploads to target space
- **URL Updating**: Updates asset references with new target space URLs
- **Error Handling**: Gracefully handles migration failures and continues processing
- **Configurable**: Can be enabled or disabled via command line flags

### Usage

```bash
# Enable cross-space migration (default)
node cf-source-target-cli.js --migration-type asset --asset-ids abc123 --enable-cross-space-migration

# Disable cross-space migration
node cf-source-target-cli.js --migration-type asset --asset-ids abc123 --disable-cross-space-migration
```

For detailed information about cross-space migration, see [CROSS-SPACE-MIGRATION.md](./CROSS-SPACE-MIGRATION.md).

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `npm run publish` | Enhanced publish with all features |
| `npm run publish-entry-only` | Publish entries only (enhanced) |
| `npm run entry-migration` | Deep migration between spaces |
| `npm run content-transform` | Content type transformation |
| `npm run get-entries` | Retrieve entries by content type |
| `npm test` | Run integration tests |
| `npm run demo` | View feature demonstration |

## 🏗️ Architecture

### Project Structure
```
src/
├── cli/           # Main CLI applications
└── utils/         # Shared utilities
tests/             # Comprehensive test suite  
docs/              # Technical documentation
examples/          # Usage demonstrations
config/            # Configuration files
```

### Core Tools
- **`contentful-cli.js`** - Enhanced publishing with link cleaning and validation
- **`contentful-advanced-migration.js`** - Deep cross-space migration
- **`cf-source-target-cli.js`** - Content type transformation
- **`cf-contentType.js`** - Content type management

## 🌍 Supported Environments

- **always-uk** - UK English (Space: aqfuj2z95p5p)
- **always-de** - German (Space: e40ce46hdlh0) - Tested with 6,617+ entries
- **always-fr** - French (Space: 2lrezuyi0bgv)  
- **mobile-app** - Mobile (Space: yaek2eheu5pz)

## 📊 Performance & Production Status

**Production Ready** ✅
- Tested with 6,617+ entries successfully
- Link cleaning: <500ms per entry with broken links
- Pagination: ~315s for large datasets (optimized batch processing)
- Memory usage: Optimized with intelligent batching
- All tests passing with comprehensive validation

## 📚 Documentation & Support

- **[Complete Documentation](docs/)** - Technical guides and implementation details
- **[Examples & Demos](examples/)** - Usage demonstrations and feature showcases
- **[Test Suite](tests/)** - Comprehensive testing with validation
- **[Configuration](config/)** - Content type mappings and settings

## 🚀 Getting Started

1. **Installation**: `npm install`
2. **Configuration**: Copy `.env.example` to `.env` and configure
3. **Quick Test**: `npm test`
4. **Enhanced Publishing**: `npm run publish-entry-only`
5. **View Features**: `npm run demo`

---

**Version**: 1.0.0 | **Status**: Production Ready | **Last Updated**: August 4, 2025
