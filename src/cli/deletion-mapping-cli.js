/**
 * Entry Deletion Mapping CLI Tool
 *
 * Command-line interface for testing and validating entry deletion mappings
 * without actually deleting anything.
 */

const EntryDeletionProcessor = require("../utils/entry-deletion-processor");
const { getContentfulEnvironment } = require("./contentful-cli");
const logger = require("../utils/logger");

class DeletionMappingCLI {
  constructor() {
    this.processor = new EntryDeletionProcessor();
  }

  /**
   * Show help information
   */
  showHelp() {
    console.log(`
🗑️ Entry Deletion Mapping CLI Tool

USAGE:
  node src/cli/deletion-mapping-cli.js <command> [options]

COMMANDS:
  test <environment>              - Test deletion rules against live data (no actual deletion)
  validate                        - Validate deletion mapping configuration file
  rules [environment]             - List all deletion rules for environment
  summary                         - Show configuration summary
  help                           - Show this help message

ENVIRONMENTS:
  always-de, always-uk, always-fr, mobile-app

EXAMPLES:
  node src/cli/deletion-mapping-cli.js test always-de
  node src/cli/deletion-mapping-cli.js validate
  node src/cli/deletion-mapping-cli.js rules always-uk
  node src/cli/deletion-mapping-cli.js summary
`);
  }

  /**
   * Validate the deletion mapping configuration
   */
  validateConfig() {
    try {
      const summary = this.processor.getRulesSummary();

      console.log("🔍 Validating deletion mapping configuration...\n");

      console.log("✅ Configuration file loaded successfully");
      console.log(`📋 Total rules: ${summary.totalRules}`);
      console.log(`🟢 Enabled rules: ${summary.enabledRules}`);
      console.log(
        `📦 Content types covered: ${summary.contentTypes.join(", ")}`
      );
      console.log(
        `🌍 Environments configured: ${summary.environments.join(", ")}`
      );

      if (summary.enabledRules === 0) {
        console.log("⚠️  Warning: No deletion rules are currently enabled");
      }

      console.log("\n✅ Configuration validation complete");
      return true;
    } catch (error) {
      console.error("❌ Configuration validation failed:", error.message);
      return false;
    }
  }

  /**
   * List deletion rules for environment
   */
  listRules(environment = null) {
    try {
      const allRules = this.processor.config?.deletionRules || [];

      if (allRules.length === 0) {
        console.log("ℹ️  No deletion rules configured");
        return;
      }

      console.log(
        `\n📋 Deletion Rules ${
          environment ? `for ${environment}` : "(All Environments)"
        }\n`
      );

      allRules.forEach((rule, index) => {
        // Filter by environment if specified
        if (
          environment &&
          rule.environments &&
          !rule.environments.includes(environment)
        ) {
          return;
        }

        console.log(`${index + 1}. ${rule.name}`);
        console.log(`   ID: ${rule.id}`);
        console.log(
          `   Status: ${rule.enabled ? "🟢 Enabled" : "🔴 Disabled"}`
        );
        console.log(`   Content Types: ${rule.contentTypes.join(", ")}`);
        console.log(
          `   Environments: ${rule.environments?.join(", ") || "All"}`
        );
        console.log(
          `   Conditions: ${rule.conditions?.operator || "N/A"} logic`
        );

        if (rule.conditions?.rules) {
          rule.conditions.rules.forEach((condition, i) => {
            console.log(
              `     ${i + 1}. ${
                condition.description ||
                condition.field + " " + condition.operator
              }`
            );
          });
        }

        console.log(
          `   Safety: Links=${
            rule.safetyChecks?.checkLinks ? "✅" : "❌"
          }, Skip if referenced=${
            rule.safetyChecks?.skipIfReferenced ? "✅" : "❌"
          }`
        );
        console.log("");
      });
    } catch (error) {
      console.error("❌ Failed to list rules:", error.message);
    }
  }

