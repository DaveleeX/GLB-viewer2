export const ROOM_RE = /^[A-Z2-9]{6}$/;

export function newRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Phone → host messages.
 * `pose` dx/dy/dz: translation in the screen frame (right / up / into-screen).
 * `calibrate`: phone is aimed at the computer screen — lock portal mapping.
 */
export type CamMsg =
  | { type: 'ready' }
  | { type: 'host-join' }
  | { type: 'phone-join' }
  | { type: 'host-left' }
  | { type: 'phone-left' }
  | { type: 'hello'; label?: string }
  | { type: 'pose'; a: number; b: number; g: number; o: number; dx?: number; dy?: number; dz?: number }
  | { type: 'dolly'; delta: number }
  | { type: 'calibrate'; a: number; b: number; g: number; o: number }
  | { type: 'calibrated' }
  | { type: 'shot' }
  | { type: 'record' }
  | { type: 'take' }
  | { type: 'state'; recording: boolean; taking: boolean; playing: boolean };

export function isCamMsg(value: unknown): value is CamMsg {
  return Boolean(value) && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}
