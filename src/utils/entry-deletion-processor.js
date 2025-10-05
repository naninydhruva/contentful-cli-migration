/**
 * Entry Deletion Mapping Processor
 *
 * This module handles the evaluation of entries against deletion criteria
 * defined in the entry-deletion-mappings.json configuration file.
 */

const fs = require("fs");
const path = require("path");
const logger = require("./logger");

class EntryDeletionProcessor {
  constructor(configPath = null) {
    this.configPath =
      configPath ||
      path.join(__dirname, "../../config/entry-deletion-mappings.json");
    this.config = null;
    this.loadConfig();
  }

  /**
   * Load deletion mapping configuration
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, "utf8");
        this.config = JSON.parse(configData);
        logger.info(`✅ Loaded entry deletion config from ${this.configPath}`);
      } else {
        logger.warn(`⚠️ Entry deletion config not found at ${this.configPath}`);
        this.config = { deletionRules: [], globalSettings: {} };
      }
    } catch (error) {
      logger.error(`❌ Failed to load entry deletion config: ${error.message}`);
      this.config = { deletionRules: [], globalSettings: {} };
    }
  }

  /**
   * Check if an entry should be deleted based on configured rules
   * @param {Object} entry - Contentful entry object
   * @param {string} environment - Current environment (e.g., 'always-de')
   * @returns {Object} - { shouldDelete: boolean, reasons: string[], ruleId: string }
   */
  shouldDeleteEntry(entry, environment) {
    const result = {
      shouldDelete: false,
      reasons: [],
      ruleId: null,
      ruleName: null,
    };

    if (!this.config || !this.config.deletionRules) {
      return result;
    }

    const contentType = entry.sys.contentType.sys.id;

    // Check each deletion rule
    for (const rule of this.config.deletionRules) {
      if (!rule.enabled) {
        continue;
      }

      // Check if rule applies to this environment
      if (rule.environments && !rule.environments.includes(environment)) {
        continue;
      }

      // Check if rule applies to this content type
      if (!this.isContentTypeMatch(contentType, rule.contentTypes)) {
        continue;
      }

      // Evaluate conditions
      const conditionResult = this.evaluateConditions(entry, rule.conditions);

      if (conditionResult.matches) {
        result.shouldDelete = true;
        result.reasons = conditionResult.reasons;
        result.ruleId = rule.id;
        result.ruleName = rule.name;
        result.safetyChecks = rule.safetyChecks || {};
        break; // First matching rule wins
      }
    }

    return result;
  }

  /**
   * Check if content type matches rule criteria
   * @param {string} contentType - Entry content type
   * @param {string[]} ruleContentTypes - Rule content types (supports wildcard *)
   * @returns {boolean}
   */
  isContentTypeMatch(contentType, ruleContentTypes) {
    if (!ruleContentTypes || ruleContentTypes.length === 0) {
      return false;
    }

    return ruleContentTypes.some(
      (ruleType) => ruleType === "*" || ruleType === contentType
    );
  }

  /**
   * Evaluate deletion conditions for an entry
   * @param {Object} entry - Contentful entry
   * @param {Object} conditions - Rule conditions
   * @returns {Object} - { matches: boolean, reasons: string[] }
   */
  evaluateConditions(entry, conditions) {
    const result = { matches: false, reasons: [] };

    if (!conditions || !conditions.rules) {
      return result;
    }

    const operator = conditions.operator || "AND";
    const evaluatedRules = conditions.rules.map((rule) =>
      this.evaluateRule(entry, rule)
    );

    if (operator === "AND") {
      result.matches = evaluatedRules.every((r) => r.matches);
      if (result.matches) {
        result.reasons = evaluatedRules.map((r) => r.reason).filter(Boolean);
      }
    } else if (operator === "OR") {
      result.matches = evaluatedRules.some((r) => r.matches);
      if (result.matches) {
        result.reasons = evaluatedRules
          .filter((r) => r.matches)
          .map((r) => r.reason);
      }
    }

    return result;
  }

