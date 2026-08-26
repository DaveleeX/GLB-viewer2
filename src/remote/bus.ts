import { ROOM_RE, isCamMsg, type CamMsg } from './protocol';

export async function camHubAvailable(): Promise<boolean> {
  try {
    const res = await fetch(new URL('/__mv_cam/health', location.origin), { cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export class CamBus {
  private source: EventSource | null = null;
  private closed = false;
  onMessage: ((msg: CamMsg) => void) | null = null;
  onStatus: ((state: 'connecting' | 'open' | 'closed') => void) | null = null;

  constructor(
    readonly role: 'host' | 'phone',
    readonly room: string,
  ) {
    if (!ROOM_RE.test(room)) throw new Error('无效的配对码');
  }

  connect(): void {
    this.close();
    this.closed = false;
    this.onStatus?.('connecting');
    const url = new URL('/__mv_cam/events', location.origin);
    url.searchParams.set('room', this.room);
    url.searchParams.set('role', this.role);
    const source = new EventSource(url);
    this.source = source;
    source.onopen = () => {
      if (!this.closed) this.onStatus?.('open');
    };
    source.onerror = () => {
      if (this.closed) return;
      this.onStatus?.('closed');
    };
    source.onmessage = (event) => {
      try {
        const data: unknown = JSON.parse(event.data);
        if (isCamMsg(data)) this.onMessage?.(data);
      } catch {
        /* ignore malformed hub frames */
      }
    };
  }

  async send(msg: CamMsg): Promise<void> {
    const url = new URL('/__mv_cam/send', location.origin);
    url.searchParams.set('room', this.room);
    url.searchParams.set('role', this.role);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).then((res) => {
      if (!res.ok) throw new Error(`配对通道 ${res.status}`);
    });
  }

  close(): void {
    this.closed = true;
    this.source?.close();
    this.source = null;
    this.onStatus?.('closed');
  }
}
