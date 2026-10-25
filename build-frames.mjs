// Writes the four static method frames into index.html between the markers,
// so the page carries its drawings without JavaScript.
import { readFileSync, writeFileSync } from 'node:fs';
import { KEYFRAMES, figureSvg } from './poses.js';
const file = new URL('./index.html', import.meta.url);
let html = readFileSync(file, 'utf8');
KEYFRAMES.forEach((P, i) => {
  const svg = figureSvg(P, i, 1);
  const re = new RegExp(`(<!-- frame:${i} -->)[\\s\\S]*?(<!-- /frame:${i} -->)`, 'g');
  html = html.replace(re, `$1${svg}$2`);
});
writeFileSync(file, html);
console.log('frames written');
