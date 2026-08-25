import * as THREE from 'three';

export type MaterialChannelId =
  | 'baseColor'
  | 'metalness'
  | 'roughness'
  | 'scattering'
  | 'translucency'
  | 'bump'
  | 'opacity'
  | 'specularF0'
  | 'clearcoat'
  | 'clearcoatRoughness';

export type GeometryChannelId = 'geomNormal' | 'uv' | 'vertexColor';

export type IsolatorId = MaterialChannelId | GeometryChannelId;

export interface ChannelDef<T extends IsolatorId = IsolatorId> {
  id: T;
  label: string;
  group: 'material' | 'geometry';
  icon: string;
}

/** Matches the Substance-style channel list the viewer is expected to isolate. */
export const MATERIAL_CHANNELS: ChannelDef<MaterialChannelId>[] = [
  { id: 'baseColor', label: 'Base Color', group: 'material', icon: 'droplet' },
  { id: 'metalness', label: 'Metalness', group: 'material', icon: 'bolt' },
  { id: 'roughness', label: 'Roughness', group: 'material', icon: 'stipple' },
  { id: 'scattering', label: 'Scattering', group: 'material', icon: 'dashed' },
  { id: 'translucency', label: 'Translucency', group: 'material', icon: 'dashed' },
  { id: 'bump', label: 'Bump Map', group: 'material', icon: 'bump' },
  { id: 'opacity', label: 'Opacity', group: 'material', icon: 'checker' },
  { id: 'specularF0', label: 'Specular F0', group: 'material', icon: 'orb' },
  { id: 'clearcoat', label: 'Clear Coat', group: 'material', icon: 'orb' },
  { id: 'clearcoatRoughness', label: 'Clear Coat Roughness', group: 'material', icon: 'stipple' },
];

export const GEOMETRY_CHANNELS: ChannelDef<GeometryChannelId>[] = [
  { id: 'geomNormal', label: 'Normal', group: 'geometry', icon: 'normal' },
  { id: 'uv', label: 'UV', group: 'geometry', icon: 'uv' },
  { id: 'vertexColor', label: 'Vertex Color', group: 'geometry', icon: 'vertex' },
];

export const ALL_CHANNELS: ChannelDef[] = [...MATERIAL_CHANNELS, ...GEOMETRY_CHANNELS];

type Swizzle = 0 | 1 | 2 | 3 | 4;

interface ScalarRead {
  map: THREE.Texture | null;
  /** 0=R 1=G 2=B 3=A 4=RGB */
  swizzle: Swizzle;
  tint: THREE.Color;
  factor: number;
  /** True when the mesh actually authors this channel, not just a default zero. */
  present: boolean;
}

function asStandard(material: THREE.Material): THREE.MeshStandardMaterial | null {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (material as THREE.MeshStandardMaterial)
    : null;
}

