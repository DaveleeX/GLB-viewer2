import { networkInterfaces } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type Role = 'host' | 'phone';

interface Client {
  role: Role;
  res: ServerResponse;
}

interface Room {
  clients: Client[];
  last: number;
}

const ROOM_RE = /^[A-Z2-9]{6}$/;
const rooms = new Map<string, Room>();

function getUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost');
}

export function listLanHosts(): Array<{ ip: string; name: string; kind: 'wifi' | 'lan' | 'vpn' | 'other' }> {
  const hosts: Array<{ ip: string; name: string; kind: 'wifi' | 'lan' | 'vpn' | 'other'; rank: number }> = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (skipIface(name)) continue;
    for (const addr of addrs ?? []) {
      const family = String(addr.family);
      if (family !== 'IPv4' && family !== '4') continue;
      if (addr.internal) continue;
      const ip = addr.address;
      if (!ip || ip.startsWith('169.254.')) continue;
      const kind = classifyIface(name, ip);
      hosts.push({ ip, name, kind, rank: rankKind(kind, ip) });
    }
  }
  hosts.sort((a, b) => a.rank - b.rank || a.ip.localeCompare(b.ip));
  return hosts.map(({ ip, name, kind }) => ({ ip, name, kind }));
}

function skipIface(name: string): boolean {
  return /vmware|virtualbox|vbox|hyper-v|vethernet|docker|bluetooth|loopback|pseudo|wsl/i.test(name);
}

function classifyIface(name: string, ip: string): 'wifi' | 'lan' | 'vpn' | 'other' {
  if (/wi-?fi|wlan|无线|airport/i.test(name)) return 'wifi';
  if (/wireguard|vpn|tun|tap|utun|ppp|aliwire/i.test(name)) return 'vpn';
  if (isRfc1918(ip)) return 'lan';
  return 'other';
}

function isRfc1918(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function rankKind(kind: 'wifi' | 'lan' | 'vpn' | 'other', ip: string): number {
  if (kind === 'wifi') return 0;
  if (kind === 'lan' || isRfc1918(ip)) return 1;
  if (kind === 'other') return 2;
  return 3;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function cors(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

function readBody(req: IncomingMessage, limit = 8192): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function getRoom(id: string): Room {
  let room = rooms.get(id);
  if (!room) {
    room = { clients: [], last: Date.now() };
    rooms.set(id, room);
  }
  return room;
}

function prune(): void {
  const now = Date.now();
  for (const [id, room] of rooms) {
    room.clients = room.clients.filter((client) => !client.res.writableEnded);
    if (room.clients.length === 0 && now - room.last > 30 * 60_000) rooms.delete(id);
  }
}

function broadcast(room: Room, from: Client | null, data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  room.last = Date.now();
  for (const client of room.clients) {
    if (client === from || client.res.writableEnded) continue;
    client.res.write(payload);
  }
}

function handleEvents(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const roomId = (url.searchParams.get('room') ?? '').toUpperCase();
  const role = url.searchParams.get('role') as Role;
  if (!ROOM_RE.test(roomId) || (role !== 'host' && role !== 'phone')) {
    json(res, 400, { error: 'bad room or role' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'ready' })}\n\n`);

  const room = getRoom(roomId);
  const client: Client = { role, res };
  room.clients.push(client);
  room.last = Date.now();
  broadcast(room, client, { type: role === 'phone' ? 'phone-join' : 'host-join' });

  const ping = setInterval(() => {
    if (res.writableEnded) return;
    res.write(':ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(ping);
    room.clients = room.clients.filter((item) => item !== client);
    broadcast(room, null, { type: role === 'phone' ? 'phone-left' : 'host-left' });
    prune();
  });
}

async function handleSend(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const roomId = (url.searchParams.get('room') ?? '').toUpperCase();
  if (!ROOM_RE.test(roomId)) {
    json(res, 400, { error: 'bad room' });
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: 'bad json' });
    return;
  }
  const room = rooms.get(roomId);
  if (!room) {
    json(res, 404, { error: 'no room' });
    return;
  }
  broadcast(room, null, payload);
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
  res.end();
}

function attach(middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }): void {
  middlewares.use((req, res, next) => {
    const raw = req.url ?? '';
    if (!raw.startsWith('/__mv_cam')) {
      next();
      return;
    }
    if (cors(req, res)) return;
    const url = getUrl(req);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && path === '/__mv_cam/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && path === '/__mv_cam/hosts') {
      json(res, 200, { hosts: listLanHosts() });
      return;
    }
    if (req.method === 'GET' && path === '/__mv_cam/events') {
      handleEvents(req, res, url);
      return;
    }
    if (req.method === 'POST' && path === '/__mv_cam/send') {
      void handleSend(req, res, url).catch(() => json(res, 500, { error: 'send failed' }));
      return;
    }
    json(res, 404, { error: 'not found' });
  });
}

/** Local-only pairing hub so a phone on the same Wi-Fi can steer the desktop camera. */
export function remoteCamHub(): Plugin {
  return {
    name: 'remote-cam-hub',
    enforce: 'pre',
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}
