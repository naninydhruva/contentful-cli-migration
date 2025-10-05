# Enhanced Contentful CLI - Usage Guide

## 🚀 Quick Start

### Running the Enhanced CLI
```bash
# Basic publishing with deletion mapping
node src/cli/contentful-cli.js

# Test deletion rules without executing
node src/cli/deletion-mapping-cli.js test --environment always-de --max-entries 10
```

### Configuration Files
- **Entry Deletion Rules**: `config/entry-deletion-mappings.json`
- **Environment Settings**: `.env`
- **Content Type Mappings**: `config/content-type-mappings.json`

## 📋 Deletion Mapping Rules

### Current Active Rules

#### 1. Empty SEO Entries
```json
{
  "id": "remove-empty-seo-entries",
  "contentTypes": ["seoHead"],
  "conditions": {
    "rules": [{ "field": "url", "operator": "isEmpty" }]
  }
}
```

#### 2. Empty Page Entries  
```json
{
  "id": "remove-empty-entries",
  "contentTypes": ["page"],
  "conditions": {
    "rules": [{ "field": "seoHead", "operator": "isEmpty" }]
  }
}
```

#### 3. Completely Empty Entries (Universal)
```json
{
  "id": "remove-completely-empty-entries",
  "contentTypes": ["*"],
  "conditions": {
    "operator": "OR",
    "rules": [
      { "field": "*", "operator": "isEmpty" },
      { "field": "*", "operator": "hasNoData" }
    ]
  },
  "safetyChecks": {
    "unlinkBeforeDeletion": true
  }
}
```

## 🛡️ Safety Features

### Automatic Unlinking
The system automatically removes references to entries before deletion:

1. **Detection**: Finds all entries referencing the target entry
2. **Unlinking**: Removes links from arrays and single reference fields  
3. **Verification**: Confirms successful unlinking before deletion
4. **Reporting**: Logs all unlinking operations

### Environment Protection
```json
{
  "always-de": {
    "safeMode": true,
    "maxDeletionsPerRun": 50,
    "requireConfirmationForAll": false
  }
}
```

## 🔧 Configuration Options

### Rule Operators
- **`isEmpty`**: Field is null, undefined, or empty string/array
- **`hasNoData`**: Entry has no meaningful content in any field
- **`equals`**: Field value equals specified value
- **`contains`**: Field value contains specified substring
- **`before`/`after`**: Date comparisons
- **`olderThan`/`newerThan`**: Relative date comparisons

### Logical Operators
- **`AND`**: All conditions must be true
- **`OR`**: At least one condition must be true

### Special Values
- **`*`**: Applies to all content types or fields
- **`now`**: Current date/time
- **`30d`**, **`7d`**, **`1h`**: Relative time periods

## 📊 Testing and Validation

### Testing Deletion Rules
```bash
# Test with limited entries
node src/cli/deletion-mapping-cli.js test --environment always-de --max-entries 5

# Test specific content types
node src/cli/deletion-mapping-cli.js test --environment always-de --content-type page
```

### Analyzing Entry Data
The enhanced `hasEntryData` function provides detailed analysis:

```javascript
const analysis = hasEntryData(entry, true);
console.log({
  hasData: analysis.hasData,
  fieldsWithData: analysis.fieldsWithData,
  totalFields: analysis.totalFields,
  localeAnalysis: analysis.localeAnalysis
});
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Rule Not Matching
- Check content type spelling in rules
- Verify field names match exactly
- Confirm environment is included in rule

#### 2. Deletion Limits Reached
- Check `maxDeletionsPerRun` in environment config
- Increase limit or run multiple times
- Review deletion candidates to ensure accuracy

#### 3. Unlinking Failures
- Check for circular references
- Verify entry permissions
- Review API rate limits

### Debug Commands
```bash
# Check configuration loading
node -e "const p = require('./src/utils/entry-deletion-processor.js'); const proc = new p(); console.log('Rules:', proc.config.deletionRules.length);"

# Test hasNoData method
node -e "const p = require('./src/utils/entry-deletion-processor.js'); const proc = new p(); console.log(proc.hasNoData({sys:{id:'test'}, fields:{}}));"
```

## 📈 Monitoring and Reporting

### Logs and Reports
- **Deletion Reports**: Automatically generated in JSON format
- **Comprehensive Logging**: All operations logged with timestamps
- **Error Tracking**: Detailed error reporting with context
- **Progress Tracking**: Real-time progress updates

### Key Metrics
- Entries processed vs. deleted
- Unlinking success rates
- Error rates by operation type
- Processing time per entry

## 🔐 Security Considerations

### Access Control
- Requires valid Contentful Management API token
- Respects Contentful space and environment permissions
- Logs all destructive operations for audit

### Data Protection
- Automatic backups recommended before bulk operations
- Test mode available for validation
- Configurable confirmation requirements for sensitive operations

## 🚀 Best Practices

### Before Running
1. **Test with small samples** using `--max-entries` flag
2. **Review deletion candidates** in test mode
3. **Backup important data** before bulk operations
4. **Configure appropriate limits** for your environment

### During Operation
1. **Monitor logs** for errors or unexpected behavior
2. **Check progress regularly** for long-running operations
3. **Be prepared to stop** if issues arise
4. **Verify results** after completion

### After Operation
1. **Review deletion reports** for accuracy
2. **Check for broken references** in remaining content
3. **Update content models** if needed
4. **Document any issues** for future reference

## 📞 Support

### Getting Help
1. Check logs for detailed error messages
2. Review configuration files for syntax errors
3. Test with minimal examples to isolate issues
4. Consult the comprehensive documentation in `/docs`

### Common Solutions
- **API Rate Limits**: Reduce batch sizes or add delays
- **Permission Issues**: Verify API token permissions
- **Configuration Errors**: Validate JSON syntax
- **Network Issues**: Implement retry logic (already included)