  /**
   * Test deletion rules against live environment data
   */
  async testDeletionRules(environment) {
    try {
      console.log(
        `🧪 Testing deletion rules against ${environment} environment...\n`
      );

      // Get Contentful environment
      const env = await getContentfulEnvironment(environment);
      console.log("✅ Connected to Contentful environment");

      // Get enabled rules for this environment
      const enabledRules =
        this.processor.getEnabledRulesForEnvironment(environment);
      console.log(
        `📋 Found ${enabledRules.length} enabled rules for ${environment}`
      );

      if (enabledRules.length === 0) {
        console.log(
          "ℹ️  No enabled rules for this environment. Test complete."
        );
        return;
      }

      // Get a sample of entries to test against
      console.log("📥 Fetching sample entries for testing...");
      const sampleEntries = await env.getEntries({ limit: 100 });
      console.log(`📊 Testing against ${sampleEntries.items.length} entries`);

      // Process entries with deletion processor (dry run)
      const deletionCandidates = await this.processor.processEntriesForDeletion(
        sampleEntries.items,
        environment,
        async (entryId) => {
          // Mock link checker for testing - in real scenario this would check actual links
          return { isLinked: false, linkedBy: [] };
        }
      );

      // Display results
      console.log("\n📊 Test Results:");
      console.log(`   Total entries tested: ${sampleEntries.items.length}`);
      console.log(
        `   Entries matching deletion criteria: ${deletionCandidates.length}`
      );
      console.log(
        `   Entries that would be deleted: ${
          deletionCandidates.filter((c) => c.willDelete).length
        }`
      );
      console.log(
        `   Entries skipped due to links: ${
          deletionCandidates.filter((c) => !c.willDelete && c.isLinked).length
        }`
      );

      if (deletionCandidates.length > 0) {
        console.log("\n🎯 Detailed Results:");
        deletionCandidates.forEach((candidate, index) => {
          console.log(
            `${index + 1}. Entry ${candidate.entry.sys.id} (${
              candidate.entry.sys.contentType.sys.id
            })`
          );
          console.log(`   Rule: ${candidate.ruleName}`);
          console.log(`   Reasons: ${candidate.reasons.join(", ")}`);
          console.log(
            `   Would delete: ${candidate.willDelete ? "✅ Yes" : "❌ No"}`
          );
          if (!candidate.willDelete && candidate.isLinked) {
            console.log(`   Skip reason: Referenced by other entries`);
          }
          console.log("");
        });
      }

      console.log("🧪 Test complete - No entries were actually deleted");
    } catch (error) {
      console.error("❌ Test failed:", error.message);
    }
  }

  /**
   * Show configuration summary
   */
  showSummary() {
    try {
      const summary = this.processor.getRulesSummary();
      const envSettings = this.processor.config?.environmentConfig || {};

      console.log("📊 Entry Deletion Mapping Summary\n");

      console.log("📋 Rules Overview:");
      console.log(`   Total rules: ${summary.totalRules}`);
      console.log(`   Enabled rules: ${summary.enabledRules}`);
      console.log(`   Content types: ${summary.contentTypes.join(", ")}`);
      console.log("");

      console.log("🌍 Environment Configuration:");
      Object.entries(envSettings).forEach(([env, config]) => {
        console.log(`   ${env}:`);
        console.log(`     Safe mode: ${config.safeMode ? "✅" : "❌"}`);
        console.log(`     Max deletions: ${config.maxDeletionsPerRun}`);
        console.log(
          `     Require confirmation: ${
            config.requireConfirmationForAll ? "✅" : "❌"
          }`
        );
      });
      console.log("");

      console.log("📁 Configuration file: config/entry-deletion-mappings.json");
      console.log('🔧 Use "npm run deletion-config" for quick status check');
    } catch (error) {
      console.error("❌ Failed to show summary:", error.message);
    }
  }
  /**
   * Main CLI execution
   */
  async run() {
    const args = process.argv.slice(2);
    const command = args[0];
    const environment = args[1];
    switch (command) {
      case "test":
        if (!environment) {
          console.error("❌ Environment required for test command");
          console.log(
            "Usage: node src/cli/deletion-mapping-cli.js test <environment>"
          );
          process.exit(1);
        }
        await this.testDeletionRules(environment);
        break;

      case "validate":
        this.validateConfig();
        break;

      case "rules":
        this.listRules(environment);
        break;

      case "summary":
        this.showSummary();
        break;

      case "help":
      case "--help":
      case "-h":
        this.showHelp();
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        this.showHelp();
        process.exit(1);
    }
  }
}

// Run CLI if executed directly
if (require.main === module) {
  const cli = new DeletionMappingCLI();
  cli.run().catch((error) => {
    console.error("❌ CLI execution failed:", error.message);
    process.exit(1);
  });
}

module.exports = DeletionMappingCLI;
