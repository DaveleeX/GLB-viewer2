import { Viewer, type ViewDirection } from '../core/Viewer';
import { ModelLoader } from '../loaders/ModelLoader';
import { Recorder, downloadBlob } from '../core/Recorder';
import { createDemoScene } from '../core/demoScene';
import { buildPanels, type PanelsApi } from './buildPanels';
import { el } from './controls';
import {
  ENV_EXTENSIONS,
  LUT_EXTENSIONS,
  MODEL_EXTENSIONS,
  SPLAT_EXTENSIONS,
  baseName,
  extensionOf,
  filesFromDataTransfer,
  filesFromInput,
  type NamedFile,
} from '../loaders/fileMap';

const ACCEPT = [...MODEL_EXTENSIONS, ...SPLAT_EXTENSIONS, 'bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'ktx2', 'basis']
  .map((ext) => `.${ext}`)
  .join(',');

const VIEW_BUTTONS: Array<{ id: ViewDirection; label: string; title: string }> = [
  { id: 'front', label: '前', title: '前视图' },
  { id: 'back', label: '后', title: '后视图' },
  { id: 'left', label: '左', title: '左视图' },
  { id: 'right', label: '右', title: '右视图' },
  { id: 'top', label: '顶', title: '顶视图' },
  { id: 'iso', label: '轴测', title: '轴测视图' },
];

export class App {
  private readonly viewer: Viewer;
  private readonly loader: ModelLoader;
  private readonly recorder: Recorder;
  private readonly panels: PanelsApi;

  private readonly canvas = byId<HTMLCanvasElement>('viewport');
  private readonly emptyState = byId('empty-state');
  private readonly dropOverlay = byId('drop-overlay');
  private readonly sidebar = byId('sidebar');
  private readonly statsBar = byId('stats');
  private readonly timeline = byId('timeline');
  private readonly toasts = byId('toasts');
  private readonly progress = byId('progress');
  private readonly modelName = byId('model-name');
  private readonly fileInput = byId<HTMLInputElement>('file-input');

  private dragDepth = 0;
  private scrubbing = false;
  private fpsFrames = 0;
  private fpsSince = performance.now();
  private fpsLabel = '';

  constructor() {
    this.viewer = new Viewer(this.canvas);
    this.loader = new ModelLoader(this.viewer.renderer);
    this.recorder = new Recorder(this.canvas);
    this.panels = buildPanels(this.sidebar, this.viewer, (m, k) => this.toast(m, k));

    this.fileInput.accept = ACCEPT;

    this.buildViewPresets();
    this.buildTimeline();
    this.wireToolbar();
    this.wireDragAndDrop();
    this.wireKeyboard();
    this.wireViewerEvents();

    new ResizeObserver(() => {
      this.viewer.resize();
      this.syncFramingInset();
    }).observe(this.canvas);

    this.syncFramingInset();
    this.viewer.start();
    this.tickStats();

    this.panels.refreshStats();
    this.panels.refreshTree();
    this.panels.refreshChannels();
  }

  // ----------------------------------------------------------------- wiring

  private toggleSidebar(): void {
    document.body.classList.toggle('sidebar-collapsed');
    this.syncFramingInset();
  }

  private syncFramingInset(): void {
    const hidden =
      document.body.classList.contains('sidebar-collapsed') ||
      this.canvas.clientWidth < this.sidebar.offsetWidth * 2.4;
    this.viewer.setFramingInset(hidden ? 0 : this.sidebar.offsetWidth);
  }

  private wireViewerEvents(): void {
    this.viewer.onStatsChange = () => {
      this.panels.refreshStats();
      this.panels.refreshTree();
      this.panels.refreshChannels();
      this.renderStatsBar();
    };

    this.viewer.onSelect = (object) => this.panels.selectInTree(object);

    this.viewer.onFrame = (time, duration) => {
      if (this.scrubbing) return;
      const scrub = this.timeline.querySelector<HTMLInputElement>('.scrub');
      const readout = this.timeline.querySelector('.time-readout');
      if (scrub) scrub.value = String(duration > 0 ? time / duration : 0);
      if (readout) readout.textContent = `${time.toFixed(2)} / ${duration.toFixed(2)}s`;
    };
  }

  private wireToolbar(): void {
    byId('btn-open').addEventListener('click', () => this.fileInput.click());
    byId('empty-open').addEventListener('click', () => this.fileInput.click());
    byId('empty-sample').addEventListener('click', () => this.loadDemo());
    byId('btn-reset').addEventListener('click', () => this.viewer.frameModel());
    byId('btn-shot').addEventListener('click', () => void this.screenshot());
    byId('btn-record').addEventListener('click', () => void this.toggleRecording());
    byId('btn-fullscreen').addEventListener('click', () => void this.toggleFullscreen());
    byId('btn-sidebar').addEventListener('click', () => this.toggleSidebar());

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.length) void this.handleFiles(filesFromInput(this.fileInput.files));
      this.fileInput.value = '';
    });
  }

  private wireDragAndDrop(): void {
    const stop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('dragenter', (event) => {
      stop(event);
      this.dragDepth++;
      this.dropOverlay.classList.add('is-active');
    });

    window.addEventListener('dragover', stop);

    window.addEventListener('dragleave', (event) => {
      stop(event);
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) this.dropOverlay.classList.remove('is-active');
    });

    window.addEventListener('drop', (event) => {
      stop(event);
      this.dragDepth = 0;
      this.dropOverlay.classList.remove('is-active');
      if (event.dataTransfer) void this.handleDrop(event.dataTransfer);
    });
  }

  private wireKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

      switch (event.key) {
        case 'Tab':
          event.preventDefault();
          this.toggleSidebar();
          break;
        case 'f':
        case 'F':
          this.viewer.frameModel();
          break;
        case 'r':
        case 'R':
          this.viewer.settings.camera.autoRotate = !this.viewer.settings.camera.autoRotate;
          this.viewer.applyCamera();
          break;
        case ' ':
          if (this.viewer.animationClips.length > 0) {
            event.preventDefault();
            this.toggleAnimation();
          }
          break;
      }
    });
  }

  private buildViewPresets(): void {
    const host = byId('view-presets');
    for (const preset of VIEW_BUTTONS) {
      const button = el('button', undefined, preset.label);
      button.type = 'button';
      button.title = preset.title;
      button.addEventListener('click', () => this.viewer.setView(preset.id));
      host.append(button);
    }
  }

  private buildTimeline(): void {
    const clipSelect = el('select');
    clipSelect.addEventListener('change', () => {
      this.viewer.playClip(Number(clipSelect.value));
      this.setPlayIcon(true);
    });

    const playButton = el('button', 'icon-btn');
    playButton.type = 'button';
    playButton.title = '播放 / 暂停 (空格)';
    playButton.innerHTML = '<svg class="ico"><use href="#i-play" /></svg>';
    playButton.addEventListener('click', () => this.toggleAnimation());

    const scrub = el('input', 'scrub');
    scrub.type = 'range';
    scrub.min = '0';
    scrub.max = '1';
    scrub.step = '0.001';
    scrub.value = '0';
    const beginScrub = () => {
      this.scrubbing = true;
      this.viewer.pauseAnimation();
      this.setPlayIcon(false);
    };
    scrub.addEventListener('pointerdown', beginScrub);
    scrub.addEventListener('input', () => {
      const clip = this.viewer.animationClips[Number(clipSelect.value)] ?? this.viewer.animationClips[0];
      if (clip) this.viewer.seekAnimation(Number(scrub.value) * clip.duration);
    });
    scrub.addEventListener('pointerup', () => (this.scrubbing = false));

    const speed = el('select');
    for (const value of [0.25, 0.5, 1, 1.5, 2]) {
      const option = el('option', undefined, `${value}×`);
      option.value = String(value);
      if (value === 1) option.selected = true;
      speed.append(option);
    }
    speed.style.maxWidth = '62px';
    speed.addEventListener('change', () => this.viewer.setAnimationSpeed(Number(speed.value)));

    this.timeline.append(playButton, clipSelect, scrub, el('span', 'time-readout', '0.00 / 0.00s'), speed);
  }

  private setPlayIcon(playing: boolean): void {
    const button = this.timeline.querySelector('.icon-btn');
    if (button) button.innerHTML = `<svg class="ico"><use href="#i-${playing ? 'pause' : 'play'}" /></svg>`;
  }

  private toggleAnimation(): void {
    this.setPlayIcon(this.viewer.toggleAnimation());
  }

  private refreshTimeline(): void {
    const clips = this.viewer.animationClips;
    this.timeline.classList.toggle('hidden', clips.length === 0);
    if (clips.length === 0) return;

    const select = this.timeline.querySelector('select');
    if (select) {
      select.replaceChildren();
      clips.forEach((clip, index) => {
        const option = el('option', undefined, `${clip.name || `动画 ${index + 1}`} · ${clip.duration.toFixed(2)}s`);
        option.value = String(index);
        select.append(option);
      });
      select.value = '0';
    }
    this.setPlayIcon(this.viewer.isAnimationPlaying);
  }

  // ------------------------------------------------------------------ files

  private async handleDrop(dt: DataTransfer): Promise<void> {
    const files = await filesFromDataTransfer(dt);
    if (files.length > 0) {
      await this.handleFiles(files);
      return;
    }

    const url = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (url && /^https?:\/\//.test(url.trim())) await this.loadFromUrl(url.trim());
  }

  /**
   * Sorts a drop into environment maps, LUTs and model files, so users can drag
   * an HDRI or a .cube onto the viewport and have it just work.
   */
  private async handleFiles(files: NamedFile[]): Promise<void> {
    const envFile = files.find((f) => (ENV_EXTENSIONS as readonly string[]).includes(extensionOf(f.path)));
    const lutFile = files.find((f) => (LUT_EXTENSIONS as readonly string[]).includes(extensionOf(f.path)));
    const modelFiles = files.filter((f) => f !== envFile && f !== lutFile);

    if (envFile) {
      try {
        await this.viewer.loadEnvironmentFile(envFile.file);
        this.toast(`已应用环境贴图 ${baseName(envFile.path)}`, 'success');
      } catch (err) {
        this.toast(`环境贴图载入失败：${describe(err)}`, 'error');
      }
    }

    if (lutFile) {
      try {
        await this.viewer.loadLutFile(lutFile.file);
        this.toast(`已应用 LUT ${baseName(lutFile.path)}`, 'success');
      } catch (err) {
        this.toast(`LUT 载入失败：${describe(err)}`, 'error');
      }
    }

    if (modelFiles.length > 0) await this.loadModel(() => this.loader.load(modelFiles, this.onProgress));
  }

  private async loadFromUrl(url: string): Promise<void> {
    await this.loadModel(() => this.loader.loadFromUrl(url, this.onProgress));
  }

  private loadDemo(): void {
    this.viewer.setModel(createDemoScene());
    this.emptyState.classList.add('hidden');
    this.modelName.textContent = '示例 · 材质展示';
    this.refreshTimeline();
    this.toast('已载入示例场景', 'success');
  }

  private async loadModel(run: () => Promise<Awaited<ReturnType<ModelLoader['load']>>>): Promise<void> {
    this.showProgress(true, 0, '准备中');
    try {
      const result = await run();
      if (result.kind === 'splat') await this.viewer.enableSplatRendering();

      this.viewer.setModel(result);
      this.emptyState.classList.add('hidden');
      this.modelName.textContent = result.object.name || '未命名模型';
      this.refreshTimeline();
      this.toast(`已载入 ${result.format} 模型`, 'success');
    } catch (err) {
      console.error(err);
      this.toast(`载入失败：${describe(err)}`, 'error');
    } finally {
      this.showProgress(false, 1, '');
    }
  }

  private onProgress = (ratio: number, label: string): void => {
    this.showProgress(true, ratio, label);
  };

  private showProgress(visible: boolean, ratio: number, label: string): void {
    this.progress.classList.toggle('hidden', !visible);
    const fill = this.progress.querySelector<HTMLElement>('.progress-fill');
    const text = this.progress.querySelector('.progress-text');
    if (fill) fill.style.width = `${Math.round(ratio * 100)}%`;
    if (text && label) text.textContent = label;
  }

  // ---------------------------------------------------------------- capture

  private async screenshot(): Promise<void> {
    try {
      const transparent = this.viewer.settings.env.background === 'transparent';
      const blob = await this.viewer.captureImage(2, transparent);
      downloadBlob(blob, `viewer-${timestamp()}.png`);
      this.toast('截图已保存', 'success');
    } catch (err) {
      this.toast(`截图失败：${describe(err)}`, 'error');
    }
  }

  private async toggleRecording(): Promise<void> {
    const button = byId('btn-record');

    if (this.recorder.isRecording) {
      const { blob, extension } = await this.recorder.stop();
      button.classList.remove('is-recording');
      downloadBlob(blob, `viewer-${timestamp()}.${extension}`);
      this.toast('录制已保存', 'success');
      return;
    }

    if (!Recorder.isSupported) {
      this.toast('当前浏览器不支持视频录制', 'error');
      return;
    }

    try {
      this.recorder.start();
      button.classList.add('is-recording');
      this.toast('录制中… 再次点击结束');
    } catch (err) {
      this.toast(`录制启动失败：${describe(err)}`, 'error');
    }
  }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  // ------------------------------------------------------------------ stats

  private tickStats(): void {
    const loop = () => {
      this.fpsFrames++;
      const now = performance.now();
      if (now - this.fpsSince >= 500) {
        const fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
        this.fpsLabel = fps.toFixed(0);
        this.fpsFrames = 0;
        this.fpsSince = now;
        this.renderStatsBar();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private toast(text: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    const node = el('div', `toast${kind === 'info' ? '' : ` is-${kind}`}`, text);
    this.toasts.append(node);
    setTimeout(() => {
      node.style.transition = 'opacity .3s';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 320);
    }, kind === 'error' ? 5200 : 2600);
  }

  private renderStatsBar(): void {
    const stats = this.viewer.stats;
    const info = this.viewer.renderer.info.render;

    const parts = [`FPS <b>${this.fpsLabel}</b>`, `Draw <b>${info.calls}</b>`];
    if (stats) {
      if (stats.splats > 0) parts.push(`Splats <b>${format(stats.splats)}</b>`);
      else parts.push(`Tris <b>${format(stats.triangles)}</b>`);
      parts.push(`Mesh <b>${stats.meshes}</b>`, `Tex <b>${stats.textures}</b>`);
    }
    parts.push(`Tier <b>${this.viewer.settings.render.tier}</b>`);

    this.statsBar.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  }
}

// ---------------------------------------------------------------- utilities

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 DOM 节点 #${id}`);
  return node as T;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function format(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
