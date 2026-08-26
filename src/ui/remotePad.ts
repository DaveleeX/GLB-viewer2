import { CamBus } from '../remote/bus';
import { ROOM_RE, type CamMsg } from '../remote/protocol';
import '../styles/remote-pad.css';

type PermissionCtor = {
  requestPermission?: () => Promise<string>;
};

/**
 * Phone pad: orientation-only gimbal (industry standard for web 3D viewers).
 * No accelerometer position — that integration always drifts and flies away.
 * Pinch changes orbit distance only.
 */
export async function startRemotePad(room: string): Promise<void> {
  if (!ROOM_RE.test(room.toUpperCase())) {
    document.body.innerHTML = `<div class="pad"><h1>无效的配对码</h1><p>请回到电脑上的预览器，重新扫描二维码。</p></div>`;
    return;
  }

  const app = document.getElementById('app');
  if (app) {
    app.classList.add('hidden');
    app.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.add('is-remote-pad');
  document.title = '镜头遥控 · Model Viewer';

  const root = document.createElement('div');
  root.className = 'pad';
  root.innerHTML = `
    <p class="pad-kicker">Model Viewer</p>
    <h1>镜头遥控</h1>
    <p class="pad-status" id="pad-status">正在连接电脑…</p>
    <button class="pad-main" id="pad-motion" type="button">开始运镜</button>
    <button class="pad-link" id="pad-https" type="button" hidden>切换安全连接以启用陀螺仪</button>
    <div class="pad-actions">
      <button id="pad-shot" type="button">截图</button>
      <button id="pad-record" type="button">录屏</button>
      <button id="pad-take" type="button">记录镜头</button>
      <button id="pad-calibrate" type="button">重新对准</button>
    </div>
    <p class="pad-hint" id="pad-hint">对准电脑屏幕后点开始。转动手机环绕看模型（模型始终在画面中）；双指捏合拉近/拉远。</p>
  `;
  document.body.append(root);

  const status = byId('pad-status');
  const hint = byId('pad-hint');
  const motionBtn = byId('pad-motion');
  const httpsBtn = byId('pad-https');
  const recordBtn = byId('pad-record');
  const takeBtn = byId('pad-take');
  const bus = new CamBus('phone', room.toUpperCase());
  let lastSend = 0;
  let live = false;
  let gyroLive = false;
  let recording = false;
  let taking = false;
  let lookYaw = 0;
  let lookPitch = 90;
  let dragX = 0;
  let dragY = 0;
  let dragging = false;
  let lastAlpha = 0;
  let lastBeta = 90;
  let lastGamma = 0;
  let lastOrient = 0;
  let hasOrient = false;
  let aligned = false;
  let pinch0 = 0;
  let pinching = false;
  let lastPinchSend = 0;

  maybeOfferHttpsUpgrade();

  const setStatus = (text: string) => {
    status.textContent = text;
  };

  bus.onStatus = (state) => {
    if (state === 'open') setStatus(live ? liveHint() : secureHint());
    if (state === 'closed') setStatus('连接断开，正在重试…');
  };
  bus.onMessage = (msg) => {
    if (msg.type === 'host-left') setStatus('电脑已关闭遥控，请重新扫码');
    else if (msg.type === 'calibrated') {
      aligned = true;
      setStatus('已对准 · 转动手机环绕观看');
      hint.textContent = '像手持云台：左右转看左右，上下倾看俯仰。双指捏合拉近拉远。模型不会飞丢。';
    } else applyState(msg);
  };
  bus.connect();
  void bus.send({ type: 'hello', label: navigator.userAgent }).catch(() => setStatus('电脑没有配对服务，请用 npm run dev --host 打开预览器'));

  motionBtn.addEventListener('click', () => {
    void startControl();
  });
  httpsBtn.addEventListener('click', () => {
    location.href = httpsUpgradeUrl();
  });
  byId('pad-shot').addEventListener('click', () => void send({ type: 'shot' }));
  byId('pad-record').addEventListener('click', () => void send({ type: 'record' }));
  byId('pad-take').addEventListener('click', () => void send({ type: 'take' }));
  byId('pad-calibrate').addEventListener('click', () => {
    void alignToScreen();
  });

  root.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length === 1) {
        dragging = true;
        dragX = event.touches[0].clientX;
        dragY = event.touches[0].clientY;
      }
      if (event.touches.length >= 2) {
        dragging = false;
        pinching = true;
        pinch0 = Math.hypot(
          event.touches[0].clientX - event.touches[1].clientX,
          event.touches[0].clientY - event.touches[1].clientY,
        );
      }
    },
    { passive: true },
  );
  root.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length >= 2) {
        event.preventDefault();
        pinching = true;
        const gap = Math.hypot(
          event.touches[0].clientX - event.touches[1].clientX,
          event.touches[0].clientY - event.touches[1].clientY,
        );
        if (!pinch0) {
          pinch0 = gap;
          return;
        }
        const now = performance.now();
        if (now - lastPinchSend < 50) return;
        // Ratio from last accepted gap — fewer, larger steps = less jitter
        const ratio = gap / pinch0;
        if (ratio > 0.97 && ratio < 1.03) return;
        const delta = Math.log(ratio);
        pinch0 = gap;
        lastPinchSend = now;
        void send({ type: 'dolly', delta: clamp(delta, -0.12, 0.12) });
        return;
      }
      // Touch look only when gyro unavailable
      if (!live || gyroLive || pinching || !dragging || event.touches.length !== 1) return;
      const x = event.touches[0].clientX;
      const y = event.touches[0].clientY;
      lookYaw += (x - dragX) * 0.28;
      lookPitch = clamp(lookPitch + (y - dragY) * 0.22, 8, 172);
      dragX = x;
      dragY = y;
      void flushPose();
    },
    { passive: false },
  );
  root.addEventListener('touchend', (event) => {
    if (event.touches.length < 2) {
      pinch0 = 0;
      pinching = false;
    }
    if (event.touches.length === 0) dragging = false;
  });
  root.addEventListener('touchcancel', () => {
    pinch0 = 0;
    pinching = false;
    dragging = false;
  });

  async function startControl(): Promise<void> {
    live = true;
    motionBtn.hidden = true;
    const orientOk = await tryEnableGyro();
    setStatus(orientOk ? '请对准电脑屏幕，将自动锁定环绕视角' : liveHint());
    hint.textContent = orientOk
      ? '转动手机环绕模型；双指捏合拉近拉远。不会再用加速度计位移（那种会飞丢）。'
      : '未拿到陀螺仪时，可单指滑动转向、双指缩放。';
    void send({ type: 'hello' });
    window.setTimeout(() => {
      if (live) void alignToScreen();
    }, 350);
  }

  async function alignToScreen(): Promise<void> {
    setStatus('正在对准…');
    const orient = currentOrient();
    try {
      await bus.send({
        type: 'calibrate',
        a: orient.a,
        b: orient.b,
        g: orient.g,
        o: orient.o,
      });
    } catch {
      setStatus('对准失败，请确认电脑预览器仍开着');
    }
  }

  function currentOrient(): { a: number; b: number; g: number; o: number } {
    if (hasOrient || gyroLive) {
      return { a: lastAlpha, b: lastBeta, g: lastGamma, o: lastOrient };
    }
    return { a: lookYaw, b: lookPitch, g: 0, o: 0 };
  }

  async function tryEnableGyro(): Promise<boolean> {
    const Ctor = orientationCtor();
    if (!Ctor) return false;
    if (typeof Ctor.requestPermission === 'function') {
      try {
        const state = await Ctor.requestPermission();
        if (state !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!window.isSecureContext) return false;
    window.addEventListener('deviceorientation', onOrient, true);
    return true;
  }

  function onOrient(event: Event): void {
    const pose = event as { alpha?: number | null; beta?: number | null; gamma?: number | null };
    if (pose.alpha == null || pose.beta == null || pose.gamma == null) return;
    gyroLive = true;
    hasOrient = true;
    lastAlpha = pose.alpha;
    lastBeta = pose.beta;
    lastGamma = pose.gamma;
    lastOrient = screenAngle();
    void flushPose();
  }

  function flushPose(): void {
    if (!live || pinching) return;
    const now = performance.now();
    if (now - lastSend < 24) return;
    lastSend = now;
    const orient = currentOrient();
    void send({
      type: 'pose',
      a: orient.a,
      b: orient.b,
      g: orient.g,
      o: orient.o,
    });
  }

  function liveHint(): string {
    if (aligned) return '已对准 · 转动手机环绕观看';
    if (gyroLive) return '请对准电脑屏幕（将自动锁定）';
    return '等待陀螺仪…或单指滑动转向';
  }

  function secureHint(): string {
    if (window.isSecureContext) return '已连上电脑，请点开始运镜';
    return '当前不是安全连接，陀螺仪不可用。请切换安全连接或回电脑重新扫码。';
  }

  function maybeOfferHttpsUpgrade(): void {
    if (window.isSecureContext) return;
    if (location.protocol !== 'http:') return;
    httpsBtn.hidden = false;
  }

  function httpsUpgradeUrl(): string {
    const url = new URL(location.href);
    url.protocol = 'https:';
    const port = Number(url.port || 80);
    if (port === 80) url.port = '443';
    else url.port = String(port + 1);
    return url.href;
  }

  async function send(msg: CamMsg): Promise<void> {
    try {
      await bus.send(msg);
    } catch {
      setStatus('发送失败，请确认电脑预览器仍开着');
    }
  }

  function applyState(msg: CamMsg): void {
    if (msg.type !== 'state') return;
    recording = msg.recording;
    taking = msg.taking;
    recordBtn.classList.toggle('is-on', recording);
    takeBtn.classList.toggle('is-on', taking);
    recordBtn.textContent = recording ? '停止录屏' : '录屏';
    takeBtn.textContent = taking ? '停止记录' : '记录镜头';
  }
}

function orientationCtor(): PermissionCtor | undefined {
  return (window as unknown as { DeviceOrientationEvent?: PermissionCtor }).DeviceOrientationEvent;
}

function screenAngle(): number {
  const so = screen.orientation?.angle;
  if (typeof so === 'number') return so;
  const legacy = (window as Window & { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 ${id}`);
  return node as T;
}
