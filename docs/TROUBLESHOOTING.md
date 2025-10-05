# Troubleshooting Guide

This guide helps resolve common issues when using Contentful Management Tools.

## 🚨 Common Issues & Solutions

### Authentication & Access

#### Issue: "Unauthorized" or "Invalid Token"
**Symptoms**: 
- HTTP 401 errors
- "The access token you sent could not be found"

**Solutions**:
1. **Check Token**: Verify `CONTENTFUL_MANAGEMENT_TOKEN` in `.env`
2. **Token Permissions**: Ensure token has management permissions
3. **Space Access**: Verify token has access to target spaces
4. **Token Expiry**: Generate new token if expired

```bash
# Test token validity
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.contentful.com/spaces/YOUR_SPACE_ID
```

#### Issue: "Space Not Found"
**Symptoms**:
- HTTP 404 errors for space operations
- "The resource could not be found"

**Solutions**:
1. **Verify Space IDs**: Check space IDs in `.env` file
2. **Environment Names**: Confirm environment names (main, master, etc.)
3. **Token Access**: Ensure token has access to specified spaces

### Rate Limiting & Performance

#### Issue: "Rate Limit Exceeded"
**Symptoms**:
- HTTP 429 errors
- Requests failing with rate limit messages
- Slow processing with retries

**Solutions**:
1. **Automatic Retry**: Tools include exponential backoff (no action needed)
2. **Reduce Concurrency**: Lower batch sizes in configuration
3. **Increase Delays**: Add longer delays between operations

```javascript
// Adjust rate limiting in config
const config = {
  rateLimitDelay: 1000, // Increase from 500ms
  maxRetries: 3 // Reduce retries if needed
};
```

#### Issue: Slow Processing
**Symptoms**:
- Operations taking longer than expected
- Memory usage growing over time

**Solutions**:
1. **Batch Size**: Reduce batch processing size
2. **Memory**: Use `--max-old-space-size=4096` for large datasets
3. **Pagination**: Ensure pagination is working correctly

```bash
# Run with increased memory
node --max-old-space-size=4096 src/cli/contentful-cli.js publish always-de
```

### Content & Data Issues

#### Issue: "Missing Required Fields"
**Symptoms**:
- HTTP 422 validation errors
- Entries failing to publish
- "Field 'fieldName' is required"

**Solutions**:
1. **Auto-Detection**: Tools automatically detect and handle these errors
2. **Check Reports**: Review generated JSON reports for details
3. **Manual Fix**: Add required field values if needed

**Example Report Location**: `validation-report-always-de-2025-08-04.json`

#### Issue: Broken Asset Links
**Symptoms**:
- Assets failing to process
- "Asset not found" errors
- Cross-space URL issues

**Solutions**:
1. **Link Cleaning**: Enabled automatically in enhanced CLI
2. **Cross-Space Migration**: Ensure `--enable-cross-space-migration` is set
3. **Manual Asset Check**: Verify asset exists in target space

```bash
# Enable cross-space migration explicitly
node src/cli/cf-source-target-cli.js --migration-type asset \
  --asset-ids abc123 --enable-cross-space-migration
```

#### Issue: Content Type Mapping Errors
**Symptoms**:
- "No mapping found for content type"
- Entries being skipped during transformation
- Field mapping issues

**Solutions**:
1. **Check Config**: Verify `config/content-type-mappings.json`
2. **Add Mappings**: Add missing content type mappings
3. **Field Names**: Ensure source/target field names are correct

```json
// Example mapping structure
{
  "sourceContentType": "blogPost",
  "targetContentType": "article",
  "fieldMappings": {
    "title": "headline",
    "body": "content"
  }
}
```

### Environment & Setup Issues

#### Issue: "Module Not Found"
**Symptoms**:
- Node.js module errors
- Import/require failures
- Path resolution issues

