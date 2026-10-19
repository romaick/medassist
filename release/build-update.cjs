'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const app = path.resolve(__dirname, '../medassist/app');
const version = JSON.parse(fs.readFileSync(path.join(app, 'version.json'), 'utf8'));
const names = ['index.html', 'styles.css', 'exam-options.js', 'core.js', 'storage.js', 'modules.js', 'app.js', 'icon.svg', 'version.json'];
const files = names.map(name => {
  const content = fs.readFileSync(path.join(app, name));
  return {name, sha256: crypto.createHash('sha256').update(content).digest('hex'), contentBase64: content.toString('base64')};
});
const update = {format: 'medassist-update', formatVersion: 1, version: version.version, dataSchemaVersion: version.dataSchemaVersion, files};
const output = path.join(__dirname, 'medassist-update.json');
fs.writeFileSync(output, JSON.stringify(update));
console.log(JSON.stringify({version: update.version, files: names, bytes: fs.statSync(output).size, output}));
