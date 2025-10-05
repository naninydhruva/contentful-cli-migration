/**
 * Test for the specific error: "Cannot read properties of undefined (reading 'value')"
 * Entry ID: wGgrhu32AdquG5DmLZvBy
 */

console.log("=== Testing Specific Entry Structure Error ===\n");

// Mock logger for testing
const logger = {
  log: (msg) => console.log(`[LOG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
};

// Copy the enhanced hasEntryData function
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

    // Additional validation: ensure fields is actually an object
    if (typeof entry.fields !== "object") {
      logger.warn(
        `Entry ${entryId} has invalid fields type: ${typeof entry.fields}`
      );
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

        // Enhanced validation for field data
        if (fieldData === null || fieldData === undefined) {
          continue;
        }

        // Ensure fieldData is an object before trying to access its properties
        if (typeof fieldData !== "object") {
          logger.warn(
            `Entry ${entryId}, field ${fieldKey}: Field data is not an object (${typeof fieldData}), skipping`
          );
          continue;
        }

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
            // Additional safety check for locale access
            if (!fieldData.hasOwnProperty(locale)) {
              logger.warn(
                `Entry ${entryId}, field ${fieldKey}: Locale ${locale} not accessible, skipping`
              );
              continue;
            }

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
              } // For Link objects, check if they have valid sys.id
              try {
                if (value.sys && value.sys.type === "Link" && value.sys.id) {
                  return true;
                }
              } catch (linkCheckError) {
                logger.warn(
                  `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error checking link object - ${linkCheckError.message}`
                );
                // Continue to check if it's a regular object with properties
              } // For other objects with properties, check if they have meaningful content
              if (objectKeys.length > 0) {
                let hasMeaningfulContent = false;
                for (const objKey of objectKeys) {
                  try {
                    const objValue = value[objKey];
                    // Check if this property has meaningful content
                    if (
                      objValue !== null &&
                      objValue !== undefined &&
                      objValue !== ""
                    ) {
                      // For nested objects, do a basic check
                      if (typeof objValue === "object" && objValue !== null) {
                        try {
                          const nestedKeys = Object.keys(objValue); // Special case: if this looks like an incomplete Link object, treat as not meaningful
                          // Check for direct incomplete Link: { type: "Link", id: undefined }
                          if (objValue.type === "Link" && !objValue.id) {
                            logger.warn(
                              `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Incomplete Link object found (missing id) - direct`
                            );
                            continue; // Skip this property, it's not meaningful
                          }

                          // Check for nested incomplete Link: { sys: { type: "Link", id: undefined } }
                          if (
                            objValue.sys &&
                            objValue.sys.type === "Link" &&
                            !objValue.sys.id
                          ) {
                            logger.warn(
                              `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Incomplete Link object found (missing sys.id) - nested`
                            );
                            continue; // Skip this property, it's not meaningful
                          }

                          // Only consider it meaningful if it has properties with non-null values
                          for (const nestedKey of nestedKeys) {
                            const nestedValue = objValue[nestedKey];
                            if (
                              nestedValue !== null &&
                              nestedValue !== undefined &&
                              nestedValue !== ""
                            ) {
                              // Additional check: if it's an object, make sure it's not empty
                              if (
                                typeof nestedValue === "object" &&
                                nestedValue !== null &&
                                !Array.isArray(nestedValue)
                              ) {
                                try {
                                  const deepNestedKeys =
                                    Object.keys(nestedValue);
                                  if (deepNestedKeys.length === 0) {
                                    continue; // Skip empty objects
                                  }
                                } catch (deepNestedError) {
                                  logger.warn(
                                    `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error checking deep nested object - ${deepNestedError.message}`
                                  );
                                  continue;
                                }
                              }
                              hasMeaningfulContent = true;
                              break;
                            }
                          }
                        } catch (nestedError) {
                          logger.warn(
                            `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error checking nested object - ${nestedError.message}`
                          );
                        }
                      } else {
                        hasMeaningfulContent = true;
                      }
                    }
                    if (hasMeaningfulContent) break;
                  } catch (objPropertyError) {
                    logger.warn(
                      `Entry ${entryId}, field ${fieldKey}, locale ${locale}: Error checking object property ${objKey} - ${objPropertyError.message}`
                    );
                  }
                }
                if (hasMeaningfulContent) {
                  return true;
                }
              }
              continue;
            }

            // If we get here, we have meaningful content (string, number, boolean, etc.)
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

// Test cases that could specifically cause "Cannot read properties of undefined (reading 'value')"
const specificErrorCases = [
  {
    name: "Entry with corrupted field structure that could cause undefined access",
    entry: {
      sys: { id: "wGgrhu32AdquG5DmLZvBy" },
      fields: {
        // Field data that might have undefined properties being accessed
        corruptedField: {
          "en-US": {
            // This structure might have properties that are expected but undefined
            someProperty: undefined,
            anotherProperty: null,
            // Potentially problematic structure
            nested: {
              value: undefined, // This could be the source of the error
            },
          },
        },
      },
    },
    expected: false,
    expectsWarning: false,
  },
  {
    name: "Entry with non-object field data",
    entry: {
      sys: { id: "test-non-object" },
      fields: {
        invalidField: "not an object", // Field data should be an object with locales
        validField: { "en-US": "valid content" },
      },
    },
    expected: true, // Should find the valid field
    expectsWarning: true, // Should warn about the invalid field
  },
  {
    name: "Entry with field that has non-accessible locale",
    entry: {
      sys: { id: "test-locale-access" },
      fields: {
        problematicField: Object.create(null), // Object without hasOwnProperty
      },
    },
    expected: false,
    expectsLog: true,
  },
  {
    name: "Entry with deeply corrupted nested structure",
    entry: {
      sys: { id: "test-deep-corruption" },
      fields: {
        deepField: {
          "en-US": {
            // Simulate a structure that might cause the original error
            sys: {
              type: "Link",
              // Missing id property but trying to access .value somewhere
            },
            // Other properties that might be accessed unsafely
            metadata: {
              // Some undefined reference
            },
          },
        },
      },
    },
    expected: false,
    expectsWarning: false,
  },
  {
    name: "Entry with field data as non-object type",
    entry: {
      sys: { id: "test-field-type" },
      fields: {
        numberField: 123, // Not an object
        booleanField: true, // Not an object
        validField: { "en-US": "content" },
      },
    },
    expected: true, // Should find the valid field
    expectsWarning: true, // Should warn about invalid fields
  },
];

// Function to test the enhanced error handling
async function testSpecificErrorHandling(testCases) {
  console.log("=== Testing Enhanced Error Handling for Specific Cases ===\n");

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
      const result = hasEntryData(testCase.entry);
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

  console.log(`=== Specific Error Handling Test Results ===`);
  console.log(`Passed: ${passedTests}/${totalTests}`);

  if (passedTests === totalTests) {
    console.log("🎉 All specific error handling tests passed!");
    console.log(
      "✅ Enhanced validation should prevent 'Cannot read properties of undefined' errors"
    );
    console.log("✅ Function handles corrupted entry structures safely");
    console.log("✅ Type validation prevents unsafe property access");
  } else {
    console.log(
      "❌ Some specific error tests failed. Check the implementation."
    );
  }

  return { passedTests, totalTests };
}

// Run the tests
async function runSpecificTests() {
  const results = await testSpecificErrorHandling(specificErrorCases);

  console.log("\n=== Additional Safety Features Added ===");
  console.log("✅ Type validation for fields object");
  console.log("✅ Type validation for field data objects");
  console.log("✅ hasOwnProperty checks for locale access");
  console.log("✅ Enhanced link object validation with try-catch");
  console.log("✅ Safe handling of non-object field data");
  console.log("✅ Additional logging for debugging corrupted structures");

  if (results.passedTests === results.totalTests) {
    console.log(
      "\n🎉 Enhanced hasEntryData function should now handle entry wGgrhu32AdquG5DmLZvBy!"
    );
    console.log(
      "✅ The 'Cannot read properties of undefined (reading 'value')' error should be resolved"
    );
  }
}

runSpecificTests().catch(console.error);
