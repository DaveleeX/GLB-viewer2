// Headless smoke test: boots the viewer, loads the demo scene, exercises the
// panels and captures screenshots. Run with: node scripts/smoke.mjs [url]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://localhost:5173/';
const outDir = 'smoke-out';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  ignoreHTTPSErrors: true,
});

const errors = [];
const warnings = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error') errors.push(text);
  else if (msg.type() === 'warning' && !/X4122|X4000|deprecated/i.test(text)) warnings.push(text);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const step = async (name, fn) => {
  const before = errors.length;
  await fn();
  const added = errors.slice(before);
  console.log(`${added.length === 0 ? 'PASS' : 'FAIL'}  ${name}${added.length ? `\n      ${added.join('\n      ')}` : ''}`);
};

await step('page loads', async () => {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#viewport');
});

await step('empty state renders', async () => {
  await page.waitForSelector('#empty-state:not(.hidden)');
  await page.screenshot({ path: `${outDir}/01-empty.png` });
});

await step('sketchfab source toggle', async () => {
  await page.click('#source-sketchfab');
  await page.waitForSelector('#empty-sketchfab-pane:not(.hidden)');
  await page.fill('#empty-sketchfab-url', 'not-a-sketchfab-link');
  await page.click('#empty-sketchfab-submit');
  await page.waitForSelector('.toast.is-error');
  await page.click('#source-file');
  await page.waitForSelector('#empty-file-pane:not(.hidden)');
});

await step('demo scene loads', async () => {
  await page.click('#empty-sample');
  await page.waitForSelector('#empty-state.hidden', { state: 'attached' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/02-demo.png` });
});

await step('stats populate', async () => {
  const text = await page.textContent('#stats');
  if (!text?.includes('Tris')) throw new Error(`stats bar missing triangle count: "${text}"`);
  const tris = await page.textContent('.kv');
  if (!tris) throw new Error('info panel empty');
});

await step('scene tree populates', async () => {
  const rows = await page.locator('.tree-row').count();
  if (rows < 5) throw new Error(`expected model hierarchy rows, got ${rows}`);
});

await step('environment presets switch', async () => {
  for (const index of [3, 4, 5]) {
    await page.locator('.thumb').nth(index).click();
    await page.waitForTimeout(220);
  }
  await page.screenshot({ path: `${outDir}/03-env-night.png` });
});

await step('bundled HDR panorama loads', async () => {
  const thumb = page.locator('.thumb[title="金属棚拍"]');
  await thumb.click();
  // The spinner only clears once the .hdr has been fetched and decoded.
  await page.waitForFunction(
    () => !document.querySelector('.thumb[title="金属棚拍"]')?.classList.contains('is-busy'),
    undefined,
    { timeout: 15000 },
  );
  if (!(await thumb.evaluate((el) => el.classList.contains('is-active')))) {
    throw new Error('HDR thumbnail did not stay selected, so the load was rolled back');
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/09-hdri.png` });
});

await step('material channel isolation', async () => {
  const row = page.locator('.channel-row', { hasText: 'Base Color' });
  await row.click();
  await page.waitForTimeout(300);
  if (!(await row.evaluate((el) => el.classList.contains('is-active')))) {
    throw new Error('Base Color channel did not stay selected');
  }
  await page.screenshot({ path: `${outDir}/10-channel.png` });
  await row.click();
});

await step('shading modes switch', async () => {
  const panel = page.locator('.panel', { hasText: '场景与显示' });
  for (const label of ['线框', '法线', '素模', '着色']) {
    await panel.locator('.segmented button', { hasText: new RegExp(`^${label}$`) }).first().click();
    await page.waitForTimeout(200);
  }
});

await step('post-processing panel toggles', async () => {
  const panel = page.locator('.panel', { hasText: '后期特效' });
  await panel.locator('summary').click();
  await panel.locator('input[type=range]').first().evaluate((el) => {
    el.value = '1.6';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);
});

await step('view presets orbit', async () => {
  for (const label of ['前', '顶', '轴测']) {
    await page.locator('#view-presets button', { hasText: label }).click();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: `${outDir}/04-iso.png` });
});

