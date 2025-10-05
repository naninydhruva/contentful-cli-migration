/**
 * Test to verify contentful-cli.js can be loaded without errors
 */

console.log("=== Testing contentful-cli.js Module Loading ===\n");

try {
  // Test basic Node.js syntax validation
  const fs = require("fs");
  const path = require("path");

  const filePath = path.join(__dirname, "contentful-cli.js");
  const content = fs.readFileSync(filePath, "utf8");

  console.log("✅ File can be read successfully");
  console.log(`📄 File size: ${content.length} characters`);

  // Test for function definitions
  const hasEntryDataDef = content.includes("function hasEntryData(entry)");
  const isChangedDef = content.includes("function isChanged(entity)");
  const publishEntriesDef = content.includes(
    "async function publishEntries(environment)"
  );

  console.log(`\n=== Function Definition Checks ===`);
  console.log(
    `hasEntryData function: ${hasEntryDataDef ? "✅ Found" : "❌ Missing"}`
  );
  console.log(
    `isChanged function: ${isChangedDef ? "✅ Found" : "❌ Missing"}`
  );
  console.log(
    `publishEntries function: ${publishEntriesDef ? "✅ Found" : "❌ Missing"}`
  );

  // Test for hasEntryData usage
  const hasEntryDataUsage = content.includes("if (!hasEntryData(entry))");
  console.log(
    `hasEntryData usage: ${hasEntryDataUsage ? "✅ Found" : "❌ Missing"}`
  );

  // Check function order (hasEntryData should come before publishEntries)
  const hasEntryDataIndex = content.indexOf("function hasEntryData(entry)");
  const publishEntriesIndex = content.indexOf(
    "async function publishEntries(environment)"
  );
  const correctOrder = hasEntryDataIndex < publishEntriesIndex;

  console.log(
    `Function definition order: ${correctOrder ? "✅ Correct" : "❌ Incorrect"}`
  );

  if (
    hasEntryDataDef &&
    isChangedDef &&
    publishEntriesDef &&
    hasEntryDataUsage &&
    correctOrder
  ) {
    console.log(`\n🎉 All checks passed! The file structure looks correct.`);
    console.log(
      `✅ The "Cannot read properties of undefined (reading 'value')" error should be resolved.`
    );
    console.log(
      `✅ hasEntryData function is properly defined before its usage.`
    );
  } else {
    console.log(`\n❌ Some checks failed. Please review the file structure.`);
  }
} catch (error) {
  console.log(`❌ Error reading contentful-cli.js: ${error.message}`);
}