**Solutions**:
1. **Install Dependencies**: Run `npm install`
2. **Check Paths**: Verify file paths after restructuring
3. **Node Version**: Ensure Node.js 14.x or higher

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check Node version
node --version
```

#### Issue: Environment Configuration
**Symptoms**:
- Missing environment variables
- Wrong space/environment targeting
- Configuration loading failures

**Solutions**:
1. **Copy Template**: `cp .env.example .env`
2. **Verify Values**: Check all required environment variables
3. **Environment Names**: Confirm environment names match Contentful

```env
# Required environment variables
CONTENTFUL_MANAGEMENT_TOKEN=your_token
SPACE_ID_UK_UK=space_id
SPACE_ID_DE_DE=space_id
SPACE_ID_FR_FR=space_id
SPACE_ID_MOBILE=space_id
```

## 🔧 Debugging Techniques

### Enable Verbose Logging

```bash
# Add verbose flag to see detailed output
node src/cli/contentful-cli.js publish always-de --verbose

# Or set environment variable
LOG_LEVEL=DEBUG node src/cli/contentful-cli.js publish always-de
```

### Check Generated Reports

All operations generate detailed JSON reports:

```bash
# Find recent reports
ls -la *validation-report*.json
ls -la *migration-report*.json

# View report content
cat validation-report-always-de-2025-08-04.json | jq .
```

### Test Individual Components

```bash
# Test connectivity
npm test

# Test specific functionality
node tests/test-enhanced-link-cleaning.js
node tests/test-validation-enhancement.js

# Test entry retrieval
node src/utils/get-contentful-entries.js
```

### Network Debugging

```bash
# Test API connectivity
curl -v -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.contentful.com/spaces/YOUR_SPACE_ID

# Check DNS resolution
nslookup api.contentful.com
```

## 📊 Performance Optimization

### Large Dataset Processing

For datasets with 1000+ entries:

1. **Increase Memory**: `--max-old-space-size=8192`
2. **Batch Processing**: Reduce batch sizes
3. **Progressive Processing**: Process in smaller chunks

```bash
# Optimized for large datasets
node --max-old-space-size=8192 src/cli/contentful-cli.js \
  publish-entries-only always-de
```

### Memory Management

Monitor memory usage and optimize:

```javascript
// Check memory usage
console.log(process.memoryUsage());

// Force garbage collection (with --expose-gc flag)
if (global.gc) global.gc();
```

### Network Optimization

For slow networks or international usage:

1. **Increase Timeouts**: Modify retry settings
2. **Regional CDN**: Use appropriate Contentful regions
3. **Connection Pooling**: Enable HTTP keep-alive

## 🧪 Testing & Validation

### Verify Installation

```bash
# Run comprehensive tests
npm run test:all

# Check specific functionality
npm test

# Validate configuration
node -e "console.log(require('dotenv').config())"
```

### Validate Operations

Before running on production data:

```bash
# Test with single entry
node src/cli/contentful-cli.js publish-entries-only test-env

# Run in dry-run mode (if supported)
node src/cli/contentful-advanced-migration.js --entry TEST_ID --dry-run
```

### Monitor Progress

```bash
# Watch log files
tail -f contentful-operations.log

# Monitor system resources
top -p $(pgrep -f "contentful-cli")
```

## 🆘 Getting Help

### Error Analysis

1. **Check Error Messages**: Look for specific error codes (401, 422, 429, etc.)
2. **Review Logs**: Check detailed logging output
3. **Examine Reports**: Review generated JSON reports
4. **Test Components**: Isolate and test individual components

### Reporting Issues

When reporting issues, include:

1. **Error Messages**: Complete error output
2. **Configuration**: Relevant config (sanitized)
3. **Environment**: Node.js version, OS, etc.
4. **Steps**: Exact commands run
5. **Data**: Sample data (if applicable)

### Common Solutions Summary

| Issue | Quick Fix | Detailed Solution |
|-------|-----------|------------------|
| Auth Error | Check `.env` token | [Authentication & Access](#authentication--access) |
| Rate Limit | Wait and retry | [Rate Limiting & Performance](#rate-limiting--performance) |
| Missing Fields | Check reports | [Content & Data Issues](#content--data-issues) |
| Module Error | `npm install` | [Environment & Setup Issues](#environment--setup-issues) |
| Slow Performance | Increase memory | [Performance Optimization](#performance-optimization) |

---

**Last Updated**: August 4, 2025  
**Compatibility**: All Contentful Management Tools v1.0.0+