function asPhysical(material: THREE.Material): THREE.MeshPhysicalMaterial | null {
  return (material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial
    ? (material as THREE.MeshPhysicalMaterial)
    : null;
}

function colorOf(material: THREE.Material): THREE.Color {
  const coloured = material as THREE.MeshStandardMaterial;
  return coloured.color ? coloured.color.clone() : new THREE.Color(1, 1, 1);
}

function mapOf(material: THREE.Material): THREE.Texture | null {
  return (material as THREE.MeshStandardMaterial).map ?? null;
}

/**
 * glTF metallicRoughness is packed (G = roughness, B = metalness). Three.js
 * already swizzles that way in the real shader, so isolation has to match or
 * the viewer would show the packed texture instead of the authored channel.
 */
function readChannel(material: THREE.Material, id: MaterialChannelId): ScalarRead {
  const std = asStandard(material);
  const phys = asPhysical(material);
  const white = new THREE.Color(1, 1, 1);

  switch (id) {
    case 'baseColor':
      return {
        map: mapOf(material),
        swizzle: 4,
        tint: colorOf(material),
        factor: 1,
        present: true,
      };
    case 'metalness':
      return {
        map: std?.metalnessMap ?? null,
        swizzle: 2,
        tint: white,
        factor: std?.metalness ?? 0,
        present: Boolean(std && (std.metalnessMap || std.metalness > 0)),
      };
    case 'roughness':
      return {
        map: std?.roughnessMap ?? null,
        swizzle: 1,
        tint: white,
        factor: std?.roughness ?? 1,
        present: Boolean(std && (std.roughnessMap || true)),
      };
    case 'scattering':
      return {
        map: phys?.thicknessMap ?? null,
        swizzle: 1,
        tint: phys ? phys.attenuationColor.clone() : white,
        factor: phys?.thickness ?? 0,
        present: Boolean(phys && (phys.thicknessMap || phys.thickness > 0)),
      };
    case 'translucency':
      return {
        map: phys?.transmissionMap ?? null,
        swizzle: 0,
        tint: white,
        factor: phys?.transmission ?? 0,
        present: Boolean(phys && (phys.transmissionMap || phys.transmission > 0)),
      };
    case 'bump':
      if (std?.bumpMap) {
        return { map: std.bumpMap, swizzle: 0, tint: white, factor: 1, present: true };
      }
      if (std?.normalMap) {
        return { map: std.normalMap, swizzle: 4, tint: white, factor: 1, present: true };
      }
      return { map: null, swizzle: 4, tint: new THREE.Color(0.5, 0.5, 1), factor: 1, present: false };
    case 'opacity': {
      const alphaMap = (material as THREE.MeshStandardMaterial).alphaMap ?? null;
      if (alphaMap) {
        return { map: alphaMap, swizzle: 1, tint: white, factor: material.opacity, present: true };
      }
      if (mapOf(material) && (material.transparent || material.alphaTest > 0)) {
        return { map: mapOf(material), swizzle: 3, tint: white, factor: material.opacity, present: true };
      }
      return {
        map: null,
        swizzle: 0,
        tint: white,
        factor: material.opacity,
        present: material.opacity < 1 || material.transparent,
      };
    }
    case 'specularF0': {
      const ior = phys?.ior ?? 1.5;
      const f0 = ((ior - 1) / (ior + 1)) ** 2;
      const intensity = phys?.specularIntensity ?? 1;
      const specColor = phys?.specularColor ? phys.specularColor.clone() : white;
      if (phys?.specularColorMap) {
        return { map: phys.specularColorMap, swizzle: 4, tint: specColor, factor: intensity * f0, present: true };
      }
      if (phys?.specularIntensityMap) {
        return { map: phys.specularIntensityMap, swizzle: 3, tint: specColor, factor: intensity * f0, present: true };
      }
      return {
        map: null,
        swizzle: 4,
        tint: specColor.multiplyScalar(f0 * intensity),
        factor: 1,
        present: Boolean(phys),
      };
    }
    case 'clearcoat':
      return {
        map: phys?.clearcoatMap ?? null,
        swizzle: 0,
        tint: white,
        factor: phys?.clearcoat ?? 0,
        present: Boolean(phys && (phys.clearcoatMap || phys.clearcoat > 0)),
      };
    case 'clearcoatRoughness':
      return {
        map: phys?.clearcoatRoughnessMap ?? null,
        swizzle: 1,
        tint: white,
        factor: phys?.clearcoatRoughness ?? 0,
        present: Boolean(phys && (phys.clearcoatRoughnessMap || (phys.clearcoat > 0 && phys.clearcoatRoughness >= 0))),
      };
  }
}

const CHANNEL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
#ifdef HAS_UV
    vUv = uv;
#else
    vUv = vec2(0.0);
#endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CHANNEL_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float hasMap;
  uniform float swizzle;
  uniform vec3 tint;
  uniform float factor;
  varying vec2 vUv;

  void main() {
    vec3 color = tint * factor;
    if (hasMap > 0.5) {
      vec4 texel = texture2D(map, vUv);
      if (swizzle < 0.5) color = vec3(texel.r) * factor * tint;
      else if (swizzle < 1.5) color = vec3(texel.g) * factor * tint;
      else if (swizzle < 2.5) color = vec3(texel.b) * factor * tint;
      else if (swizzle < 3.5) color = vec3(texel.a) * factor * tint;
      else color = texel.rgb * tint * factor;
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

const UV_VERT = CHANNEL_VERT;

const UV_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 cell = floor(vUv * 8.0);
    float checker = mod(cell.x + cell.y, 2.0);
    vec2 grid = abs(fract(vUv * 8.0) - 0.5);
    float line = 1.0 - smoothstep(0.45, 0.48, max(grid.x, grid.y));
    vec3 color = mix(vec3(0.12, 0.13, 0.16), vec3(0.82, 0.34, 0.56), checker);
    color = mix(color, vec3(vUv, 0.15), 0.28);
    color = mix(color, vec3(0.95), line * 0.55);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function channelMaterial(read: ScalarRead, side: THREE.Side, geometry: THREE.BufferGeometry): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: geometry.hasAttribute('uv') ? { HAS_UV: '' } : {},
    uniforms: {
      map: { value: read.map },
      hasMap: { value: read.map ? 1 : 0 },
      swizzle: { value: read.swizzle },
      tint: { value: read.tint },
      factor: { value: read.factor },
    },
    vertexShader: CHANNEL_VERT,
    fragmentShader: CHANNEL_FRAG,
    side,
    toneMapped: false,
    fog: false,
  });
}

