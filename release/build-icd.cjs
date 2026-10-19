'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const createLookup = require('../medassist/icd/lookup.cjs');
const marker = '/* Generated offline ICD catalog. Rebuild with node release/build-icd.cjs. */';

function build({catalogPath = path.resolve(__dirname, '../medassist/icd/catalog.json'), modulePath = path.resolve(__dirname, '../medassist/app/modules.js')} = {}) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const lookup = createLookup(catalog);
  const compressed = zlib.gzipSync(JSON.stringify(catalog), {level: 9}).toString('base64');
  const prefix = fs.readFileSync(modulePath, 'utf8').split(marker)[0].trimEnd();
  const generated = marker + '\nwindow.MedAssistICDReady = (async function () {\n' +
    '  const bytes = Uint8Array.from(atob(' + JSON.stringify(compressed) + '), character => character.charCodeAt(0));\n' +
    '  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));\n' +
    '  const catalog = await new Response(stream).json();\n' +
    '  const createLookup = ' + createLookup.toString() + ';\n' +
    '  return createLookup(catalog);\n})();\n';
  fs.writeFileSync(modulePath, prefix + '\n\n' + generated);
  return {entries: lookup.size, compressedBytes: Buffer.byteLength(compressed, 'base64'), moduleBytes: fs.statSync(modulePath).size};
}

module.exports = build;
if (require.main === module) console.log(JSON.stringify(build()));
