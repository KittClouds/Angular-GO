const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../docs/shortrun.md');
const content = fs.readFileSync(filePath, 'utf8');

// The file seems to be one line or missing proper headers.
// We want to ensure each chapter starts on a new line with '## '.
// Also fix Prologue/Epilogue.

let formatted = content
    // Fix Chapter headers
    .replace(/(Chapter \d+:)/g, '\n\n## $1\n')
    // Fix Prologue/Epilogue
    .replace(/(Prologue|Epilogue)/g, '\n\n## $1\n')
    // Ensure title has header
    .replace(/^Is this(.*?)The Perfect Run/, '# The Perfect Run\n') // Heuristic based on start
    // Clean up multiple newlines
    .replace(/\n{3,}/g, '\n\n');

// Also, the file might start with "The Perfect Run". Let's ensure top level header.
if (!formatted.startsWith('#')) {
    formatted = '# ' + formatted;
}

// Write back
fs.writeFileSync(filePath, formatted);
console.log('Formatted shortrun.md');
