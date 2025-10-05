/**
 * Hex Color to ANSI Converter Tool
 * 
 * A simple command-line tool to convert hex color codes to ANSI terminal colors.
 * Run this script directly to convert hex colors to ANSI color codes.
 * 
 * Usage:
 *   node hex-to-ansi.js <hex-color> [--bg]
 * 
 * Examples:
 *   node hex-to-ansi.js FF0000         # Generate red foreground color
 *   node hex-to-ansi.js "#00FF00" --bg # Generate green background color
 *   node hex-to-ansi.js                # Run interactive mode
 * 
 * Use the --bg flag to generate background colors instead of foreground colors.
 */

const { hexToAnsi, RESET } = require('./color-converter');
const readline = require('readline');

/**
 * Converts hex color to ANSI and displays a sample
 * 
 * @param {string} hexColor - The hex color to convert
 * @param {boolean} isBackground - Whether to make a background color
 */
function displayColorSample(hexColor, isBackground = false) {
    try {
        const ansiColor = hexToAnsi(hexColor, isBackground);
        const colorType = isBackground ? 'background' : 'foreground';

        console.log(`\nHex Color: ${hexColor}`);
        console.log(`ANSI ${colorType} Code: ${ansiColor.replace(/\x1B/g, '\\x1B')}`);
        console.log(`JavaScript string: "${ansiColor.replace(/\x1B/g, '\\x1B')}%s${RESET.replace(/\x1B/g, '\\x1B')}"`);

        const sampleText = 'Sample Text';

        if (isBackground) {
            // For background colors, use black or white text based on brightness
            const { r, g, b } = hexToRgb(hexColor);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            const textColor = brightness > 128 ? '\x1b[30m' : '\x1b[97m';  // Black or white text
            console.log(`\nSample: ${ansiColor}${textColor}${sampleText}${RESET}`);
        } else {
            console.log(`\nSample: ${ansiColor}${sampleText}${RESET}`);
        }
    } catch (err) {
        console.error(`\nError: ${err.message}`);
    }
}

/**
 * Converts a hex color code to RGB values
 * 
 * @param {string} hex - Hex color code
 * @returns {object} RGB object with r, g, b properties
 */
function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');

    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    const bigint = parseInt(hex, 16);
    return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255
    };
}

/**
 * Runs the converter in interactive mode
 */
function runInteractiveMode() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('=== Hex to ANSI Color Converter (Interactive Mode) ===');
    console.log('Enter a hex color code (e.g., FF0000 or #00FF00)');
    console.log('Type "bg" followed by the hex code for background colors');
    console.log('Type "exit" or "quit" to exit');

    function promptUser() {
        rl.question('\nEnter hex color: ', (input) => {
            input = input.trim();

            if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
                rl.close();
                return;
            }

            let hexColor = input;
            let isBackground = false;

            if (input.toLowerCase().startsWith('bg ')) {
                hexColor = input.substring(3);
                isBackground = true;
            }

            displayColorSample(hexColor, isBackground);
            promptUser();
        });
    }

    promptUser();
}

/**
 * Main function to run the script
 */
function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        runInteractiveMode();
        return;
    }

    const hexColor = args[0];
    const isBackground = args.includes('--bg');

    displayColorSample(hexColor, isBackground);
}

// Function to generate a table of common colors
function generateColorTable() {
    const colors = [
        { name: 'Red', hex: '#FF0000' },
        { name: 'Green', hex: '#00FF00' },
        { name: 'Blue', hex: '#0000FF' },
        { name: 'Yellow', hex: '#FFFF00' },
        { name: 'Cyan', hex: '#00FFFF' },
        { name: 'Magenta', hex: '#FF00FF' },
        { name: 'White', hex: '#FFFFFF' },
        { name: 'Black', hex: '#000000' },
        { name: 'Orange', hex: '#FFA500' },
        { name: 'Purple', hex: '#800080' },
        { name: 'Pink', hex: '#FFC0CB' },
        { name: 'Brown', hex: '#A52A2A' },
        { name: 'Grey', hex: '#808080' },
        { name: 'Light Blue', hex: '#ADD8E6' },
        { name: 'Light Green', hex: '#90EE90' },
        { name: 'Light Grey', hex: '#D3D3D3' }
    ];

    console.log('\n=== Color Reference Table ===');
    console.log('Color Name   | Hex Code  | Foreground Sample         | Background Sample');
    console.log('-------------|-----------|---------------------------|------------------');

    colors.forEach(color => {
        const fgCode = hexToAnsi(color.hex);
        const bgCode = hexToAnsi(color.hex, true);

        // For background colors, use black or white text based on brightness
        const { r, g, b } = hexToRgb(color.hex);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const textColor = brightness > 128 ? '\x1b[30m' : '\x1b[97m';  // Black or white text

        const fgSample = `${fgCode}Sample Text${RESET}`;
        const bgSample = `${bgCode}${textColor}Sample Text${RESET}`;

        const paddedName = color.name.padEnd(12, ' ');
        console.log(`${paddedName} | ${color.hex} | ${fgSample.padEnd(30, ' ')} | ${bgSample}`);
    });

    console.log('\nTo use these colors in your code:');
    console.log('const colorConverter = require(\'./color-converter\');');
    console.log('const redText = colorConverter.hexToAnsi(\'#FF0000\') + \'Your Text\' + colorConverter.RESET;');
    console.log('const greenBg = colorConverter.hexToAnsi(\'#00FF00\', true) + \'Your Text\' + colorConverter.RESET;');
}

// Run the main function if this script is executed directly
if (require.main === module) {
    // Show the color table if requested with --table
    if (process.argv.includes('--table')) {
        generateColorTable();
    } else {
        main();
    }
}

// Export functions for potential use in other scripts
module.exports = {
    displayColorSample,
    hexToRgb,
    generateColorTable
};
