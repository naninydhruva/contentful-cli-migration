# Entry Deletion Mapping Documentation

## Overview

The Entry Deletion Mapping system provides a configurable way to automatically delete entries during the publishing process based on content type and field criteria. This feature is integrated into the enhanced publishing workflow and provides safety mechanisms to prevent accidental deletion of referenced content.

## Configuration File Structure

The deletion rules are defined in `config/entry-deletion-mappings.json`. The configuration follows this structure:

```json
{
  "description": "Configuration file for defining entry deletion criteria",
  "version": "1.0.0",
  "deletionRules": [...],
  "globalSettings": {...},
  "environmentConfig": {...}
}
```

## Deletion Rules

Each deletion rule contains the following properties:

### Basic Properties
- **`id`**: Unique identifier for the rule
- **`name`**: Human-readable name for the rule
- **`enabled`**: Boolean flag to enable/disable the rule
- **`contentTypes`**: Array of content type IDs to target (use `"*"` for all types)
- **`environments`**: Array of environment names where this rule applies

### Conditions
The `conditions` object defines the criteria for deletion:

```json
{
  "operator": "AND|OR",
  "rules": [
    {
      "field": "fieldName",
      "operator": "operatorName",
      "value": "expectedValue",
      "description": "Human readable description"
    }
  ]
}
```

### Safety Checks
The `safetyChecks` object provides protection mechanisms:

```json
{
  "checkLinks": true,           // Check if entry is referenced by others
  "skipIfReferenced": true,     // Skip deletion if entry is linked
  "requireConfirmation": false  // Require manual confirmation (future feature)
}
```

## Available Operators

### Field State Operators
- **`isEmpty`**: Field is null, undefined, or empty string/array
- **`isNotEmpty`**: Field has meaningful value

### Comparison Operators
- **`equals`**: Field value equals specified value
- **`notEquals`**: Field value does not equal specified value

### String Operators
- **`contains`**: Field value contains specified substring
- **`startsWith`**: Field value starts with specified string
- **`endsWith`**: Field value ends with specified string

### Date Operators
- **`before`**: Date field is before specified date/time
- **`after`**: Date field is after specified date/time
- **`olderThan`**: Entry created/updated before X days/hours ago
- **`newerThan`**: Entry created/updated after X days/hours ago

### Numeric Operators
- **`greaterThan`**: Numeric field is greater than value
- **`lessThan`**: Numeric field is less than value

## Environment Configuration

Each environment can have specific settings:

```json
{
  "always-de": {
    "safeMode": true,                    // Enable all safety checks
    "maxDeletionsPerRun": 50,           // Maximum deletions per execution
    "requireConfirmationForAll": false   // Require confirmation for all deletions
  }
}
```

## Example Rules

### 1. Remove Empty SEO Entries

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

### 2. Remove Test Entries

```json
{
  "id": "remove-test-entries",
  "name": "Remove test entries from production environments",
  "enabled": true,
  "contentTypes": ["*"],
  "conditions": {
    "operator": "OR",
    "rules": [
      {
        "field": "title",
        "operator": "startsWith",
        "value": "TEST:",
        "description": "Title starts with TEST:"
      },
      {
        "field": "slug",
        "operator": "contains",
        "value": "test-",
        "description": "Slug contains test-"
      }
    ]
  },
  "safetyChecks": {
    "checkLinks": false,
    "skipIfReferenced": false,
    "requireConfirmation": false
  },
  "environments": ["always-uk", "always-fr"]
}
```

### 3. Remove Expired Content

```json
{
  "id": "remove-expired-featured-content",
  "name": "Remove expired featured content",
  "enabled": true,
  "contentTypes": ["featuredContent", "featuredContentListWithWave"],
  "conditions": {
    "operator": "AND",
    "rules": [
      {
        "field": "endDate",
        "operator": "before",
        "value": "now",
        "description": "End date has passed"
      },
      {
        "field": "status",
        "operator": "notEquals",
        "value": "evergreen",
        "description": "Not marked as evergreen content"
      }
    ]
  },
  "safetyChecks": {
    "checkLinks": true,
    "skipIfReferenced": true,
    "requireConfirmation": false
  },
  "environments": ["always-de", "always-uk", "always-fr", "mobile-app"]
}
```

