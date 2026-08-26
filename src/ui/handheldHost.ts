import { downloadBlob } from '../core/Recorder';
import type { HandheldRig } from '../core/HandheldRig';
import type { Viewer } from '../core/Viewer';
import { CamBus, camHubAvailable } from '../remote/bus';
import { isPhoneFriendlyLan, phoneOrigins } from '../remote/lan';
import { newRoomCode, type CamMsg } from '../remote/protocol';
import { drawQr } from '../remote/qr';

export interface HandheldHostHooks {
  screenshot: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  isRecording: () => boolean;
  notify: (message: string, kind?: 'info' | 'error' | 'success') => void;
}

export class HandheldHost {
  readonly room = newRoomCode();
  readonly rig: HandheldRig;
  phoneUrls: string[] = [];
  selectedUrl = '';
  enabled = false;
  status = '未开启';
  onChange: (() => void) | null = null;

  private bus: CamBus | null = null;
  private poseCount = 0;

  constructor(viewer: Viewer, private readonly hooks: HandheldHostHooks) {
    this.rig = viewer.handheld;
  }

  async enable(): Promise<void> {
    if (this.enabled) return;
    const ok = await camHubAvailable();
    if (!ok) {
      this.status = '当前页面没有配对服务';
      this.hooks.notify('手机云台需要通过 npm run dev --host 或 npm run preview --host 打开，电脑与手机须在同一 Wi‑Fi', 'error');
      this.onChange?.();
      return;
    }

    const urls = await phoneOrigins(this.room);
    this.phoneUrls = urls.slice(0, 1);
    this.selectedUrl = this.phoneUrls[0] ?? '';
    if (!this.selectedUrl) {
      this.status = '没有手机能打开的地址';
      this.hooks.notify('二维码不会使用 localhost。请把电脑连上 Wi‑Fi，手机也连同一网络，然后重新启用。', 'error');
      this.onChange?.();
      return;
    }

    this.bus = new CamBus('host', this.room);
    this.bus.onMessage = (msg) => this.handle(msg);
    this.bus.onStatus = (state) => {
      if (state === 'closed' && this.enabled) this.status = '配对连接中断，正在重试';
      if (state === 'open' && this.enabled && !this.rig.connected) {
        this.status = isPhoneFriendlyLan(this.selectedUrl)
          ? '等待手机扫码'
          : '等待扫码 · 电脑没连 Wi‑Fi，用的是有线网';
      }
      this.onChange?.();
    };
    this.bus.connect();
    this.enabled = true;
    this.rig.disconnect();
    if (isPhoneFriendlyLan(this.selectedUrl)) {
      this.status = '等待手机扫码';
    } else {
      this.status = '等待扫码 · 电脑没连 Wi‑Fi，用的是有线网';
      this.hooks.notify('这台电脑没有 Wi‑Fi 地址。请把电脑连上手机同一个 Wi‑Fi，或把手机连到电脑同一网段后再扫。', 'error');
    }
    this.onChange?.();
  }

  disable(): void {
    this.enabled = false;
    this.bus?.close();
    this.bus = null;
    this.selectedUrl = '';
    this.rig.disconnect();
    this.rig.stopPlayback();
    this.status = '未开启';
    this.onChange?.();
  }

  setDelay(ms: number): void {
    this.rig.delayMs = ms;
  }

  setStabilize(value: number): void {
    this.rig.stabilize = value;
  }

  setSensitivity(value: number): void {
    this.rig.sensitivity = value;
  }

  setMoveScale(value: number): void {
    this.rig.moveScale = value;
  }

  screenshot(): Promise<void> {
    return this.hooks.screenshot();
  }

  toggleRecord(): Promise<void> {
    return this.hooks.toggleRecording().then(() => this.sendState());
  }

  toggleTake(): void {
    if (this.rig.taking) {
      const take = this.rig.stopTake();
      void this.sendState();
      if (take) this.hooks.notify(`已记录镜头 ${take.duration.toFixed(1)}s`, 'success');
      else this.hooks.notify('镜头太短，没有保存');
      this.onChange?.();
      return;
    }
    this.rig.startTake();
    void this.sendState();
    this.hooks.notify('正在记录拍摄镜头');
    this.onChange?.();
  }

  playTake(): void {
    if (!this.rig.playTake()) {
      this.hooks.notify('还没有可回放的镜头');
      return;
    }
    this.hooks.notify('回放拍摄镜头');
    this.onChange?.();
  }

  exportTake(): void {
    const take = this.rig.take;
    if (!take) {
      this.hooks.notify('还没有可导出的镜头');
      return;
    }
    const blob = new Blob([JSON.stringify(take, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `camera-take-${take.recordedAt.slice(0, 19).replace(/[:T]/g, '')}.json`);
    this.hooks.notify('镜头路径已导出', 'success');
  }

  private handle(msg: CamMsg): void {
    switch (msg.type) {
      case 'phone-join':
      case 'hello':
        if (!this.rig.connected) {
          this.rig.connect();
          this.hooks.notify('手机云台已连接', 'success');
        }
        this.status = '手机已连接 · 转动环绕观看';
        this.poseCount = 0;
        void this.sendState();
        this.onChange?.();
        break;
      case 'phone-left':
        this.rig.disconnect();
        if (this.enabled) this.status = '手机已断开，等待重新扫码';
        this.onChange?.();
        break;
      case 'pose':
        this.rig.ingestDevice(msg.a, msg.b, msg.g, msg.o);
        this.poseCount++;
        if (this.poseCount === 1) {
          this.status = '手机已连接 · 转动环绕观看';
          this.onChange?.();
        }
        break;
      case 'dolly':
        this.rig.dolly(msg.delta);
        break;
      case 'calibrate':
        this.rig.alignToScreen(msg.a, msg.b, msg.g, msg.o);
        this.status = '已对准 · 转动手机环绕模型';
        this.hooks.notify('已对准环绕视角，模型会始终留在画面中', 'success');
        void this.bus?.send({ type: 'calibrated' }).catch(() => undefined);
        this.onChange?.();
        break;
      case 'shot':
        void this.hooks.screenshot();
        break;
      case 'record':
        void this.hooks.toggleRecording().then(() => this.sendState());
        break;
      case 'take':
        this.toggleTake();
        break;
      default:
        break;
    }
  }

  private async sendState(): Promise<void> {
    try {
      await this.bus?.send({
        type: 'state',
        recording: this.hooks.isRecording(),
        taking: this.rig.taking,
        playing: this.rig.playing,
      });
    } catch {
      /* phone may not be listening yet */
    }
  }
}

export async function paintHandheldQr(canvas: HTMLCanvasElement, url: string): Promise<void> {
  await drawQr(canvas, url);
}