/** Builds a throwaway unlit material that shows one authored channel. */
export function isolateMaterial(
  source: THREE.Material,
  id: MaterialChannelId,
  geometry: THREE.BufferGeometry,
): THREE.Material {
  return channelMaterial(readChannel(source, id), source.side, geometry);
}

export function isolateGeometry(id: GeometryChannelId, geometry: THREE.BufferGeometry, side: THREE.Side): THREE.Material {
  if (id === 'geomNormal') {
    return new THREE.MeshNormalMaterial({ side, fog: false });
  }
  if (id === 'vertexColor') {
    const has = geometry.hasAttribute('color');
    return new THREE.MeshBasicMaterial({
      vertexColors: has,
      color: has ? 0xffffff : 0x3a4048,
      side,
      toneMapped: false,
      fog: false,
    });
  }
  return new THREE.ShaderMaterial({
    defines: geometry.hasAttribute('uv') ? { HAS_UV: '' } : {},
    vertexShader: UV_VERT,
    fragmentShader: UV_FRAG,
    side,
    toneMapped: false,
    fog: false,
  });
}

export function materialChannelPresent(material: THREE.Material, id: MaterialChannelId): boolean {
  return readChannel(material, id).present;
}

export function geometryChannelPresent(object: THREE.Object3D, id: GeometryChannelId): boolean {
  let found = false;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    if (id === 'geomNormal') found = true;
    else if (id === 'uv') found = found || geo.hasAttribute('uv');
    else found = found || geo.hasAttribute('color');
  });
  return found;
}

export const CHANNEL_ICONS: Record<string, string> = {
  droplet:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><path d="M6.2 9.2c0-1.5 1-2.6 1.8-4.1.8 1.5 1.8 2.6 1.8 4.1a1.8 1.8 0 0 1-3.6 0z" fill="currentColor"/></svg>',
  bolt:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><path d="M9.2 3.6 6.2 8.4h2.1L6.8 12.4 10.6 7.4H8.4z" fill="currentColor"/></svg>',
  stipple:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><g fill="currentColor">${dots}</g></svg>'.replace(
      '${dots}',
      [3.8, 5.6, 7.4, 9.2, 11, 4.7, 6.5, 8.3, 10.1, 5.6, 7.4, 9.2]
        .map((x, i) => `<circle cx="${x}" cy="${4.6 + Math.floor(i / 4) * 2.2}" r="0.55"/>`)
        .join(''),
    ),
  dashed:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-dasharray="2.2 1.6"/></svg>',
  bump:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><path d="M8 4.4v7.2M4.4 8h7.2M5.4 5.4l5.2 5.2M10.6 5.4 5.4 10.6" stroke="currentColor" fill="none"/></svg>',
  checker:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><path d="M4.4 8h7.2V4.4A3.6 3.6 0 0 0 8 4.4 3.6 3.6 0 0 0 4.4 8zm3.6 3.6A3.6 3.6 0 0 0 11.6 8H8z" fill="currentColor"/></svg>',
  orb:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><path d="M5.4 6.2a3 3 0 0 1 2.4-2.2" fill="none" stroke="currentColor" stroke-linecap="round"/></svg>',
  normal:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><path d="M8 11.4V4.6m0 0 2.2 2.2M8 4.6 5.8 6.8" fill="none" stroke="currentColor"/></svg>',
  uv:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><path d="M5 5.5h6v6H5z" fill="none" stroke="currentColor"/><path d="M5 8.5h6M8 5.5v6" stroke="currentColor"/></svg>',
  vertex:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor"/><circle cx="8" cy="5.4" r="1" fill="currentColor"/><circle cx="5.4" cy="11" r="1" fill="currentColor"/><circle cx="10.6" cy="11" r="1" fill="currentColor"/></svg>',
};