  /**
   * Evaluate a single rule condition
   * @param {Object} entry - Contentful entry
   * @param {Object} rule - Single rule condition
   * @returns {Object} - { matches: boolean, reason: string }
   */
  evaluateRule(entry, rule) {
    const result = { matches: false, reason: "" };

    // Handle nested AND/OR rules
    if (rule.operator === "AND" || rule.operator === "OR") {
      const nestedResult = this.evaluateConditions(entry, rule);
      return {
        matches: nestedResult.matches,
        reason: nestedResult.reasons.join(", "),
      };
    }

    const { field, operator, value, description } = rule;

    try {
      const fieldValue = this.getFieldValue(entry, field);
      result.matches = this.evaluateOperator(
        fieldValue,
        operator,
        value,
        entry
      );

      if (result.matches) {
        result.reason = description || `${field} ${operator} ${value || ""}`;
      }
    } catch (error) {
      logger.warn(`Error evaluating rule for field ${field}: ${error.message}`);
      result.matches = false;
    }

    return result;
  }

  /**
   * Get field value from entry, supporting nested paths and locales
   * @param {Object} entry - Contentful entry
   * @param {string} fieldPath - Field path (e.g., 'title', 'sys.createdAt')
   * @returns {any} - Field value
   */
  getFieldValue(entry, fieldPath) {
    if (fieldPath.startsWith("sys.")) {
      // Handle system fields
      const sysField = fieldPath.replace("sys.", "");
      return entry.sys[sysField];
    }

    // Handle regular fields with locale support
    if (entry.fields && entry.fields[fieldPath]) {
      const fieldData = entry.fields[fieldPath];

      // If it's a localized field, get the first available locale value
      if (typeof fieldData === "object" && !Array.isArray(fieldData)) {
        const locales = Object.keys(fieldData);
        if (locales.length > 0) {
          return fieldData[locales[0]];
        }
      }

      return fieldData;
    }

    return null;
  }

