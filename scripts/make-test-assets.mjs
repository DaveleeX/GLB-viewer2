// Generates small hand-built models used by the smoke test, so the loader path
// is exercised against real files without checking binaries into the repo.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets');
await mkdir(out, { recursive: true });

// --------------------------------------------------------------- animated GLB

const FACES = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
];

const positions = [];
const normals = [];
const indices = [];
for (const [f, face] of FACES.entries()) {
  for (const vertex of face.v) {
    positions.push(...vertex.map((c) => c * 0.5));
    normals.push(...face.n);
  }
  const o = f * 4;
  indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
}

const times = [0, 0.5, 1, 1.5, 2];
const quats = [];
for (const t of times) {
  const angle = (t / 2) * Math.PI * 2;
  quats.push(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
}

const parts = [
  { name: 'idx', data: new Uint16Array(indices) },
  { name: 'pos', data: new Float32Array(positions) },
  { name: 'nrm', data: new Float32Array(normals) },
  { name: 'time', data: new Float32Array(times) },
  { name: 'quat', data: new Float32Array(quats) },
];

const views = [];
let offset = 0;
const blobs = [];
for (const part of parts) {
  const bytes = new Uint8Array(part.data.buffer);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    blobs.push(new Uint8Array(pad));
    offset += pad;
  }
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
  blobs.push(bytes);
  offset += bytes.byteLength;
}

const bin = new Uint8Array(offset);
let cursor = 0;
for (const blob of blobs) {
  bin.set(blob, cursor);
  cursor += blob.byteLength;
}

const json = {
  asset: { version: '2.0', generator: 'model-viewer test assets' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'TestCube' }],
  meshes: [{ name: 'TestCube', primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, material: 0 }] }],
  materials: [
    {
      name: 'TestMaterial',
      pbrMetallicRoughness: { baseColorFactor: [0.85, 0.35, 0.2, 1], metallicFactor: 0.1, roughnessFactor: 0.45 },
    },
  ],
  animations: [
    {
      name: 'Spin',
      samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
    },
  ],
  accessors: [
    { bufferView: 0, componentType: 5123, count: indices.length, type: 'SCALAR' },
    {
      bufferView: 1,
      componentType: 5126,
      count: positions.length / 3,
      type: 'VEC3',
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    },
    { bufferView: 2, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
    { bufferView: 3, componentType: 5126, count: times.length, type: 'SCALAR', min: [0], max: [2] },
    { bufferView: 4, componentType: 5126, count: quats.length / 4, type: 'VEC4' },
  ],
  bufferViews: views,
  buffers: [{ byteLength: bin.byteLength }],
};

const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
const binPad = (4 - (bin.byteLength % 4)) % 4;
const jsonLen = jsonBytes.byteLength + jsonPad;
const binLen = bin.byteLength + binPad;

const glb = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
const view = new DataView(glb.buffer);
view.setUint32(0, 0x46546c67, true);
view.setUint32(4, 2, true);
view.setUint32(8, glb.byteLength, true);
view.setUint32(12, jsonLen, true);
view.setUint32(16, 0x4e4f534a, true);
glb.set(jsonBytes, 20);
glb.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen);
view.setUint32(20 + jsonLen, binLen, true);
view.setUint32(24 + jsonLen, 0x004e4942, true);
glb.set(bin, 28 + jsonLen);

await writeFile(resolve(out, 'animated-cube.glb'), glb);

// -------------------------------------------------------- OBJ + MTL sibling pair

const obj = `# test asset
mtllib pyramid.mtl
o Pyramid
v -0.5 0 -0.5
v 0.5 0 -0.5
v 0.5 0 0.5
v -0.5 0 0.5
v 0 0.9 0
usemtl PyramidMaterial
f 1 2 3
f 1 3 4
f 1 5 2
f 2 5 3
f 3 5 4
f 4 5 1
`;

const mtl = `newmtl PyramidMaterial
Kd 0.25 0.6 0.95
Ks 0.4 0.4 0.4
Ns 60
d 1
illum 2
`;

await writeFile(resolve(out, 'pyramid.obj'), obj);
await writeFile(resolve(out, 'pyramid.mtl'), mtl);

console.log(`[test-assets] wrote animated-cube.glb (${glb.byteLength} B), pyramid.obj, pyramid.mtl`);
