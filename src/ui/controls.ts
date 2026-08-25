export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface PanelHandle {
  root: HTMLDetailsElement;
  body: HTMLDivElement;
  setNote(text: string): void;
}

export function createPanel(options: { title: string; hue: string; open?: boolean; note?: string }): PanelHandle {
  const root = el('details', 'panel');
  root.style.setProperty('--panel-hue', options.hue);
  root.open = options.open ?? false;

  const summary = el('summary');
  summary.append(el('span', undefined, options.title));
  const note = el('span', 'summary-note', options.note ?? '');
  summary.append(note);
  root.append(summary);

  const body = el('div', 'panel-body');
  root.append(body);

  return { root, body, setNote: (text) => (note.textContent = text) };
}

function row(parent: HTMLElement, label: string): HTMLDivElement {
  const wrap = el('div', 'ctrl');
  wrap.append(el('label', undefined, label));
  parent.append(wrap);
  return wrap;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  decimals?: number;
  suffix?: string;
  /** Spaces the track logarithmically, for values spanning orders of magnitude. */
  log?: boolean;
  onInput: (value: number) => void;
}

export interface SliderHandle {
  set(value: number): void;
  setEnabled(enabled: boolean): void;
}

export function addSlider(parent: HTMLElement, options: SliderOptions): SliderHandle {
  const wrap = row(parent, options.label);
  const input = el('input');
  input.type = 'range';

  const log = options.log === true;
  const clamp = (v: number) => Math.min(Math.max(v, options.min), options.max);
  const toTrack = (v: number) => (log ? Math.log10(clamp(v)) : v);
  const fromTrack = (t: number) => (log ? clamp(Math.pow(10, t)) : t);

  input.min = String(log ? Math.log10(options.min) : options.min);
  input.max = String(log ? Math.log10(options.max) : options.max);
  input.step = String(log ? 0.001 : options.step);
  input.value = String(toTrack(options.value));

  const readout = el('span', 'val');
  const fixed = options.decimals ?? (options.step < 0.1 ? 2 : options.step < 1 ? 1 : 0);
  const render = (value: number) => {
    const decimals = options.decimals ?? (log ? logDecimals(value) : fixed);
    readout.textContent = value.toFixed(decimals) + (options.suffix ?? '');
  };
  render(options.value);

  input.addEventListener('input', () => {
    const value = fromTrack(Number(input.value));
    render(value);
    options.onInput(value);
  });

  wrap.append(input, readout);

  return {
    set(value) {
      input.value = String(toTrack(value));
      render(value);
    },
    setEnabled(enabled) {
      input.disabled = !enabled;
      wrap.style.opacity = enabled ? '1' : '0.45';
    },
  };
}

/** Keeps a readable number of digits across a range that spans decades. */
function logDecimals(value: number): number {
  if (value >= 100) return 0;
  if (value >= 10) return 1;
  if (value >= 1) return 2;
  if (value >= 0.01) return 3;
  return 4;
}

export interface ToggleHandle {
  set(value: boolean): void;
}

export function addToggle(
  parent: HTMLElement,
  options: { label: string; value: boolean; onChange: (value: boolean) => void },
): ToggleHandle {
  const wrap = row(parent, options.label);
  wrap.append(el('span'));

  const button = el('button', 'switch');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(options.value));
  button.setAttribute('aria-label', options.label);

  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    options.onChange(next);
  });

  wrap.append(button);
  return { set: (value) => button.setAttribute('aria-checked', String(value)) };
}

export function addSelect<T extends string>(
  parent: HTMLElement,
  options: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void },
): { set(value: T): void } {
  const wrap = row(parent, options.label);
  const select = el('select');
  for (const option of options.options) {
    const node = el('option', undefined, option.label);
    node.value = option.value;
    select.append(node);
  }
  select.value = options.value;
  select.addEventListener('change', () => options.onChange(select.value as T));

  wrap.append(select, el('span', 'val'));
  return { set: (value) => (select.value = value) };
}

export function addSegmented<T extends string>(
  parent: HTMLElement,
  options: { options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void },
): { set(value: T): void } {
  const wrap = el('div', 'segmented');
  const buttons = new Map<T, HTMLButtonElement>();

  for (const option of options.options) {
    const button = el('button', undefined, option.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      select(option.value);
      options.onChange(option.value);
    });
    buttons.set(option.value, button);
    wrap.append(button);
  }

  const select = (value: T) => {
    for (const [key, button] of buttons) button.classList.toggle('is-active', key === value);
  };
  select(options.value);

  parent.append(wrap);
  return { set: select };
}

export function addColor(
  parent: HTMLElement,
  options: { label: string; value: string; onChange: (value: string) => void },
): { set(value: string): void } {
  const wrap = row(parent, options.label);
  const input = el('input');
  input.type = 'color';
  input.value = options.value;
  input.addEventListener('input', () => options.onChange(input.value));

  wrap.append(el('span'), input);
  return { set: (value) => (input.value = value) };
}

export function addButtons(
  parent: HTMLElement,
  buttons: Array<{ label: string; onClick: () => void; primary?: boolean; title?: string }>,
): HTMLButtonElement[] {
  const wrap = el('div', 'ctrl-row');
  const nodes = buttons.map((spec) => {
    const button = el('button', spec.primary ? 'btn btn-primary' : 'btn', spec.label);
    button.type = 'button';
    if (spec.title) button.title = spec.title;
    button.addEventListener('click', spec.onClick);
    wrap.append(button);
    return button;
  });
  parent.append(wrap);
  return nodes;
}

export function addSubhead(parent: HTMLElement, text: string): void {
  parent.append(el('div', 'panel-subhead', text));
}

export function addDivider(parent: HTMLElement): void {
  parent.append(el('div', 'panel-divider'));
}

export function addNote(parent: HTMLElement, text: string): HTMLParagraphElement {
  const node = el('p', 'panel-note', text);
  parent.append(node);
  return node;
}

/** Opens a file picker without keeping a hidden input in the DOM. */
export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = el('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.click();
  });
}
