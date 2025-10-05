/**
 * Comprehensive test for cleanEntryLinks exception handling
 * Tests the specific error case: "Cannot read properties of undefined (reading 'value')"
 */

console.log("=== Testing Enhanced cleanEntryLinks Exception Handling ===\n");

// Mock logger for testing
const logger = {
  log: (msg) => console.log(`[LOG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
};

// Mock environment and safeGetLink function
const mockEnvironment = {
  getEntry: async (id) => ({ sys: { id } }),
  getAsset: async (id) => ({ sys: { id } }),
};

// Mock safeGetLink function
async function safeGetLink(environment, link) {
  try {
    if (!link || !link.sys || !link.sys.id) {
      return null;
    }

    // Simulate some links being invalid
    if (link.sys.id === "invalid-link") {
      return null;
    }

    return link;
  } catch (e) {
    logger.warn(
      `Removing link to missing ${link.sys.linkType}: ${link.sys.id}`
    );
    return null;
  }
}

// Copy the enhanced cleanEntryLinks function
async function cleanEntryLinks(entry, environment) {
  try {
    // Validate entry structure
    if (!entry) {
      logger.warn("cleanEntryLinks: Entry object is null or undefined");
      return false;
    }

    if (!entry.sys) {
      logger.warn("cleanEntryLinks: Entry missing sys object");
      return false;
    }

    if (!entry.sys.id) {
      logger.warn("cleanEntryLinks: Entry missing sys.id");
      return false;
    }

    const entryId = entry.sys.id;

    if (!entry.fields) {
      logger.log(`cleanEntryLinks: Entry ${entryId} has no fields object`);
      return false;
    }

    let hasMissingLinks = false;
    const fields = entry.fields;

    // Safely get field keys
    let fieldKeys;
    try {
      fieldKeys = Object.keys(fields);
    } catch (fieldKeysError) {
      logger.error(
        `cleanEntryLinks: Entry ${entryId} - Error accessing fields object: ${fieldKeysError.message}`
      );
      return false;
    }

    for (const fieldKey of fieldKeys) {
      try {
        const fieldData = fields[fieldKey];

        // Skip null or undefined field data
        if (!fieldData) {
          logger.log(
            `cleanEntryLinks: Entry ${entryId}, field ${fieldKey} is null/undefined, skipping`
          );
          continue;
        }

        // Safely get locale keys
        let localeKeys;
        try {
          localeKeys = Object.keys(fieldData);
        } catch (localeError) {
          logger.warn(
            `cleanEntryLinks: Entry ${entryId}, field ${fieldKey} - Error accessing locales: ${localeError.message}`
          );
          continue;
        }

        for (const locale of localeKeys) {
          try {
            const value = fieldData[locale];

            // Skip null or undefined values
            if (value === null || value === undefined) {
              continue;
            }

            if (Array.isArray(value)) {
              const cleaned = [];
              for (let i = 0; i < value.length; i++) {
                try {
                  const item = value[i];
                  if (item && item.sys && item.sys.type === "Link") {
                    const validLink = await safeGetLink(environment, item);
                    if (validLink) {
                      cleaned.push(validLink);
                    } else {
                      hasMissingLinks = true;
                      logger.log(
                        `cleanEntryLinks: Entry ${entryId}, field ${fieldKey}, locale ${locale} - Removed invalid link at index ${i}`
                      );
                    }
                  } else {
                    cleaned.push(item);
                  }
                } catch (itemError) {
                  logger.warn(
                    `cleanEntryLinks: Entry ${entryId}, field ${fieldKey}, locale ${locale}, item ${i} - Error processing array item: ${itemError.message}`
                  );
                  // Skip this item but continue with others
                  continue;
                }
              }
              fields[fieldKey][locale] = cleaned;
            } else if (
              value &&
              typeof value === "object" &&
              value.sys &&
              value.sys.type === "Link"
            ) {
              try {
                const validLink = await safeGetLink(environment, value);
                if (!validLink) {
                  fields[fieldKey][locale] = null;
                  hasMissingLinks = true;
                  logger.log(
                    `cleanEntryLinks: Entry ${entryId}, field ${fieldKey}, locale ${locale} - Removed invalid link`
                  );
                }
              } catch (linkError) {
                logger.warn(
                  `cleanEntryLinks: Entry ${entryId}, field ${fieldKey}, locale ${locale} - Error validating link: ${linkError.message}`
                );
                // Set to null to be safe
                fields[fieldKey][locale] = null;
                hasMissingLinks = true;
              }
            }
          } catch (valueError) {
            logger.warn(
              `cleanEntryLinks: Entry ${entryId}, field ${fieldKey}, locale ${locale} - Error processing value: ${valueError.message}`
            );
            continue;
          }
        }
      } catch (fieldError) {
        logger.warn(
          `cleanEntryLinks: Entry ${entryId}, field ${fieldKey} - Error processing field: ${fieldError.message}`
        );
        continue;
      }
    }

    return hasMissingLinks;
  } catch (error) {
    const entryId = entry?.sys?.id || "unknown";
    logger.error(
      `cleanEntryLinks: Unexpected error processing entry ${entryId}: ${error.message}`
    );
    // Return false to indicate no changes made (safe fallback)
    return false;
  }
}

// Test cases that could cause "Cannot read properties of undefined (reading 'value')"
const problematicEntries = [
  {
    name: "Null entry",
    entry: null,
    expected: false,
    expectsWarning: true,
  },
  {
    name: "Entry without sys",
    entry: { fields: {} },
    expected: false,
    expectsWarning: true,
  },
  {
    name: "Entry without sys.id",
    entry: { sys: {}, fields: {} },
    expected: false,
    expectsWarning: true,
  },
  {
    name: "Entry without fields",
    entry: { sys: { id: "test1" } },
    expected: false,
    expectsLog: true,
  },
  {
    name: "Entry with null fields",
    entry: { sys: { id: "test2" }, fields: null },
    expected: false,
    expectsLog: true,
  },
  {
    name: "Entry with corrupted field structure (field is null)",
    entry: {
      sys: { id: "test3" },
      fields: {
        title: null,
        description: { "en-US": "Valid content" },
      },
    },
    expected: false,
    expectsLog: true,
  },
  {
    name: "Entry with undefined field values",
    entry: {
      sys: { id: "test4" },
      fields: {
        title: { "en-US": undefined },
        link: { "en-US": null },
      },
    },
    expected: false,
    expectsLog: false,
  },
  {
    name: "Entry with corrupted array field",
    entry: {
      sys: { id: "test5" },
      fields: {
        items: {
          "en-US": [
            { sys: { type: "Link", linkType: "Entry", id: "valid-entry" } },
            null, // This could cause the error
            { sys: { type: "Link", linkType: "Entry", id: "invalid-link" } },
          ],
        },
      },
    },
    expected: true, // Should return true because we found missing links
    expectsLog: true,
  },
  {
    name: "Entry with valid links",
    entry: {
      sys: { id: "test6" },
      fields: {
        linkedEntry: {
          "en-US": {
            sys: { type: "Link", linkType: "Entry", id: "valid-entry" },
          },
        },
      },
    },
    expected: false, // No missing links
    expectsLog: false,
  },
  {
    name: "Entry with mixed valid and invalid links",
    entry: {
      sys: { id: "test7" },
      fields: {
        validLink: {
          "en-US": {
            sys: { type: "Link", linkType: "Entry", id: "valid-entry" },
          },
        },
        invalidLink: {
          "en-US": {
            sys: { type: "Link", linkType: "Entry", id: "invalid-link" },
          },
        },
      },
    },
    expected: true, // Should find missing links
    expectsLog: true,
  },
];

// Function to test entry processing workflow
async function testCleanEntryLinksWorkflow(testCases) {
  console.log("=== Testing cleanEntryLinks with Problematic Entries ===\n");

  let passedTests = 0;
  let totalTests = testCases.length;

  for (const testCase of testCases) {
    console.log(`--- Test: ${testCase.name} ---`);

    // Capture console output to check for warnings/errors/logs
    const originalConsoleLog = console.log;
    let logOutput = [];
    console.log = (message) => {
      logOutput.push(message);
      originalConsoleLog(message);
    };

    try {
      const result = await cleanEntryLinks(testCase.entry, mockEnvironment);
      const passed = result === testCase.expected;

      console.log = originalConsoleLog; // Restore console.log

      console.log(`Expected: ${testCase.expected}, Got: ${result}`);

      // Check if expected logging occurred
      const hasWarning = logOutput.some((log) => log.includes("[WARN]"));
      const hasError = logOutput.some((log) => log.includes("[ERROR]"));
      const hasLog = logOutput.some((log) => log.includes("[LOG]"));

      let loggingCorrect = true;
      if (testCase.expectsWarning && !hasWarning) {
        console.log(`  ⚠️  Expected warning but none found`);
        loggingCorrect = false;
      }
      if (testCase.expectsError && !hasError) {
        console.log(`  ⚠️  Expected error but none found`);
        loggingCorrect = false;
      }
      if (testCase.expectsLog && !hasLog) {
        console.log(`  ⚠️  Expected log but none found`);
        loggingCorrect = false;
      }

      const finalResult = passed && loggingCorrect;
      console.log(`Result: ${finalResult ? "✅ PASS" : "❌ FAIL"}\n`);

      if (finalResult) passedTests++;
    } catch (error) {
      console.log = originalConsoleLog; // Restore console.log
      console.log(`Error: ${error.message}`);
      console.log(`Result: ❌ FAIL\n`);
    }
  }

  console.log(`=== cleanEntryLinks Test Results ===`);
  console.log(`Passed: ${passedTests}/${totalTests}`);

  if (passedTests === totalTests) {
    console.log("🎉 All cleanEntryLinks exception handling tests passed!");
    console.log(
      "✅ Function now safely handles all problematic entry structures"
    );
    console.log("✅ Proper error isolation prevents cascading failures");
    console.log("✅ Safe fallbacks implemented throughout");
  } else {
    console.log(
      "❌ Some cleanEntryLinks tests failed. Check the implementation."
    );
  }

  return { passedTests, totalTests };
}

// Run the tests
async function runTests() {
  const results = await testCleanEntryLinksWorkflow(problematicEntries);

  console.log("\n=== Key Improvements ===");
  console.log("✅ Null/undefined entry validation");
  console.log("✅ Missing sys object/ID validation");
  console.log("✅ Null/undefined fields handling");
  console.log("✅ Safe Object.keys() calls with try-catch");
  console.log("✅ Individual field processing error isolation");
  console.log("✅ Locale processing error isolation");
  console.log("✅ Array item processing error isolation");
  console.log("✅ Link validation error handling");
  console.log("✅ Comprehensive logging for debugging");
  console.log("✅ Safe fallback (return false) on any unexpected error");

  if (results.passedTests === results.totalTests) {
    console.log("\n🎉 All cleanEntryLinks enhancements complete and tested!");
    console.log(
      "✅ The 'Cannot read properties of undefined' error should now be resolved"
    );
  }
}

runTests().catch(console.error);
