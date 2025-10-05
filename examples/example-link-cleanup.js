/**
 * Example usage of the Link Cleanup CLI
 * This file demonstrates how to use the cf-link-cleanup.js script
 */

console.log("📖 Link Cleanup CLI - Usage Examples");
console.log("=".repeat(50));

console.log("\n🎯 Basic Usage Examples:");

console.log("\n1️⃣ Scan for broken links (safe, no changes):");
console.log("   node cf-link-cleanup.js scan");
console.log(
  "   → This will analyze your entries and show what broken links exist"
);

console.log("\n2️⃣ Clean broken links (updates entries):");
console.log("   node cf-link-cleanup.js clean --dry-run");
console.log("   → First, see what would be cleaned without making changes");
console.log("   \n   node cf-link-cleanup.js clean");
console.log("   → Actually clean the broken links");

console.log("\n3️⃣ Clean and publish entries:");
console.log("   node cf-link-cleanup.js clean-and-publish");
console.log("   → Clean broken links AND publish the updated entries");

console.log("\n🎯 Advanced Usage Examples:");

console.log("\n4️⃣ Filter by content type:");
console.log(
  "   node cf-link-cleanup.js scan --content-type articleListGeneral"
);
console.log("   → Only process entries of the specified content type");

console.log("\n5️⃣ Process specific space/environment:");
console.log(
  "   node cf-link-cleanup.js clean --space-id abc123 --env-id master"
);
console.log("   → Target a specific Contentful space and environment");

console.log("\n6️⃣ Limit processing for testing:");
console.log("   node cf-link-cleanup.js scan --max-entries 50 --batch-size 5");
console.log("   → Process only 50 entries in batches of 5");

console.log("\n🛡️ Safety Features:");

console.log("\n   ✅ Always start with scanning:");
console.log("      node cf-link-cleanup.js scan");

console.log("\n   ✅ Use dry-run before making changes:");
console.log("      node cf-link-cleanup.js clean --dry-run");

console.log("\n   ✅ Process small batches first:");
console.log("      node cf-link-cleanup.js clean --max-entries 10");

console.log("\n📊 What the CLI Does:");

console.log("\n   🔍 Scans entries for link objects");
console.log("   🔗 Validates each link by checking if the target exists");
console.log("   🧹 Removes broken links (404 errors) while keeping valid ones");
console.log("   💾 Updates entries with cleaned links");
console.log("   📤 Optionally publishes the updated entries");
console.log("   📋 Provides detailed reports on what was found and cleaned");

console.log("\n⚠️  Important Notes:");

console.log("\n   • Always test with --dry-run first");
console.log("   • Start with small --max-entries values");
console.log("   • Monitor the logs for any errors");
console.log("   • The CLI preserves valid links and non-link content");
console.log("   • Rate limiting is handled automatically");

console.log("\n🔧 Troubleshooting:");

console.log("\n   Rate limit errors:");
console.log("   → Use --batch-size 3 --max-entries 50");

console.log("\n   Large number of broken links:");
console.log("   → Start with: node cf-link-cleanup.js scan --max-entries 100");

console.log("\n   Testing on specific content:");
console.log("   → Use: --content-type yourContentType --max-entries 10");

console.log("\n🎉 Ready to start? Run this command:");
console.log("   node cf-link-cleanup.js scan --max-entries 10");
console.log("\n" + "=".repeat(50));

// Example of programmatic usage (if you want to use it in other scripts)
console.log("\n💻 Programmatic Usage Example:");
console.log(`
const { runLinkCleanup } = require('./cf-link-cleanup');

async function myCustomCleanup() {
  try {
    // Scan for broken links
    await runLinkCleanup('scan', {
      spaceId: 'your-space-id',
      envId: 'master',
      maxEntries: 100,
      contentType: 'article'
    });
    
    // Clean broken links
    await runLinkCleanup('clean', {
      spaceId: 'your-space-id', 
      envId: 'master',
      maxEntries: 100,
      dryRun: false
    });
    
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

myCustomCleanup();
`);
