'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('./build-icd.cjs')();
require('./build-investigations.cjs')();
require('./build-lab-norms.cjs')();
require('./build-lab-registry.cjs')();
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
// The updater rejects a package over either limit, so the build reads both from Update-Core.ps1 and stops first.
const core = fs.readFileSync(path.resolve(__dirname, '../medassist/updater/Update-Core.ps1'), 'utf8');
const limit = name => {
  const match = core.match(new RegExp('\\$script:' + name + ' = (\\d+) \\* 1024 \\* 1024'));
  if (!match) throw new Error('Cannot read ' + name + ' from Update-Core.ps1.');
  return Number(match[1]) * 1024 * 1024;
};
const packageLimit = limit('MedAssistPackageLimit'), decodedLimit = limit('MedAssistDecodedLimit');
const decoded = files.reduce((sum, file) => sum + Buffer.from(file.contentBase64, 'base64').length, 0);
if (decoded > decodedLimit) throw new Error('Application files total ' + decoded + ' bytes, over the updater limit of ' + decodedLimit + '.');
if (Buffer.byteLength(serialized) > packageLimit) throw new Error('Update package is ' + Buffer.byteLength(serialized) + ' bytes, over the updater limit of ' + packageLimit + '.');
fs.writeFileSync(output, serialized);
console.log(JSON.stringify({version: update.version, files: names, bytes: fs.statSync(output).size, decoded, packageLimit, decodedLimit, output}));
