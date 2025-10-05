/**
 * Advanced Logger for Contentful Scripts
 * 
 * A configurable logger with color support using the logger-color module.
 * Provides different log levels, timestamps, and customizable formatting.
 * All log messages are fully colored for better visibility in the terminal.
 */

require('dotenv').config();
const path = require('path');
const { createColorLogger, RESET, hexToAnsi } = require('./logger-color/color-converter');

// Create color palette from the color-converter module
const colorTools = createColorLogger();

// Color hex values for each log level
const levelColorMap = {
    DEBUG: '#A9A9A9',    // Gray
    INFO: '#00FFFF',     // Cyan
    SUCCESS: '#00FF00',  // Green
    WARNING: '#FFFF00',  // Yellow
    ERROR: '#FF0000',    // Red
    CRITICAL: '#FF00FF'  // Magenta
};

// Get the raw ANSI color codes for direct string coloring
const ansiColors = {
    DEBUG: hexToAnsi(levelColorMap.DEBUG),
    INFO: hexToAnsi(levelColorMap.INFO),
    SUCCESS: hexToAnsi(levelColorMap.SUCCESS),
    WARNING: hexToAnsi(levelColorMap.WARNING),
    ERROR: hexToAnsi(levelColorMap.ERROR),
    CRITICAL: hexToAnsi(levelColorMap.CRITICAL)
};

// Default log levels configuration
const LOG_LEVELS = {
    DEBUG: {
        value: 0,
        color: ansiColors.DEBUG,
        levelPrefix: `${ansiColors.DEBUG}[DEBUG]${RESET}`
    },
    INFO: {
        value: 1,
        color: ansiColors.INFO,
        levelPrefix: `${ansiColors.INFO}[INFO]${RESET}`
    },
    SUCCESS: {
        value: 2,
        color: ansiColors.SUCCESS,
        levelPrefix: `${ansiColors.SUCCESS}[SUCCESS]${RESET}`
    },
    WARNING: {
        value: 3,
        color: ansiColors.WARNING,
        levelPrefix: `${ansiColors.WARNING}[WARNING]${RESET}`
    },
    ERROR: {
        value: 4,
        color: ansiColors.ERROR,
        levelPrefix: `${ansiColors.ERROR}[ERROR]${RESET}`
    },
    CRITICAL: {
        value: 5,
        color: hexToAnsi(levelColorMap.CRITICAL, true), // Use background color for critical
        levelPrefix: `${hexToAnsi(levelColorMap.CRITICAL, true)}[CRITICAL]${RESET}`
    }
};

// Get minimum log level from environment or use default
const MIN_LOG_LEVEL = (process.env.LOG_LEVEL && LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()])
    ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()].value
    : LOG_LEVELS.INFO.value;

// Whether to show timestamps in logs (default: true)
const SHOW_TIMESTAMPS = process.env.LOG_TIMESTAMPS !== 'false';

// Utility function to format timestamps
function getTimestamp() {
    if (!SHOW_TIMESTAMPS) return '';

    const now = new Date();
    return `[${now.toISOString()}] `;
}

// Get the script name for logging context
function getScriptName() {
    if (require.main) {
        return path.basename(require.main.filename);
    }
    return 'unknown-script';
}

// Create the logger instance
class ContentfulLogger {
    constructor(context = getScriptName()) {
        this.context = context;
    }

    // Set a custom context (like function name or module)
    setContext(context) {
        this.context = context;
        return this;
    }

    // Format the log message with context
    formatMessage(message, includeContext = true) {
        if (includeContext && this.context) {
            return `[${this.context}] ${message}`;
        }
        return message;
    }    // Core logging function
    log(level, message, ...args) {
        const logLevel = LOG_LEVELS[level];

        // Skip if log level is below minimum
        if (logLevel.value < MIN_LOG_LEVEL) {
            return;
        }

        // Format the timestamp
        const timestamp = getTimestamp();

        // Format the message with context
        let formattedMessage = this.formatMessage(message);

        // Handle objects specially
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            // Log the level prefix normally
            console.log(`${timestamp}${logLevel.levelPrefix} ${logLevel.color}${formattedMessage}${RESET}`);
            console.log(args[0]);
            return;
        }

        // Format with arguments if provided
        if (args.length > 0) {
            formattedMessage = formattedMessage.replace(/%[sdifjoO%]/g, (match) => {
                if (match === '%%') return '%';
                const arg = args.shift();
                return typeof arg === 'object' ? JSON.stringify(arg) : arg;
            });

            // Any remaining args are appended
            if (args.length > 0) {
                formattedMessage += ' ' + args.map(arg =>
                    typeof arg === 'object' ? JSON.stringify(arg) : arg
                ).join(' ');
            }
        }

        // Output the formatted message with the whole message colored
        // Level prefix is already colored separately with the levelPrefix property
        console.log(`${timestamp}${logLevel.levelPrefix} ${logLevel.color}${formattedMessage}${RESET}`);
    }

    // Log level methods
    debug(message, ...args) {
        this.log('DEBUG', message, ...args);
    }

    info(message, ...args) {
        this.log('INFO', message, ...args);
    }

    success(message, ...args) {
        this.log('SUCCESS', message, ...args);
    }

    warning(message, ...args) {
        this.log('WARNING', message, ...args);
    }

    warn(message, ...args) {
        this.warning(message, ...args); // Alias for warning
    }

    error(message, ...args) {
        this.log('ERROR', message, ...args);
    }

    critical(message, ...args) {
        this.log('CRITICAL', message, ...args);
    }

    // Utility methods
    group(label) {
        console.group(colorTools.orange(label));
    }

    groupEnd() {
        console.groupEnd();
    }

    // Timers for performance measurement
    timers = {};

    startTimer(label = 'default') {
        this.timers[label] = Date.now();
        this.debug(`Timer "${label}" started`);
    }

    endTimer(label = 'default') {
        if (!this.timers[label]) {
            this.warning(`Timer "${label}" was not started`);
            return null;
        }

        const duration = Date.now() - this.timers[label];
        delete this.timers[label];
        this.debug(`Timer "${label}" ended: ${duration}ms`);
        return duration;
    }

    // Create a new logger with a different context
    createChild(context) {
        return new ContentfulLogger(`${this.context}:${context}`);
    }

    // Color methods for direct text coloring
    get colors() {
        return colorTools;
    }
}

// Create the default logger instance
const logger = new ContentfulLogger();

// Export the logger
module.exports = logger;