await step('orthographic projection', async () => {
  const panel = page.locator('.panel', { hasText: '相机' }).first();
  await panel.locator('summary').click();
  await panel.locator('.segmented button', { hasText: '正交' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/05-ortho.png` });
  await panel.locator('.segmented button', { hasText: '透视' }).click();
});

await step('near / far clip can be set by hand', async () => {
  const panel = page.locator('.panel', { hasText: '相机' }).first();
  const auto = panel.locator('.ctrl', { hasText: '自动裁剪' }).locator('button.switch');
  if ((await auto.getAttribute('aria-checked')) === 'true') await auto.click();
  const near = panel.locator('.ctrl', { hasText: '近裁剪' }).locator('input[type=range]');
  await near.evaluate((el) => {
    el.disabled = false;
    el.value = '0.2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}/05b-clip.png` });
});

await step('handheld camera panel exposes QR remote', async () => {
  const panel = page.locator('.panel', { hasText: '相机' }).first();
  const copy = await panel.textContent();
  if (!copy?.includes('手机云台')) throw new Error('camera panel is missing the handheld section');
  await panel.locator('.ctrl', { hasText: '启用手机遥控' }).locator('button.switch').click();
  await page.waitForSelector('.handheld-box:not([hidden]) canvas.handheld-qr:not([hidden])');
  const health = await page.evaluate(async () => {
    const res = await fetch('/__mv_cam/health');
    return res.ok;
  });
  if (!health) throw new Error('remote camera hub is not mounted');
  await page.screenshot({ path: `${outDir}/05c-handheld.png` });
});

await step('canvas is actually drawing', async () => {
  const nonBlank = await page.evaluate(() => {
    const canvas = document.getElementById('viewport');
    const probe = document.createElement('canvas');
    probe.width = 160;
    probe.height = 100;
    const ctx = probe.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 160, 100);
    const { data } = ctx.getImageData(0, 0, 160, 100);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return seen.size;
  });
  if (nonBlank < 20) throw new Error(`canvas looks blank (${nonBlank} distinct colours)`);
  console.log(`      canvas has ${nonBlank} distinct colours`);
});

await step('sidebar toggle', async () => {
  await page.click('#btn-sidebar');
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${outDir}/06-clean.png` });
  await page.click('#btn-sidebar');
  await page.waitForTimeout(320);
});

await step('animated GLB loads from file input', async () => {
  await page.setInputFiles('#file-input', 'test-assets/animated-cube.glb');
  await page.waitForFunction(() => document.getElementById('model-name')?.textContent?.includes('animated-cube'));
  await page.waitForTimeout(600);

  const timelineHidden = await page.locator('#timeline').evaluate((el) => el.classList.contains('hidden'));
  if (timelineHidden) throw new Error('timeline stayed hidden for an animated model');

  const clip = await page.locator('#timeline select').first().textContent();
  if (!clip?.includes('Spin')) throw new Error(`expected the "Spin" clip, got "${clip}"`);

  const stats = await page.textContent('#stats');
  if (!/Tris\s*12(?!\d)/.test(stats ?? '')) throw new Error(`expected 12 triangles, stats read "${stats}"`);

  await page.screenshot({ path: `${outDir}/07-glb.png` });
});

await step('animation plays and advances', async () => {
  const readout = page.locator('#timeline .time-readout');
  const before = await readout.textContent();
  await page.waitForTimeout(900);
  const after = await readout.textContent();
  if (before === after) throw new Error(`animation clock did not advance (stuck at ${before})`);
  if (!/\/ 2\.00s/.test(after ?? '')) throw new Error(`expected a 2.00s clip duration, got "${after}"`);
});

await step('OBJ resolves its sibling MTL', async () => {
  await page.setInputFiles('#file-input', ['test-assets/pyramid.obj', 'test-assets/pyramid.mtl']);
  await page.waitForFunction(() => document.getElementById('model-name')?.textContent?.includes('pyramid'));
  await page.waitForTimeout(600);

  const timelineHidden = await page.locator('#timeline').evaluate((el) => el.classList.contains('hidden'));
  if (!timelineHidden) throw new Error('timeline should hide for a static model');

  const stats = await page.textContent('#stats');
  if (!/Tris\s*6(?!\d)/.test(stats ?? '')) throw new Error(`expected 6 triangles, stats read "${stats}"`);

  // A .mtl that failed to resolve to its blob URL would 404 and surface as a
  // console error, which the step wrapper turns into a failure.
  await page.screenshot({ path: `${outDir}/08-obj.png` });
});

await step('screenshot capture downloads a PNG', async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-shot')]);
  const name = download.suggestedFilename();
  if (!name.endsWith('.png')) throw new Error(`expected a .png download, got "${name}"`);
});

console.log(`\nerrors: ${errors.length}, unexpected warnings: ${warnings.length}`);
for (const w of warnings.slice(0, 10)) console.log(`  warn: ${w}`);

await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
