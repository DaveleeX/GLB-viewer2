import type { HandheldHost } from './handheldHost';
import { paintHandheldQr } from './handheldHost';
import { isLoopbackUrl } from '../remote/lan';
import { addNote, addSlider, addSubhead, addToggle, el } from './controls';

export function mountHandheldPanel(parent: HTMLElement, host: HandheldHost): void {
  addSubhead(parent, '手机云台');
  const note = addNote(parent, '扫码后转动手机环绕看模型（始终框住模型）。双指捏合拉近拉远。');

  const box = el('div', 'handheld-box');
  box.hidden = true;
  const canvas = el('canvas', 'handheld-qr');
  canvas.width = 280;
  canvas.height = 280;
  canvas.setAttribute('aria-label', '手机遥控二维码');
  box.append(canvas);
  parent.append(box);

  const toggle = addToggle(parent, {
    label: '启用手机遥控',
    value: false,
    onChange: (on) => {
      if (on) {
        void host.enable().then(() => {
          if (!host.enabled) toggle.set(false);
          render();
        });
        return;
      }
      host.disable();
      render();
    },
  });

  addSlider(parent, {
    label: '运镜延迟',
    min: 0,
    max: 160,
    step: 5,
    suffix: 'ms',
    value: host.rig.delayMs,
    onInput: (v) => host.setDelay(v),
  });
  addSlider(parent, {
    label: '防抖',
    min: 0,
    max: 1,
    step: 0.01,
    value: host.rig.stabilize,
    onInput: (v) => host.setStabilize(v),
  });
  addSlider(parent, {
    label: '转向灵敏度',
    min: 0.3,
    max: 2,
    step: 0.05,
    value: host.rig.sensitivity,
    onInput: (v) => host.setSensitivity(v),
  });

  const render = () => {
    box.hidden = !host.enabled;
    toggle.set(host.enabled);
    note.textContent = host.enabled
      ? host.status
      : '扫码后转动手机环绕看模型（始终框住模型）。双指捏合拉近拉远。';
    const url = host.selectedUrl;
    canvas.hidden = !url;
    canvas.dataset.url = url && !isLoopbackUrl(url) ? url : '';
    if (host.enabled && url && !isLoopbackUrl(url)) void paintHandheldQr(canvas, url);
  };

  host.onChange = render;
  render();
}
