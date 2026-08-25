import * as THREE from 'three';
import type { LoadResult } from '../loaders/ModelLoader';

/**
 * A built-in material showcase so the viewer has something to render before the
 * user supplies a file. Exercises the paths that matter for product and vehicle
 * work: clearcoat, transmission, anisotropy, iridescence and plain rough metal.
 */
export function createDemoScene(): LoadResult {
  const group = new THREE.Group();
  group.name = 'Material Showcase';

  const sphere = new THREE.SphereGeometry(0.5, 64, 48);

  const swatches: Array<{ name: string; material: THREE.Material }> = [
    {
      name: 'Car Paint',
      material: new THREE.MeshPhysicalMaterial({
        color: 0x1b3f8f,
        metalness: 0.85,
        roughness: 0.22,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
      }),
    },
    {
      name: 'Glass',
      material: new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.03,
        transmission: 1,
        thickness: 0.7,
        ior: 1.5,
        transparent: true,
      }),
    },
    {
      name: 'Brushed Metal',
      material: new THREE.MeshPhysicalMaterial({
        color: 0xc9cfd8,
        metalness: 1,
        roughness: 0.28,
        anisotropy: 0.9,
        anisotropyRotation: Math.PI / 4,
      }),
    },
    {
      name: 'Iridescent',
      material: new THREE.MeshPhysicalMaterial({
        color: 0x101820,
        metalness: 0.6,
        roughness: 0.15,
        iridescence: 1,
        iridescenceIOR: 1.9,
        iridescenceThicknessRange: [120, 520],
      }),
    },
    {
      name: 'Matte Ceramic',
      material: new THREE.MeshPhysicalMaterial({ color: 0xe4e0d8, metalness: 0, roughness: 0.78, sheen: 0.4 }),
    },
  ];

  const spacing = 1.25;
  const offset = ((swatches.length - 1) * spacing) / 2;

  swatches.forEach((swatch, index) => {
    const mesh = new THREE.Mesh(sphere, swatch.material);
    mesh.name = swatch.name;
    mesh.position.set(index * spacing - offset, 0.5, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.42, 0.14, 220, 36),
    new THREE.MeshPhysicalMaterial({ color: 0xd8a24a, metalness: 1, roughness: 0.18, clearcoat: 0.4 }),
  );
  knot.name = 'Torus Knot';
  knot.position.set(0, 1.5, -1.5);
  knot.castShadow = true;
  knot.receiveShadow = true;
  group.add(knot);

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(swatches.length * spacing + 0.9, 0.12, 1.5),
    new THREE.MeshPhysicalMaterial({ color: 0x2a3038, metalness: 0.1, roughness: 0.45 }),
  );
  plinth.name = 'Plinth';
  plinth.position.set(0, -0.06, 0);
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  group.add(plinth);

  return {
    object: group,
    animations: [],
    format: 'DEMO',
    kind: 'mesh',
    cleanup: () => {},
  };
}
