import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { USDZLoader } from 'three/addons/loaders/USDZLoader.js';
import { VOXLoader, buildMesh } from 'three/addons/loaders/VOXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FileResolver, MODEL_EXTENSIONS, SPLAT_EXTENSIONS, baseName, extensionOf, type NamedFile } from './fileMap';

export interface LoadResult {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  format: string;
  kind: 'mesh' | 'splat';
  /** Number of gaussians, for splat assets only. */
  splatCount?: number;
  cleanup: () => void;
}

export type ProgressFn = (ratio: number, label: string) => void;

const MODEL_EXT_SET = new Set<string>(MODEL_EXTENSIONS);
const SPLAT_EXT_SET = new Set<string>(SPLAT_EXTENSIONS);

export class ModelLoader {
  private readonly draco: DRACOLoader;
  private readonly ktx2: KTX2Loader;

  constructor(renderer: THREE.WebGLRenderer) {
    this.draco = new DRACOLoader().setDecoderPath('vendor/draco/');
    this.ktx2 = new KTX2Loader().setTranscoderPath('vendor/basis/').detectSupport(renderer);
  }

  async load(files: NamedFile[], onProgress: ProgressFn): Promise<LoadResult> {
    if (files.length === 0) throw new Error('没有可载入的文件');

    const root = pickRootFile(files);
    if (!root) {
      const names = files.map((f) => baseName(f.path)).slice(0, 5).join(', ');
      throw new Error(`未找到可识别的模型文件（${names}）`);
    }

    const ext = extensionOf(root.path);
    const resolver = new FileResolver(files);
    const cleanup = () => resolver.revokeAll();

    try {
      if (SPLAT_EXT_SET.has(ext)) return await this.loadSplat(root, cleanup, onProgress);
      if (ext === 'ply' && (await isSplatPly(root.file))) return await this.loadSplat(root, cleanup, onProgress);
      return await this.loadMesh(root, ext, resolver, cleanup, onProgress);
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  async loadFromUrl(url: string, onProgress: ProgressFn): Promise<LoadResult> {
    onProgress(0.05, '下载中');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
    const blob = await res.blob();
    const name = baseName(new URL(url, location.href).pathname) || 'model.glb';
    const file = new File([blob], name);
    return this.load([{ path: name, file }], onProgress);
  }

  // ------------------------------------------------------------- mesh formats

  private async loadMesh(
    root: NamedFile,
    ext: string,
    resolver: FileResolver,
    cleanup: () => void,
    onProgress: ProgressFn,
  ): Promise<LoadResult> {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((request) => {
      if (request.startsWith('blob:') || request.startsWith('data:')) return request;
      return resolver.resolveToUrl(request) ?? request;
    });
    manager.onProgress = (_url, loaded, total) => {
      if (total > 0) onProgress(0.1 + 0.85 * (loaded / total), '解析资源');
    };

    const rootUrl = resolver.url(root.file);
    onProgress(0.1, '解析模型');

    let object: THREE.Object3D;
    let animations: THREE.AnimationClip[] = [];

    switch (ext) {
      case 'glb':
      case 'gltf': {
        const loader = new GLTFLoader(manager)
          .setDRACOLoader(this.draco)
          .setKTX2Loader(this.ktx2)
          .setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.loadAsync(rootUrl);
        object = gltf.scene ?? gltf.scenes[0];
        animations = gltf.animations ?? [];
        break;
      }

      case 'obj': {
        const loader = new OBJLoader(manager);
        const mtl = await this.findMaterialLibrary(root, resolver, manager);
        if (mtl) loader.setMaterials(mtl);
        object = await loader.loadAsync(rootUrl);
        break;
      }

      case 'fbx': {
        const fbx = await new FBXLoader(manager).loadAsync(rootUrl);
        object = fbx;
        animations = fbx.animations ?? [];
        break;
      }

      case 'stl': {
        const geometry = await new STLLoader(manager).loadAsync(rootUrl);
        object = geometryToMesh(geometry, baseName(root.path));
        break;
      }

      case 'ply': {
        const geometry = await new PLYLoader(manager).loadAsync(rootUrl);
        object = geometryToMesh(geometry, baseName(root.path));
        break;
      }

      case '3mf': {
        object = await new ThreeMFLoader(manager).loadAsync(rootUrl);
        break;
      }

      case 'dae': {
        const collada = await new ColladaLoader(manager).loadAsync(rootUrl);
        if (!collada?.scene) throw new Error('Collada 文件解析为空');
        object = collada.scene;
        animations = collada.scene.animations ?? [];
        break;
      }

      case 'usdz': {
        object = await new USDZLoader(manager).loadAsync(rootUrl);
        break;
      }

      case 'vox': {
        const vox = await new VOXLoader(manager).loadAsync(rootUrl);
        const group = new THREE.Group();
        for (const chunk of vox.chunks) group.add(buildMesh(chunk));
        object = group;
        break;
      }

      default:
        throw new Error(`暂不支持的格式：.${ext}`);
    }

    onProgress(0.97, '准备场景');
    object.name = object.name || baseName(root.path);
    return { object, animations, format: ext.toUpperCase(), kind: 'mesh', cleanup };
  }

  /** Resolves the .mtl an .obj declares, falling back to any .mtl in the drop. */
  private async findMaterialLibrary(
    root: NamedFile,
    resolver: FileResolver,
    manager: THREE.LoadingManager,
  ): Promise<MTLLoader.MaterialCreator | null> {
    const head = await root.file.slice(0, 64 * 1024).text();
    const declared = /^\s*mtllib\s+(.+)$/im.exec(head)?.[1]?.trim();
    const mtlFile = (declared && resolver.find(declared)) || resolver.find('.mtl') || null;
    if (!mtlFile || extensionOf(mtlFile.name) !== 'mtl') return null;

    try {
      const creator = await new MTLLoader(manager).loadAsync(resolver.url(mtlFile));
      creator.preload();
      return creator;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------- gaussian splats

  private async loadSplat(root: NamedFile, cleanup: () => void, onProgress: ProgressFn): Promise<LoadResult> {
    onProgress(0.15, '载入高斯泼溅');
    const { SplatMesh } = await import('@sparkjsdev/spark');
    const bytes = new Uint8Array(await root.file.arrayBuffer());
    onProgress(0.5, '解码高斯泼溅');

    const mesh = await new Promise<InstanceType<typeof SplatMesh>>((resolve, reject) => {
      let settled: InstanceType<typeof SplatMesh> | null = null;
      try {
        settled = new SplatMesh({
          fileBytes: bytes,
          fileName: baseName(root.path),
          onLoad: () => resolve(settled!),
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    // Splat captures come out of most reconstruction pipelines upside down.
    mesh.quaternion.set(1, 0, 0, 0);
    mesh.name = baseName(root.path);

    onProgress(0.95, '准备场景');
    return {
      object: mesh,
      animations: [],
      format: extensionOf(root.path).toUpperCase(),
      kind: 'splat',
      splatCount: mesh.packedSplats?.numSplats,
      cleanup,
    };
  }

  dispose(): void {
    this.draco.dispose();
    this.ktx2.dispose();
  }
}

// ----------------------------------------------------------------- utilities

function pickRootFile(files: NamedFile[]): NamedFile | undefined {
  const candidates = files.filter((f) => {
    const ext = extensionOf(f.path);
    return MODEL_EXT_SET.has(ext) || SPLAT_EXT_SET.has(ext);
  });
  if (candidates.length === 0) return undefined;

  // Prefer self-contained formats, then the shallowest path, then the largest file.
  const rank = (f: NamedFile): number => {
    const ext = extensionOf(f.path);
    if (ext === 'glb') return 0;
    if (ext === 'gltf') return 1;
    if (SPLAT_EXT_SET.has(ext)) return 2;
    return 3;
  };
  const depth = (f: NamedFile): number => f.path.split(/[\\/]/).length;

  return candidates.sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b) || b.file.size - a.file.size)[0];
}

/**
 * A .ply may hold either a plain mesh or a gaussian-splat cloud. Splat exports
 * are identified by their spherical-harmonic and scale properties.
 */
async function isSplatPly(file: File): Promise<boolean> {
  const head = await file.slice(0, 2048).text();
  const headerEnd = head.indexOf('end_header');
  const header = headerEnd >= 0 ? head.slice(0, headerEnd) : head;
  return /property\s+float\s+(f_dc_0|scale_0|rot_0)/i.test(header);
}

function geometryToMesh(geometry: THREE.BufferGeometry, name: string): THREE.Mesh {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xb9c2d0,
    metalness: 0.05,
    roughness: 0.62,
    vertexColors: Boolean(geometry.attributes.color),
    side: geometry.attributes.normal ? THREE.FrontSide : THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}
