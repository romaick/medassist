'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('./build-icd.cjs')();
require('./build-investigations.cjs')();
const app = path.resolve(__dirname, '../medassist/app');
const version = JSON.parse(fs.readFileSync(path.join(app, 'version.json'), 'utf8'));
const names = ['index.html', 'styles.css', 'exam-options.js', 'core.js', 'storage.js', 'modules.js', 'app.js', 'icon.svg', 'version.json'];
const files = names.map(name => {
  const content = fs.readFileSync(path.join(app, name));
  return {name, sha256: crypto.createHash('sha256').update(content).digest('hex'), contentBase64: content.toString('base64')};
});
const update = {format: 'medassist-update', formatVersion: 1, version: version.version, dataSchemaVersion: version.dataSchemaVersion, files};
const output = path.join(__dirname, 'medassist-update.json');
const serialized = JSON.stringify(update);
if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new Error('Update exceeds the installed updater limit of 2 MiB.');
fs.writeFileSync(output, serialized);
console.log(JSON.stringify({version: update.version, files: names, bytes: fs.statSync(output).size, output}));
