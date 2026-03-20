const fs = require('fs');
const path = require('path');
const glob = require('glob'); // using fs to crawl since glob might not be installed

function findFiles(dir, matchFiles) {
    const results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results.push(...findFiles(fullPath, matchFiles));
        } else if (matchFiles(fullPath)) {
            results.push(fullPath);
        }
    });
    return results;
}

const htmlAndTsFiles = findFiles('./src/app', f => f.endsWith('.html') || f.endsWith('.ts'));

let fixedCount = 0;

for (const file of htmlAndTsFiles) {
    let content = fs.readFileSync(file, 'utf8');

    // Regex to find p-dialog and wrap its body.
    // We look for:
    // 1. <p-dialog ...>
    // 2. an optional <ng-template pTemplate="header">...</ng-template>
    // 3. The body content, which must NOT start with <ng-template pTemplate="content">
    // 4. <ng-template pTemplate="footer"> or </p-dialog>

    // Since regex might be tricky, let's do targeted string replacement for the world-building tabs first, where the pattern is extremely consistent.

    if(file.includes('worldbuilding-tab')) {
        let lines = content.split('\n');
        let newLines = [];
        let inDialog = false;
        let pTemplateAdded = false;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            
            if (line.match(/<p-dialog.*>/) && !line.includes('</p-dialog>')) {
                inDialog = true;
                pTemplateAdded = false;
                newLines.push(line);
                continue;
            }

            if (inDialog && !pTemplateAdded) {
                // If we see the first div after p-dialog (or after header)
                // and it's not an ng-template, we insert our ng-template
                if (line.match(/^\s*<div/)) {
                    const indent = line.match(/^\s*/)[0];
                    newLines.push(`${indent}<ng-template pTemplate="content">`);
                    newLines.push(line);
                    pTemplateAdded = true;
                    continue;
                }
            }

            if (inDialog && pTemplateAdded) {
                // Look for the footer or closing tag to close our ng-template
                if (line.match(/^\s*<ng-template pTemplate="footer">/) || line.match(/^\s*<\/p-dialog>/)) {
                    const indent = line.match(/^\s*/)[0];
                    newLines.push(`${indent}</ng-template>`);
                    newLines.push(line);
                    inDialog = false;
                    continue;
                }
            }

            if (line.match(/^\s*<\/p-dialog>/)) {
                inDialog = false;
            }

            newLines.push(line);
        }

        const newContent = newLines.join('\n');
        if (newContent !== content) {
            fs.writeFileSync(file, newContent, 'utf8');
            console.log(`Fixed dialogs in ${path.basename(file)}`);
            fixedCount++;
        }
    }
}

console.log(`Finished fixing ${fixedCount} files.`);
