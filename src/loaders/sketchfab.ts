const HEX_UID = /[a-f0-9]{32}/i;

function hostname(url: URL): string {
  return url.hostname.replace(/^www\./, '').toLowerCase();
}

export function isSketchfabInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (/^[a-f0-9]{32}$/i.test(trimmed)) return true;
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed) && !trimmed.includes('.')) return true;
  try {
    const host = hostname(new URL(trimmed));
    return host === 'sketchfab.com' || host === 'skfb.ly';
  } catch {
    return false;
  }
}

/** Pulls a model id from a page URL, embed URL, or bare id. */
export function parseSketchfabUid(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^[a-f0-9]{32}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed) && !trimmed.includes('.')) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = hostname(url);
  if (host !== 'sketchfab.com' && host !== 'skfb.ly') return null;

  const fromModels = url.pathname.match(/\/models\/([A-Za-z0-9_-]+)(?:\/|$)/);
  if (fromModels) return fromModels[1];

  const fromSlug = url.pathname.match(/\/3d-models\/(?:[^/]*-)?([a-f0-9]{32})\/?$/i);
  if (fromSlug) return fromSlug[1].toLowerCase();

  const hex = trimmed.match(HEX_UID);
  return host === 'sketchfab.com' && hex ? hex[0].toLowerCase() : null;
}

export function sketchfabEmbedSrc(uid: string): string {
  const params = new URLSearchParams({
    autostart: '1',
    ui_theme: 'dark',
    ui_controls: '1',
    ui_infos: '1',
    ui_inspector: '1',
    ui_annotations: '1',
    ui_stop: '0',
    ui_help: '0',
    dnt: '1',
  });
  return `https://sketchfab.com/models/${uid}/embed?${params.toString()}`;
}

export interface SketchfabTarget {
  uid: string;
  title: string;
  embedSrc: string;
}

function oembedUrlFor(raw: string, uid: string | null): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    if (hostname(url) === 'sketchfab.com' || hostname(url) === 'skfb.ly') return trimmed;
  } catch {
    /* bare id */
  }
  if (uid) return `https://sketchfab.com/models/${uid}`;
  return trimmed;
}

function targetFromOembedHtml(html: string, title: string): SketchfabTarget | null {
  const src = html.match(/\ssrc=["']([^"']+)["']/i)?.[1];
  if (!src) return null;
  const uid = src.match(/\/models\/([A-Za-z0-9_-]+)\/embed/i)?.[1];
  if (!uid) return null;
  const embed = new URL(src, 'https://sketchfab.com');
  embed.searchParams.set('autostart', '1');
  embed.searchParams.set('ui_theme', 'dark');
  embed.searchParams.set('dnt', '1');
  return {
    uid,
    title: title.trim() || `Sketchfab ${uid.slice(0, 8)}`,
    embedSrc: embed.toString(),
  };
}

async function resolveViaOembed(pageUrl: string, timeoutMs: number): Promise<SketchfabTarget> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `https://sketchfab.com/oembed?url=${encodeURIComponent(pageUrl)}&format=json`;
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) throw new Error(`无法解析该链接（HTTP ${response.status}）`);
    const data = (await response.json()) as { title?: string; html?: string };
    const target = targetFromOembedHtml(String(data.html || ''), data.title || '');
    if (!target) throw new Error('未能从该链接解析出模型 ID，请改用模型页完整地址');
    return target;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('解析 Sketchfab 链接超时，请改用模型页完整地址');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveSketchfabModel(raw: string, timeoutMs = 8000): Promise<SketchfabTarget> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('请粘贴 Sketchfab 模型链接');

  const uid = parseSketchfabUid(trimmed);
  if (!uid && !isSketchfabInput(trimmed)) {
    throw new Error('请粘贴 Sketchfab 模型链接，例如 https://sketchfab.com/3d-models/…');
  }

  try {
    return await resolveViaOembed(oembedUrlFor(trimmed, uid), timeoutMs);
  } catch (error) {
    if (uid) {
      return {
        uid,
        title: `Sketchfab ${uid.slice(0, 8)}`,
        embedSrc: sketchfabEmbedSrc(uid),
      };
    }
    throw error;
  }
}
