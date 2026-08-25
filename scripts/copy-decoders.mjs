// Copies the Draco and Basis/KTX2 decoders out of the three.js package into
// public/vendor so the viewer decodes compressed assets without a CDN round-trip.
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libs = resolve(root, 'node_modules/three/examples/jsm/libs');

const jobs = [
  ['draco', resolve(libs, 'draco'), resolve(root, 'public/vendor/draco')],
  ['basis', resolve(libs, 'basis'), resolve(root, 'public/vendor/basis')],
];

for (const [name, from, to] of jobs) {
  if (!existsSync(from)) {
    console.warn(`[copy-decoders] skipped ${name}: ${from} not found`);
    continue;
  }
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`[copy-decoders] ${name} -> ${to}`);
}
