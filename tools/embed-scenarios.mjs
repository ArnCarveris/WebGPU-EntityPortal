// Writes scenarios/<name>.js next to every scenarios/<name>.json, so the default scenario also loads when
// index.html is opened from disk (browsers block fetch() on file:// pages, but run <script> files).
// The .json stays the source of truth: run this after editing one.
//
//   node tools/embed-scenarios.mjs
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scenarios');
for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    JSON.parse(text);                                   // fail loudly on invalid JSON
    const out = file.replace(/\.json$/, '.js');
    writeFileSync(join(dir, out),
        `'use strict';\n// Generated from ${file} by tools/embed-scenarios.mjs - edit the .json, then re-run the tool.\n` +
        `(window.EMBEDDED_SCENARIOS ||= {})['scenarios/${file}'] =\n${text.trim()};\n`);
    console.log(`scenarios/${out}`);
}
