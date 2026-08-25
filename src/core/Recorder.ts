const CANDIDATE_TYPES = [
  'video/mp4;codecs=avc1.4d002a',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export interface Recording {
  blob: Blob;
  extension: string;
}

/** Wraps MediaRecorder over the WebGL canvas, preferring MP4 where available. */
export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  static get isSupported(): boolean {
    return typeof MediaRecorder !== 'undefined' && CANDIDATE_TYPES.some((t) => MediaRecorder.isTypeSupported(t));
  }

  start(fps = 60, bitsPerSecond = 24_000_000): void {
    if (this.isRecording) return;

    this.mimeType = CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
    if (!this.mimeType) throw new Error('当前浏览器不支持视频录制');

    const stream = this.canvas.captureStream(fps);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: this.mimeType, videoBitsPerSecond: bitsPerSecond });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(100);
  }

  stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('没有正在进行的录制'));

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.chunks = [];
        this.recorder = null;
        resolve({ blob, extension: this.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' });
      };
      recorder.stop();
    });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
