# Cross-Space Asset Migration

## Overview

The Cross-Space Asset Migration feature enables automatic migration of assets that reference files from different Contentful spaces. This is particularly useful when migrating content between spaces where assets may have been copied or referenced from other spaces.

## How It Works

### Problem Solved
When migrating assets between Contentful spaces, you may encounter the error:
```
"The file URL must reference the asset being processed/published. It cannot reference an asset from another space."
```

This happens when an asset's file URL points to a different Contentful space than the target space.

### Solution
The cross-space migration feature automatically:

1. **Detects cross-space URLs** - Identifies when asset file URLs reference different spaces
2. **Downloads files** - Downloads the original files from the source space URLs
3. **Uploads to target space** - Re-uploads files using Contentful's Upload API
4. **Updates asset references** - Updates the asset with new URLs pointing to the target space
5. **Processes normally** - Continues with standard asset processing

## Usage

### Command Line Options

```bash
# Enable cross-space migration (default)
--enable-cross-space-migration

# Disable cross-space migration
--disable-cross-space-migration
```

### Examples

```bash
# Migrate assets with cross-space migration enabled (default)
node cf-source-target-cli.js --migration-type asset --asset-ids abc123,def456

# Explicitly enable cross-space migration
node cf-source-target-cli.js --migration-type asset --asset-ids abc123 --enable-cross-space-migration

# Disable cross-space migration
node cf-source-target-cli.js --migration-type asset --asset-ids abc123 --disable-cross-space-migration

# Migrate with verbose logging to see migration details
node cf-source-target-cli.js --migration-type asset --asset-ids abc123 --enable-cross-space-migration --verbose
```

## Configuration

### Environment Variables Required

```env
# Source space configuration
SPACE_ID_EN_GB=your-source-space-id
ENV_EN_GB=your-source-environment

# Target space configuration  
SPACE_ID_FR_FR=your-target-space-id
ENV_FR_FR=your-target-environment

# Authentication
CONTENTFUL_MANAGEMENT_TOKEN=your-management-token
```

### Default Settings

```javascript
{
  enableCrossSpaceMigration: true,  // Enabled by default
  verbose: false,
  rateLimitDelay: 500,
  maxRetries: 5
}
```

## Technical Details

### Detection Logic

Cross-space URLs are detected by checking if:
1. The URL contains `ctfassets.net` (Contentful CDN)
2. The URL does not contain the target space ID

Examples:
```javascript
// Cross-space URL (will be migrated)
"//images.ctfassets.net/source-space-id/asset-id/filename.jpg"

// Same-space URL (no migration needed)
"//images.ctfassets.net/target-space-id/asset-id/filename.jpg"

// External URL (no migration needed)
"//example.com/path/to/file.jpg"
```

### Migration Process

1. **URL Analysis**: Check each file URL in each locale
2. **File Download**: Use Node.js `https`/`http` modules to download files
3. **File Upload**: Use Contentful Upload API to upload to target space
4. **Asset Update**: Update asset fields with new URLs
5. **Asset Processing**: Continue with normal Contentful asset processing

### Error Handling

The feature handles various error scenarios:

- **Already processed files**: Skips processing if files are already processed
- **Cross-space errors**: Automatically migrates and retries
- **Download failures**: Reports errors with detailed logging
- **Upload failures**: Reports API errors with retry logic
- **Network timeouts**: Implements retry with exponential backoff

## Logging and Monitoring

### Verbose Output

When `--verbose` is enabled, you'll see detailed logs:

```
[INFO] Detected cross-space URL for asset abc123, locale en-US: //images.ctfassets.net/old-space/file.jpg
[INFO] Downloading file from: https://images.ctfassets.net/old-space/file.jpg
[INFO] Downloaded 156789 bytes for file.jpg (image/jpeg)
[INFO] Successfully migrated file to target space: //uploads.ctfassets.net/new-space/upload-id/file.jpg
[SUCCESS] Updated asset abc123 locale en-US with new URL
[INFO] Updating asset abc123 with migrated file URLs...
[SUCCESS] Asset abc123 created and processed successfully
```

### Error Messages

Common error patterns and their meanings:

```
Cross-space URL error details: The file URL must reference the asset being processed
→ Indicates successful detection and handling of cross-space URLs

Failed to download file: HTTP 404
→ Source file no longer exists or URL is incorrect

Upload failed: HTTP 403 - Forbidden
→ Check your management token permissions

Rate limit exceeded after 5 retries
→ Contentful API rate limits hit; script will retry automatically
```

## Limitations and Considerations

### Performance
- File downloads/uploads add time to migration process
- Large files will take longer to migrate
- Rate limiting may slow down bulk migrations

### File Size Limits
- Contentful Upload API has file size limits
- Very large assets may fail to upload

### Network Dependencies
- Requires stable internet connection
- Source files must be accessible via HTTP/HTTPS

### Permissions
- Management token must have upload permissions
- Source space files must be publicly accessible

## Troubleshooting

### Common Issues

**Issue**: Cross-space migration not working
**Solution**: Check that `--enable-cross-space-migration` is set (it's enabled by default)

**Issue**: Download failures
**Solution**: Verify source URLs are accessible and files exist

**Issue**: Upload failures  
**Solution**: Check management token permissions and target space configuration

**Issue**: Processing timeouts
**Solution**: Use `--verbose` to see detailed progress and identify bottlenecks

### Testing

Run the test suite to validate functionality:

```bash
node test-cross-space-migration.js
```

This will validate:
- Configuration setup
- URL detection logic
- Command line argument parsing
- Error handling scenarios

## Integration with Existing Features

The cross-space migration feature integrates seamlessly with:

- **Content type mapping**: Works with field mappings and transformations
- **Batch processing**: Handles multiple assets efficiently  
- **Rate limiting**: Respects Contentful API limits
- **Error recovery**: Continues processing other assets if one fails
- **Publishing**: Assets are published normally after migration

## Future Enhancements

Potential improvements for future versions:

- **Parallel processing**: Download/upload multiple files simultaneously
- **File caching**: Cache downloaded files to avoid re-downloading
- **Progress indicators**: Show transfer progress for large files
- **Selective migration**: Choose which cross-space URLs to migrate
- **Backup creation**: Create backups before modifying assets
