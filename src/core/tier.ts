import type { QualityTier } from './settings';

/**
 * Picks a starting quality tier from the GPU string and coarse device signals.
 * The user can always override it; this only decides sensible defaults so that
 * a phone does not open on a 4K shadow map.
 */
export function detectTier(gl: WebGL2RenderingContext | WebGLRenderingContext): QualityTier {
  const override = new URLSearchParams(location.search).get('tier');
  if (override === 'low' || override === 'medium' || override === 'high') return override;

  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    /* blocked by privacy settings — fall back to the heuristics below */
  }
  const gpu = renderer.toLowerCase();

  const software = /swiftshader|llvmpipe|software|basic render/.test(gpu);
  if (software) return 'low';

  const discrete = /rtx|radeon rx|geforce (gtx|rtx)|arc a|quadro|apple m[1-9]/.test(gpu);
  if (discrete && !coarse) return 'high';

  const weak = /intel.*(hd|uhd) graphics (5|6)\d{2}/.test(gpu) || /mali-g[2-5]\d/.test(gpu) || /adreno \(tm\) [45]\d{2}/.test(gpu);
  if (weak) return 'low';

  if (coarse) return memory >= 6 && cores >= 6 ? 'medium' : 'low';
  if (cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}

/** Caps the device pixel ratio so huge-DPR displays stay interactive. */
export function pixelRatioCap(tier: QualityTier): number {
  return tier === 'low' ? 1 : tier === 'medium' ? 1.5 : 2;
}
