const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function safeFile(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') || path.posix.isAbsolute(file) || file.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) {
    throw new Error(`Invalid publish path: ${file}`);
  }
  return file;
}

function listFiles(directory, prefix = '') {
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`Unexpected symlink: ${directory}`);
  const files = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = prefix + item.name;
    if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) throw new Error(`Unexpected file type: ${file}`);
    if (item.isDirectory()) files.push(...listFiles(path.join(directory, item.name), file + '/'));
    else files.push(file);
  }
  return files.sort();
}

function verifySite(directory, manifestPath) {
  const receipt = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (receipt.version !== 1 || !Array.isArray(receipt.manifest) || receipt.files !== receipt.manifest.length) throw new Error('Invalid manifest');
  const seen = new Set();
  for (const item of receipt.manifest) {
    safeFile(item.file);
    if (seen.has(item.file)) throw new Error(`Duplicate manifest path: ${item.file}`);
    seen.add(item.file);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid manifest entry');
  }
  if (!seen.has('index.html') || !seen.has('.nojekyll')) throw new Error('Invalid site: missing entry points');
  const actual = listFiles(directory);
  if (actual.length !== seen.size || actual.some(file => !seen.has(file))) throw new Error('Unexpected or missing site files');
  let totalBytes = 0;
  for (const item of receipt.manifest) {
    const data = fs.readFileSync(path.join(directory, item.file));
    if (data.length !== item.bytes || crypto.createHash('sha256').update(data).digest('hex') !== item.sha256) throw new Error(`Mismatch: ${item.file}`);
    totalBytes += data.length;
  }
  if (receipt.totalBytes !== totalBytes) throw new Error('Mismatch: totalBytes');
  return { files: seen.size, totalBytes };
}

module.exports = { safeFile, listFiles, verifySite };
if (require.main === module) {
  try { console.log(JSON.stringify(verifySite(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