  /**
   * Evaluate field value against operator and expected value
   * @param {any} fieldValue - Actual field value
   * @param {string} operator - Comparison operator
   * @param {any} expectedValue - Expected value for comparison
   * @param {Object} entry - Full entry for context (for date calculations)
   * @returns {boolean} - Whether condition is met
   */
  evaluateOperator(fieldValue, operator, expectedValue, entry) {
    switch (operator) {
      case "isEmpty":
        return this.isEmpty(fieldValue);

      case "isNotEmpty":
        return !this.isEmpty(fieldValue);

      case "equals":
        return fieldValue === expectedValue;

      case "notEquals":
        return fieldValue !== expectedValue;

      case "contains":
        return fieldValue && fieldValue.toString().includes(expectedValue);

      case "startsWith":
        return fieldValue && fieldValue.toString().startsWith(expectedValue);

      case "endsWith":
        return fieldValue && fieldValue.toString().endsWith(expectedValue);

      case "before":
        return this.evaluateDateComparison(fieldValue, expectedValue, "before");

      case "after":
        return this.evaluateDateComparison(fieldValue, expectedValue, "after");

      case "olderThan":
        return this.evaluateRelativeDate(
          entry.sys.createdAt,
          expectedValue,
          "older"
        );

      case "newerThan":
        return this.evaluateRelativeDate(
          entry.sys.createdAt,
          expectedValue,
          "newer"
        );

      case "greaterThan":
        return parseFloat(fieldValue) > parseFloat(expectedValue);
      case "lessThan":
        return parseFloat(fieldValue) < parseFloat(expectedValue);

      case "hasNoData":
        return this.hasNoData(entry);

      default:
        logger.warn(`Unknown operator: ${operator}`);
        return false;
    }
  }
  /**
   * Check if a value is empty
   * @param {any} value - Value to check
   * @returns {boolean}
   */
  isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
  }

  /**
   * Check if an entry has no meaningful data across all fields and locales
   * Uses the same logic as hasEntryData function but returns true if NO data found
   * @param {Object} entry - Contentful entry
   * @returns {boolean} - True if entry has no meaningful data
   */
  hasNoData(entry) {
    try {
      // Validate entry object structure
      if (!entry || typeof entry !== "object") {
        return true; // Consider invalid entries as having no data
      }

      if (!entry.sys || typeof entry.sys !== "object" || !entry.sys.id) {
        return true; // Invalid entry structure
      }

      if (!entry.fields || typeof entry.fields !== "object") {
        return true; // No fields object
      }

      // Get field keys
      let fieldKeys;
      try {
        fieldKeys = Object.keys(entry.fields);
      } catch (error) {
        return true; // Error accessing fields
      }

      if (fieldKeys.length === 0) {
        return true; // No fields
      }

      // Check each field for meaningful content
      for (const fieldKey of fieldKeys) {
        try {
          const fieldData = entry.fields[fieldKey];

          if (fieldData === null || fieldData === undefined) {
            continue; // Skip null/undefined fields
          }

          if (typeof fieldData !== "object") {
            continue; // Skip non-object field data
          }

          // Get locale keys
          let localeKeys;
          try {
            localeKeys = Object.keys(fieldData);
          } catch (error) {
            continue; // Skip if can't access locales
          }

          if (localeKeys.length === 0) {
            continue; // Skip fields with no locales
          }

          // Check each locale for this field
          for (const locale of localeKeys) {
            try {
              if (!Object.prototype.hasOwnProperty.call(fieldData, locale)) {
                continue; // Skip inaccessible locales
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

              // Check arrays with content
              if (Array.isArray(value) && value.length > 0) {
                const hasValidArrayContent = value.some((item) => {
                  if (item === null || item === undefined || item === "") {
                    return false;
                  }
                  // Check for valid link objects
                  if (
                    typeof item === "object" &&
                    item.sys &&
                    item.sys.type === "Link" &&
                    item.sys.id
                  ) {
                    return true;
                  }
                  // Any other non-empty value
                  return item !== null && item !== undefined && item !== "";
                });

                if (hasValidArrayContent) {
                  return false; // Found meaningful data
                }
                continue;
              }

              // Check objects (including Link objects)
              if (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value)
              ) {
                try {
                  const objectKeys = Object.keys(value);

                  if (objectKeys.length === 0) {
                    continue; // Skip empty objects
                  }

                  // Check for valid Link objects
                  if (
                    value.sys &&
                    value.sys.type === "Link" &&
                    value.sys.id &&
                    value.sys.linkType
                  ) {
                    return false; // Found meaningful link data
                  }

                  // Check for other meaningful object content
                  const hasMeaningfulContent = objectKeys.some((objKey) => {
                    try {
                      const objValue = value[objKey];

                      if (
                        objValue === null ||
                        objValue === undefined ||
                        objValue === ""
                      ) {
                        return false;
                      }

                      // Handle nested objects
                      if (typeof objValue === "object" && objValue !== null) {
                        // Check for nested Link objects
                        if (
                          objValue.sys &&
                          objValue.sys.type === "Link" &&
                          objValue.sys.id
                        ) {
                          return true;
                        }

                        // Check if nested object has content
                        try {
                          const nestedKeys = Object.keys(objValue);
                          return (
                            nestedKeys.length > 0 &&
                            nestedKeys.some((nestedKey) => {
                              try {
                                if (
                                  !Object.prototype.hasOwnProperty.call(
                                    objValue,
                                    nestedKey
                                  )
                                ) {
                                  return false;
                                }

                                const nestedValue = objValue[nestedKey];
                                if (
                                  nestedValue === null ||
                                  nestedValue === undefined
                                ) {
                                  return false;
                                }

                                if (
                                  typeof nestedValue === "object" &&
                                  nestedValue !== null
                                ) {
                                  try {
                                    const nestedValueKeys =
                                      Object.keys(nestedValue);
                                    return (
                                      nestedValueKeys.length > 0 &&
                                      nestedValueKeys.some((key) => {
                                        try {
                                          const prop = nestedValue[key];
                                          return (
                                            prop !== null &&
                                            prop !== undefined &&
                                            prop !== ""
                                          );
                                        } catch (propError) {
                                          return false;
                                        }
                                      })
                                    );
                                  } catch (nestedValueError) {
                                    return false;
                                  }
                                }

                                return (
                                  nestedValue !== null &&
                                  nestedValue !== undefined &&
                                  nestedValue !== ""
                                );
                              } catch (nestedKeyError) {
                                return false;
                              }
                            })
                          );
                        } catch (nestedError) {
                          return false;
                        }
                      }

                      // Any other non-empty value
                      return true;
                    } catch (objPropertyError) {
                      return false;
                    }
                  });

                  if (hasMeaningfulContent) {
                    return false; // Found meaningful data
                  }
                } catch (objectError) {
                  continue; // Skip objects with errors
                }
                continue;
              }

              // If we get here, we have meaningful primitive content
              return false; // Found meaningful data
            } catch (valueError) {
              continue; // Skip values with errors
            }
          }
        } catch (fieldError) {
          continue; // Skip fields with errors
        }
      }

      // If we've checked all fields and found no meaningful data
      return true;
    } catch (error) {
      logger.warn(
        `Error checking hasNoData for entry ${entry?.sys?.id || "unknown"}: ${
          error.message
        }`
      );
      return true; // Consider entries with errors as having no data
    }
  }

  /**
   * Evaluate date comparison
   * @param {string|Date} fieldValue - Date field value
   * @param {string} expectedValue - Expected date or 'now'
   * @param {string} comparison - 'before' or 'after'
   * @returns {boolean}
   */
  evaluateDateComparison(fieldValue, expectedValue, comparison) {
    if (!fieldValue) return false;

    const fieldDate = new Date(fieldValue);
    const compareDate =
      expectedValue === "now" ? new Date() : new Date(expectedValue);

    if (comparison === "before") {
      return fieldDate < compareDate;
    } else if (comparison === "after") {
      return fieldDate > compareDate;
    }

    return false;
  }

  /**
   * Evaluate relative date (e.g., '30d', '7d', '1h')
   * @param {string|Date} dateValue - Date to compare
   * @param {string} relativeValue - Relative time (e.g., '30d')
   * @param {string} comparison - 'older' or 'newer'
   * @returns {boolean}
   */
  evaluateRelativeDate(dateValue, relativeValue, comparison) {
    if (!dateValue) return false;

    const targetDate = new Date(dateValue);
    const now = new Date();

    // Parse relative value (e.g., '30d', '7d', '1h')
    const match = relativeValue.match(/^(\d+)([dhm])$/);
    if (!match) {
      logger.warn(`Invalid relative date format: ${relativeValue}`);
      return false;
    }

    const [, amount, unit] = match;
    const milliseconds = this.getMillisecondsFromUnit(parseInt(amount), unit);
    const cutoffDate = new Date(now.getTime() - milliseconds);

    if (comparison === "older") {
      return targetDate < cutoffDate;
    } else if (comparison === "newer") {
      return targetDate > cutoffDate;
    }

    return false;
  }

  /**
   * Convert time unit to milliseconds
   * @param {number} amount - Amount of time
   * @param {string} unit - Time unit ('d', 'h', 'm')
   * @returns {number} - Milliseconds
   */
  getMillisecondsFromUnit(amount, unit) {
    switch (unit) {
      case "d":
        return amount * 24 * 60 * 60 * 1000; // days
      case "h":
        return amount * 60 * 60 * 1000; // hours
      case "m":
        return amount * 60 * 1000; // minutes
      default:
        return 0;
    }
  }

  /**
   * Get deletion statistics for environment
   * @param {string} environment - Environment name
   * @returns {Object} - Environment-specific settings
   */
  getEnvironmentSettings(environment) {
    const envConfig = this.config.environmentConfig?.[environment] || {};
    const globalSettings = this.config.globalSettings?.defaultBehavior || {};

    return {
      safeMode:
        envConfig.safeMode ?? globalSettings.checkLinksBeforeDeletion ?? true,
      maxDeletionsPerRun:
        envConfig.maxDeletionsPerRun ??
        globalSettings.maxDeletionsPerRun ??
        100,
      requireConfirmationForAll: envConfig.requireConfirmationForAll ?? false,
    };
  }

  /**
   * Generate a deletion report
   * @param {Object[]} deletionCandidates - Entries marked for deletion
   * @param {string} environment - Current environment
   * @returns {Object} - Deletion report
   */
  generateDeletionReport(deletionCandidates, environment) {
    const report = {
      timestamp: new Date().toISOString(),
      environment,
      totalCandidates: deletionCandidates.length,
      ruleBreakdown: {},
      contentTypeBreakdown: {},
      summary: {
        willDelete: 0,
        willSkipDueToLinks: 0,
        willSkipDueToSafety: 0,
      },
    };

    deletionCandidates.forEach((candidate) => {
      // Rule breakdown
      const ruleId = candidate.ruleId || "unknown";
      if (!report.ruleBreakdown[ruleId]) {
        report.ruleBreakdown[ruleId] = {
          ruleName: candidate.ruleName || "Unknown Rule",
          count: 0,
          entries: [],
        };
      }
      report.ruleBreakdown[ruleId].count++;
      report.ruleBreakdown[ruleId].entries.push({
        id: candidate.entry.sys.id,
        contentType: candidate.entry.sys.contentType.sys.id,
        reasons: candidate.reasons,
      });

      // Content type breakdown
      const contentType = candidate.entry.sys.contentType.sys.id;
      if (!report.contentTypeBreakdown[contentType]) {
        report.contentTypeBreakdown[contentType] = 0;
      }
      report.contentTypeBreakdown[contentType]++;

      // Summary counts
      if (candidate.willDelete) {
        report.summary.willDelete++;
      } else if (candidate.isLinked) {
        report.summary.willSkipDueToLinks++;
      } else {
        report.summary.willSkipDueToSafety++;
      }
    });

    return report;
  }

  /**
   * Process entries and return those marked for deletion
   * @param {Object[]} entries - Array of Contentful entries
   * @param {string} environment - Current environment
   * @param {Function} linkChecker - Function to check if entry is linked
   * @returns {Promise<Object[]>} - Array of entries marked for deletion with metadata
   */
  async processEntriesForDeletion(entries, environment, linkChecker = null) {
    const deletionCandidates = [];
    const envSettings = this.getEnvironmentSettings(environment);

    logger.info(
      `🔍 Processing ${entries.length} entries for deletion using mapping rules...`
    );
    logger.info(
      `Environment settings - Safe mode: ${envSettings.safeMode}, Max deletions: ${envSettings.maxDeletionsPerRun}`
    );

    for (const entry of entries) {
      try {
        const deletionCheck = this.shouldDeleteEntry(entry, environment);

        if (deletionCheck.shouldDelete) {
          const candidate = {
            entry,
            reasons: deletionCheck.reasons,
            ruleId: deletionCheck.ruleId,
            ruleName: deletionCheck.ruleName,
            safetyChecks: deletionCheck.safetyChecks,
            isLinked: false,
            willDelete: false,
          };

          // Perform safety checks if enabled
          if (
            envSettings.safeMode &&
            deletionCheck.safetyChecks?.checkLinks &&
            linkChecker
          ) {
            try {
              const linkResult = await linkChecker(entry.sys.id);
              candidate.isLinked = linkResult.isLinked;
              candidate.linkedBy = linkResult.linkedBy;

              if (
                linkResult.isLinked &&
                deletionCheck.safetyChecks?.skipIfReferenced
              ) {
                logger.warn(
                  `⚠️ Entry ${entry.sys.id} marked for deletion but is referenced by other entries. Skipping.`
                );
                candidate.willDelete = false;
              } else {
                candidate.willDelete = true;
              }
            } catch (linkError) {
              logger.warn(
                `Failed to check links for entry ${entry.sys.id}: ${linkError.message}`
              );
              candidate.willDelete =
                !deletionCheck.safetyChecks?.skipIfReferenced; // Conservative approach
            }
          } else {
            candidate.willDelete = true;
          }

          deletionCandidates.push(candidate);

          logger.info(
            `📝 Entry ${entry.sys.id} (${entry.sys.contentType.sys.id}) marked for deletion:`
          );
          logger.info(`   Rule: ${deletionCheck.ruleName}`);
          logger.info(`   Reasons: ${deletionCheck.reasons.join(", ")}`);
          logger.info(`   Will delete: ${candidate.willDelete ? "✅" : "❌"}`);
        }
      } catch (error) {
        logger.warn(
          `Error processing entry ${entry.sys.id} for deletion: ${error.message}`
        );
      }
    }

    // Apply max deletions limit
    const toDelete = deletionCandidates.filter((c) => c.willDelete);
    if (toDelete.length > envSettings.maxDeletionsPerRun) {
      logger.warn(
        `⚠️ ${toDelete.length} entries marked for deletion exceeds limit of ${envSettings.maxDeletionsPerRun}`
      );
      logger.warn(
        `Only first ${envSettings.maxDeletionsPerRun} will be processed`
      );

      // Mark excess entries as not-to-delete
      for (let i = envSettings.maxDeletionsPerRun; i < toDelete.length; i++) {
        toDelete[i].willDelete = false;
        toDelete[i].skipReason = "Exceeded max deletions per run limit";
      }
    }

    logger.info(
      `📊 Deletion summary: ${deletionCandidates.length} candidates, ${
        toDelete.filter((c) => c.willDelete).length
      } will be deleted`
    );

    return deletionCandidates;
  }

  /**
   * Save deletion report to file
   * @param {Object} report - Deletion report object
   * @param {string} environment - Environment name
   * @returns {string} - Path to saved report
   */
  saveDeletionReport(report, environment) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = `deletion-report-${environment}-${timestamp}.json`;

    try {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      logger.success(`📄 Deletion report saved: ${reportPath}`);
      return reportPath;
    } catch (error) {
      logger.error(`Failed to save deletion report: ${error.message}`);
      return null;
    }
  }

  /**
   * Get enabled rules for an environment
   * @param {string} environment - Environment name
   * @returns {Object[]} - Array of enabled rules for the environment
   */
  getEnabledRulesForEnvironment(environment) {
    if (!this.config || !this.config.deletionRules) {
      return [];
    }

    return this.config.deletionRules.filter(
      (rule) =>
        rule.enabled &&
        (!rule.environments || rule.environments.includes(environment))
    );
  }

  /**
   * Get summary of all configured rules
   * @returns {Object} - Rules summary
   */
  getRulesSummary() {
    if (!this.config || !this.config.deletionRules) {
      return { totalRules: 0, enabledRules: 0, contentTypes: [] };
    }

    const enabledRules = this.config.deletionRules.filter((r) => r.enabled);
    const contentTypes = [
      ...new Set(this.config.deletionRules.flatMap((r) => r.contentTypes)),
    ];

    return {
      totalRules: this.config.deletionRules.length,
      enabledRules: enabledRules.length,
      contentTypes,
      environments: Object.keys(this.config.environmentConfig || {}),
    };
  }
}

module.exports = EntryDeletionProcessor;
