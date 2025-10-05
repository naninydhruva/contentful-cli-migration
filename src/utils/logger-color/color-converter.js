/**
 * Color Converter Script
 * 
 * Converts hex color codes to ANSI color codes for terminal logging.
 * This script can be used with the existing logger to add more color options.
 */

/**
 * Converts a hex color code to an RGB object
 * 
 * @param {string} hex - The hex color code (e.g., "#FF0000" or "FF0000")
 * @returns {object} An object containing r, g, b values
 */
function hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace(/^#/, '');

    // Handle both 3 and 6 digit hex codes
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    // Verify hex format
    if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
        throw new Error(`Invalid hex color: ${hex}`);
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return { r, g, b };
}

/**
 * Creates an ANSI color code from RGB values
 * 
 * @param {number} r - Red value (0-255)
 * @param {number} g - Green value (0-255)
 * @param {number} b - Blue value (0-255)
 * @param {boolean} background - Whether to color the background instead of foreground
 * @returns {string} ANSI color code for use in terminal
 */
function rgbToAnsi(r, g, b, background = false) {
    const colorType = background ? 48 : 38;
    return `\x1b[${colorType};2;${r};${g};${b}m`;
}

/**
 * Converts a hex color to an ANSI color code
 * 
 * @param {string} hex - Hex color code
 * @param {boolean} background - Whether to color the background instead of foreground
 * @returns {string} ANSI color code for use in terminal
 */
function hexToAnsi(hex, background = false) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToAnsi(r, g, b, background);
}

/**
 * The ANSI reset code to reset all styling
 */
const RESET = '\x1b[0m';

/**
 * Creates a function that will wrap text in the specified color and reset after
 * 
 * @param {string} hex - Hex color code
 * @param {boolean} background - Whether to color the background instead of foreground
 * @returns {Function} A function that accepts text and returns colored text
 */
function colorize(hex, background = false) {
    const colorCode = hexToAnsi(hex, background);
    return (text) => `${colorCode}${text}${RESET}`;
}

/**
 * Creates a collection of predefined colors for easy access
 * 
 * @returns {Object} Object with color functions
 */
function createColorPalette() {
    return {
        red: colorize('#FF0000'),
        green: colorize('#00FF00'),
        blue: colorize('#0000FF'),
        yellow: colorize('#FFFF00'),
        magenta: colorize('#FF00FF'),
        cyan: colorize('#00FFFF'),
        white: colorize('#FFFFFF'),
        black: colorize('#000000'),
        orange: colorize('#FFA500'),
        purple: colorize('#800080'),
        // Background variants
        bgRed: colorize('#FF0000', true),
        bgGreen: colorize('#00FF00', true),
        bgBlue: colorize('#0000FF', true),
        bgYellow: colorize('#FFFF00', true),
        bgMagenta: colorize('#FF00FF', true),
        bgCyan: colorize('#00FFFF', true),
        bgWhite: colorize('#FFFFFF', true),
        bgBlack: colorize('#000000', true)
    };
}

/**
 * Creates a logger compatible with the Contentful management script using custom colors
 * 
 * @returns {Object} Enhanced logger with color methods
 */
function createColorLogger() {
    const colors = createColorPalette();

    return {
        colorize,
        hexToAnsi,
        RESET,
        ...colors,

        // Helper to add new colors to the logger
        addColor: (name, hexColor, isBackground = false) => {
            colors[name] = colorize(hexColor, isBackground);
            return colors[name];
        },

        // Convert the color mapping for the main logger in cf-contentType.js
        getLoggerColors: () => ({
            info: hexToAnsi('#00FFFF'),     // Cyan
            success: hexToAnsi('#00FF00'),  // Green
            warning: hexToAnsi('#FFFF00'),  // Yellow
            error: hexToAnsi('#FF0000')     // Red
        })
    };
}

// Example usage
if (require.main === module) {
    const colorLogger = createColorLogger();

    // Print some examples
    console.log(colorLogger.red('This text is red'));
    console.log(colorLogger.green('This text is green'));
    console.log(colorLogger.blue('This text is blue'));
    console.log(colorLogger.bgYellow(colorLogger.black('Black text on yellow background')));

    // Adding a custom color
    const teal = colorLogger.addColor('teal', '#008080');
    console.log(teal('This text is teal'));

    // Show how it can be integrated with existing logger
    console.log('\nLogger colors for cf-contentType.js:');
    console.log(JSON.stringify(colorLogger.getLoggerColors(), null, 2)
        .replace(/\\u001b/g, '')
        .replace(/\[38;2;\d+;\d+;\d+m/g, (match) => `"${match}"`));

    console.log('\nReplace color definitions in your logger with:');
    console.log(`const colors = {
    info: '${hexToAnsi('#00FFFF')}%s${RESET}',     // Cyan
    success: '${hexToAnsi('#00FF00')}%s${RESET}',  // Green
    warning: '${hexToAnsi('#FFFF00')}%s${RESET}',  // Yellow
    error: '${hexToAnsi('#FF0000')}%s${RESET}'     // Red
};`);

    // Example of integrating with your existing logger
    console.log('\nExample integration:');
    console.log(`
// In cf-contentType.js:

// Add this line at the top of your file
const colorConverter = require('./color-converter');

// Then replace your logger's color definition with:
const colors = colorConverter.createColorLogger().getLoggerColors();

// Or define specific colors directly:
const colors = {
    info: colorConverter.hexToAnsi('#00FFFF') + '%s' + colorConverter.RESET,     // Cyan
    success: colorConverter.hexToAnsi('#00FF00') + '%s' + colorConverter.RESET,  // Green
    warning: colorConverter.hexToAnsi('#FFFF00') + '%s' + colorConverter.RESET,  // Yellow
    error: colorConverter.hexToAnsi('#FF0000') + '%s' + colorConverter.RESET     // Red
};
`);
}

module.exports = {
    hexToRgb,
    rgbToAnsi,
    hexToAnsi,
    colorize,
    createColorPalette,
    createColorLogger,
    RESET
};
