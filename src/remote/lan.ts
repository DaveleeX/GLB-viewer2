export interface LanHost {
  ip: string;
  name: string;
  kind: 'wifi' | 'lan' | 'vpn' | 'other';
}

export function isLoopbackHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host);
}

export function isPhoneFriendlyLan(url: string): boolean {
  try {
    const [a, b] = new URL(url).hostname.split('.').map(Number);
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}

export function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return /localhost|127\.0\.0\.1|\[::1\]/i.test(url);
  }
}

export function controllerUrl(origin: string, room: string, pathname = location.pathname): string {
  const url = new URL(pathname, origin.endsWith('/') ? origin : `${origin}/`);
  url.search = '';
  url.hash = '';
  url.searchParams.set('cam', room);
  return url.href;
}

function originForIp(ip: string, secure = false): string {
  if (secure || location.protocol === 'https:') {
    const httpPort = Number(location.port || (location.protocol === 'https:' ? '443' : '80'));
    // Dev HTTP :5173 pairs with the lan-https sidecar on :5174.
    const httpsPort = location.protocol === 'https:' ? httpPort : httpPort + 1;
    return `https://${ip}:${httpsPort}`;
  }
  const port = location.port || '80';
  return `http://${ip}:${port}`;
}

export async function fetchLanHosts(): Promise<LanHost[]> {
  try {
    const res = await fetch(new URL('/__mv_cam/hosts', location.origin), { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { hosts?: LanHost[] };
    return Array.isArray(body.hosts) ? body.hosts : [];
  } catch {
    return [];
  }
}

function isUsableIpv4(ip: string): boolean {
  if (ip.startsWith('127.') || ip === '0.0.0.0' || ip.startsWith('169.254.')) return false;
  return true;
}

/** Browser ICE fallback if the pairing hub cannot list network interfaces. */
export function discoverPrivateIpv4(timeoutMs = 1600): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();
    const done = () => {
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        /* already closed */
      }
      resolve([...found]);
    };

    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('lan');
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        done();
        return;
      }
      const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(event.candidate.candidate);
      if (match && isUsableIpv4(match[1])) found.add(match[1]);
    };

    const timer = setTimeout(done, timeoutMs);
    void pc.createOffer().then((offer) => pc.setLocalDescription(offer));
  });
}

/** Phone-reachable controller URLs only — never localhost / 127.0.0.1. */
export async function phoneOrigins(room: string): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (href: string) => {
    if (!href || isLoopbackUrl(href) || seen.has(href)) return;
    seen.add(href);
    urls.push(href);
  };

  const hosts = await fetchLanHosts();
  const reachable = hosts.filter((host) => host.kind !== 'vpn');
  const list = reachable.length ? reachable : hosts;
  // Prefer HTTPS first so DeviceOrientation / DeviceMotion are allowed.
  for (const host of list) add(controllerUrl(originForIp(host.ip, true), room));
  for (const host of list) add(controllerUrl(originForIp(host.ip, false), room));
  if (!isLoopbackHost(location.hostname)) {
    if (location.protocol === 'https:') add(controllerUrl(location.origin, room));
    else {
      try {
        const https = new URL(location.origin);
        https.protocol = 'https:';
        https.port = String(Number(location.port || 80) + 1);
        add(controllerUrl(https.origin, room));
      } catch {
        /* ignore */
      }
      add(controllerUrl(location.origin, room));
    }
  }

  if (urls.length === 0) {
    for (const ip of await discoverPrivateIpv4()) {
      add(controllerUrl(originForIp(ip, true), room));
      add(controllerUrl(originForIp(ip, false), room));
    }
  }
  return urls;
}
