/**
 * Test enhanced exception handling for hasEntryData function
 */

console.log("=== Testing Enhanced hasEntryData Exception Handling ===\n");

// Mock logger for testing
const logger = {
  log: (msg) => console.log(`[LOG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
};

// Copy the enhanced hasEntryData function for testing
function hasEntryData(entry) {
  try {
    // Validate entry object structure
    if (!entry) {
      logger.warn("hasEntryData: Entry object is null or undefined");
      return false;
    }

    if (!entry.sys) {
      logger.warn("hasEntryData: Entry missing sys object");
      return false;
    }

    if (!entry.sys.id) {
      logger.warn("hasEntryData: Entry missing sys.id");
      return false;
    }

    const entryId = entry.sys.id;

    if (!entry.fields) {
      logger.log(`Entry ${entryId} has no fields object`);
      return false;
    }

    // Safely get field keys
    let fieldKeys;
    try {
      fieldKeys = Object.keys(entry.fields);
    } catch (fieldKeysError) {
      logger.error(
        `Entry ${entryId}: Error accessing fields object - ${fieldKeysError.message}`
      );
      return false;
    }

    if (fieldKeys.length === 0) {
      logger.log(`Entry ${entryId} has no fields`);
      return false;
    }

    // Check if any field has meaningful content
    for (const fieldKey of fieldKeys) {
      try {
        const fieldData = entry.fields[fieldKey];
        if (!fieldData) continue;

        // Safely get locale keys
        let localeKeys;
        try {
          localeKeys = Object.keys(fieldData);
        } catch (localeError) {
          logger.warn(
            `Entry ${entryId}, field ${fieldKey}: Error accessing locales - ${localeError.message}`
          );
          continue;
        }

        // Check each locale for this field
        for (const locale of localeKeys) {
          try {
            const value = fieldData[locale];

            // Skip null, undefined, empty strings
            if (value === null || value === undefined || value === "") {
              continue;
            }

            // Skip empty arrays
            if (Array.isArray(value) && value.length === 0) {
              continue;
            }

            // Skip empty objects (but allow objects with properties)
            if (
              typeof value === "object" &&
              value !== null &&
              !Array.isArray(value)
            ) {
              let objectKeys;
              try {
                objectKeys = Object.keys(value);
              } catch (objectError) {
                logger.warn(
                  `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error accessing object keys - ${objectError.message}`
                );
                continue;
              }

              if (objectKeys.length === 0) {
                continue;
              }

              // For Link objects, check if they have valid sys.id
              if (value.sys && value.sys.type === "Link" && value.sys.id) {
                return true;
              }

              // For other objects with properties
              if (objectKeys.length > 0) {
                return true;
              }
              continue;
            }

            // If we get here, we have meaningful content
            return true;
          } catch (valueError) {
            logger.warn(
              `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error processing value - ${valueError.message}`
            );
            continue;
          }
        }
      } catch (fieldError) {
        logger.warn(
          `Entry ${entryId}, field ${fieldKey}: Error processing field - ${fieldError.message}`
        );
        continue;
      }
    }

    logger.log(`Entry ${entryId} has no meaningful data in any field`);
    return false;
  } catch (error) {
    const entryId = entry?.sys?.id || "unknown";
    logger.error(
      `hasEntryData: Unexpected error processing entry ${entryId} - ${error.message}`
    );
    // Return false on error to be safe (don't process potentially corrupted entries)
    return false;
  }
}

// Test cases for exception handling
const exceptionTestCases = [
  {
    name: "Null entry",
    entry: null,
    expected: false,
    expectsWarning: true,
  },
  {
    name: "Undefined entry",
    entry: undefined,
    expected: false,
    expectsWarning: true,
  },
  {
    name: "Entry without sys object",
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
    name: "Entry with null fields",
    entry: { sys: { id: "test1" }, fields: null },
    expected: false,
    expectsLog: true,
  },
  {
    name: "Entry with valid data",
    entry: {
      sys: { id: "test2" },
      fields: {
        title: { "en-US": "Valid Title" },
      },
    },
    expected: true,
    expectsLog: false,
  },
  {
    name: "Entry with empty fields object",
    entry: {
      sys: { id: "test3" },
      fields: {},
    },
    expected: false,
    expectsLog: true,
  },
  {
    name: "Entry with all empty values",
    entry: {
      sys: { id: "test4" },
      fields: {
        title: { "en-US": "" },
        description: { "en-US": null },
        tags: { "en-US": [] },
      },
    },
    expected: false,
    expectsLog: true,
  },
  {
    name: "Entry with Link object",
    entry: {
      sys: { id: "test5" },
      fields: {
        linkedEntry: {
          "en-US": {
            sys: { type: "Link", linkType: "Entry", id: "linked-entry-123" },
          },
        },
      },
    },
    expected: true,
    expectsLog: false,
  },
  {
    name: "Entry with object having properties",
    entry: {
      sys: { id: "test6" },
      fields: {
        metadata: {
          "en-US": {
            author: "John Doe",
            timestamp: "2025-01-01",
          },
        },
      },
    },
    expected: true,
    expectsLog: false,
  },
];

let passedTests = 0;
let totalTests = exceptionTestCases.length;

console.log("Running enhanced exception handling tests...\n");

for (const testCase of exceptionTestCases) {
  console.log(`Test: ${testCase.name}`);

  // Capture console output to check for warnings/errors
  const originalConsoleLog = console.log;
  let logOutput = [];
  console.log = (message) => {
    logOutput.push(message);
    originalConsoleLog(message);
  };

  try {
    const result = hasEntryData(testCase.entry);
    const passed = result === testCase.expected;

    console.log = originalConsoleLog; // Restore console.log

    console.log(`  Expected: ${testCase.expected}, Got: ${result}`);

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
    console.log(`  Result: ${finalResult ? "✅ PASS" : "❌ FAIL"}\n`);

    if (finalResult) passedTests++;
  } catch (error) {
    console.log = originalConsoleLog; // Restore console.log
    console.log(`  Error: ${error.message}`);
    console.log(`  Result: ❌ FAIL\n`);
  }
}

console.log(`=== Exception Handling Test Results ===`);
console.log(`Passed: ${passedTests}/${totalTests}`);

if (passedTests === totalTests) {
  console.log("🎉 All exception handling tests passed!");
  console.log("✅ hasEntryData function now handles all edge cases safely.");
  console.log("✅ Proper logging for different error scenarios implemented.");
  console.log(
    "✅ Function returns false for corrupted/invalid entries (safe default)."
  );
} else {
  console.log(
    "❌ Some exception handling tests failed. Check the implementation."
  );
}

console.log("\n=== Key Improvements ===");
console.log("✅ Null/undefined entry handling");
console.log("✅ Missing sys object validation");
console.log("✅ Missing sys.id validation");
console.log("✅ Safe Object.keys() calls with try-catch");
console.log("✅ Individual field processing error isolation");
console.log("✅ Locale processing error isolation");
console.log("✅ Object property access error handling");
console.log("✅ Comprehensive logging for debugging");
console.log("✅ Safe fallback (return false) on any unexpected error");
