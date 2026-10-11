import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.resolve(__dirname, '../apps/web/dist');
const assetsDir = path.join(distDir, 'assets');

if (!fs.existsSync(assetsDir)) {
  console.error('Error: apps/web/dist/assets does not exist. Run "npm run build" first.');
  process.exit(1);
}

// Find HTML file to trace entry JS
const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const entryMatch = indexHtml.match(/src="\/assets\/([^"]+\.js)"/);
if (!entryMatch) {
  console.error('Error: Could not locate entry JavaScript bundle in index.html');
  process.exit(1);
}

const entryJsName = entryMatch[1];
const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));

// For /post route, the loaded bundles are:
// 1. Entry JS (index / main)
// 2. Vendor chunk (react, react-dom, react-router)
// Any non-post chunk (admin, ngo, provider, leaflet, qrcode) is dynamically loaded on demand and excluded!
const nonPostChunks = ['admin', 'ngo', 'provider', 'leaflet', 'qrcode'];
const postBundleFiles = jsFiles.filter((f) => {
  const lower = f.toLowerCase();
  for (const exclude of nonPostChunks) {
    if (lower.includes(exclude)) return false;
  }
  return true;
});

let totalRawBytes = 0;
let totalGzipBytes = 0;

console.log('\n--- BUNDLE SIZE AUDIT FOR /post ---');
for (const file of postBundleFiles) {
  const filePath = path.join(assetsDir, file);
  const content = fs.readFileSync(filePath);
  const gzipped = zlib.gzipSync(content);
  totalRawBytes += content.length;
  totalGzipBytes += gzipped.length;
  console.log(`• ${file}: ${(content.length / 1024).toFixed(2)} KB raw -> ${(gzipped.length / 1024).toFixed(2)} KB gzipped`);
}

const totalGzipKb = totalGzipBytes / 1024;
const MAX_ALLOWED_KB = 90;

console.log('-----------------------------------');
console.log(`Total /post JavaScript (gzipped): ${totalGzipKb.toFixed(2)} KB / Budget: ${MAX_ALLOWED_KB} KB`);

if (totalGzipKb <= MAX_ALLOWED_KB) {
  console.log(`✅ PASS: Bundle size is within budget (${totalGzipKb.toFixed(2)} KB <= ${MAX_ALLOWED_KB} KB)\n`);
  process.exit(0);
} else {
  console.error(`❌ FAIL: Bundle size exceeds budget (${totalGzipKb.toFixed(2)} KB > ${MAX_ALLOWED_KB} KB)\n`);
  process.exit(1);
}