## CLI Commands

### Testing Deletion Rules (Dry Run)
```bash
npm run deletion-test always-de
# Or directly:
node src/cli/deletion-mapping-cli.js test always-de
```

### Validate Configuration
```bash
npm run deletion-validate
# Or directly:
node src/cli/deletion-mapping-cli.js validate
```

### List Rules for Environment
```bash
npm run deletion-rules always-uk
# Or directly:
node src/cli/deletion-mapping-cli.js rules always-uk
```

### Show Configuration Summary
```bash
npm run deletion-summary
# Or directly:
node src/cli/deletion-mapping-cli.js summary
```

### Quick Status Check
```bash
npm run deletion-config
```

## Integration with Publishing

The deletion mapping system is integrated into the enhanced publishing workflow (`npm run publish-entry-only`). The process follows these steps:

1. **Fetch Entries**: Retrieve all entries to be processed
2. **Apply Deletion Rules**: Check entries against configured deletion criteria
3. **Safety Checks**: Verify that entries to be deleted are not referenced by others
4. **Execute Deletions**: Delete entries that match criteria and pass safety checks
5. **Generate Reports**: Create detailed audit reports of deletion operations
6. **Continue Publishing**: Process remaining entries for publication

## Safety Mechanisms

### Link Checking
Before deleting any entry, the system checks if it's referenced by other entries. If an entry is linked and `skipIfReferenced` is true, the deletion is skipped.

### Maximum Deletions Limit
Each environment has a configurable maximum number of deletions per run to prevent accidental bulk deletions.

### Audit Reports
All deletion operations are logged in detailed JSON reports that include:
- Timestamp and environment
- Rules that triggered deletions
- Content type breakdown
- Entries that were deleted vs. skipped
- Reasons for each deletion

### Safe Mode
When enabled, safe mode enforces all safety checks including link verification and deletion limits.

## Best Practices

### 1. Start with Disabled Rules
Always create new rules with `"enabled": false` and test them thoroughly before enabling.

### 2. Use Specific Content Types
Avoid using wildcard (`"*"`) content types unless absolutely necessary.

### 3. Enable Safety Checks
Always use `"checkLinks": true` and `"skipIfReferenced": true` unless you're certain entries won't be referenced.

### 4. Test in Non-Production First
Test deletion rules in development environments before applying to production.

### 5. Monitor Deletion Reports
Regularly review deletion audit reports to ensure rules are working as expected.

### 6. Use Descriptive Names and Descriptions
Make rules easy to understand with clear names and detailed descriptions.

## Troubleshooting

### Rule Not Triggering
1. Check that the rule is enabled (`"enabled": true`)
2. Verify the environment is listed in the rule's `environments` array
3. Ensure the content type matches the rule's `contentTypes`
4. Test the condition logic with the CLI test command

### Entries Not Being Deleted
1. Check if entries are referenced by others (link checking)
2. Verify the environment's `maxDeletionsPerRun` limit
3. Review the safety checks configuration
4. Check the deletion audit report for skip reasons

### Configuration Errors
Use the validation command to check for configuration issues:
```bash
npm run deletion-validate
```

## File Locations

- **Configuration**: `config/entry-deletion-mappings.json`
- **Processor**: `src/utils/entry-deletion-processor.js`
- **CLI Tool**: `src/cli/deletion-mapping-cli.js`
- **Integration**: `src/cli/contentful-cli.js` (publishEntries function)
- **Reports**: `deletion-report-{environment}-{timestamp}.json`

## Version History

- **v1.0.0**: Initial implementation with basic deletion rules and safety checks
