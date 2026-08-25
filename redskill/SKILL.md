---
name: model-viewer
description: 纯前端通用 3D 模型预览器。用户要做 Sketchfab / threejs.org 风格的本地上传预览、多格式网格或高斯泼溅查看、PBR 通道隔离、IBL/后期/动画时间轴时使用。Vite + TypeScript + three.js，无需后端。
version: 1.0.0
---

# model-viewer · 通用 3D 模型预览器

把本地模型拖进浏览器即可预览。纯前端：ObjectURL / 拖放，无后端，静态部署 `base: './'`。

**禁止**拷贝任何业务品牌、专用角色模型、商业 HDR 全景或机器狗相关命名。示例场景必须是程序化几何。程序化 IBL 优先；用户可自行拖入 HDR/EXR。

## When to use

- 用户要一个网页 3D 预览器 / Sketchfab 风格查看器
- 需要本地上传 glTF、OBJ、FBX、STL、PLY、高斯泼溅等
- 需要 Substance 风格材质通道隔离、ACES、三点光、后期、动画时间轴、截图/录屏

## Stack

- Vite + TypeScript + npm
- `three`（WebGLRenderer，不要用 Babylon）
- 高斯泼溅：`@sparkjsdev/spark` **动态 import**，未载入泼溅时不下载
- Draco / KTX2 / Meshopt：从 `three` 包复制到 `public/vendor`，禁止依赖 CDN

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/，可静态托管
```

`vite.config` 必须 `base: './'`。three 与 spark 拆成 manualChunks。

## Layout

```text
index.html
src/main.ts
src/ui/App.ts              拖放、顶栏、时间轴、空状态
src/ui/buildPanels.ts      侧栏面板
src/ui/controls.ts         滑条/开关/色板
src/core/Viewer.ts         场景、相机、灯光、框选、隔离
src/core/PostFX.ts         GTAO → Bloom → Output → LUT → Grade → AA
src/core/channels.ts       PBR / 几何通道隔离
src/core/environments.ts   程序化 IBL 预设
src/core/settings.ts       全部可调参数
src/core/tier.ts           GPU 档位
src/core/demoScene.ts      程序化示例，无外部模型
src/core/Recorder.ts       PNG / MP4|WebM
src/core/InfiniteGrid.ts
src/loaders/ModelLoader.ts
src/loaders/fileMap.ts     多文件相对路径 + 同名回退
src/styles/tokens.css      本 skill 已附带，照抄
src/styles/base.css
src/styles/panels.css
public/vendor/draco/       从 three examples 复制
public/vendor/basis/
```

本包不含 `.ts` 源码（SkillHub 不允许该扩展名）。实现时按本规范在工作区新建 Vite 工程，并把 `styles/` 拷到 `src/styles/`。

## Hard rules

1. 纯前端。文件用 `URL.createObjectURL`，卸载时 `revoke`。不要 fetch 用户磁盘绝对路径。
2. 多文件格式（gltf+bin+贴图，obj+mtl）按相对路径匹配，失败则按文件名回退。支持多选和文件夹拖入。
3. 侧栏打开时，用 camera view offset 把模型对齐到**可见区域中心**，不要对齐被面板挡住的画布中心。
4. 自动框选用包围球，模型旋转后不得出框。
5. 近远裁剪：`autoClip` 默认开。`far/near` 上限 **10000**，超过就把 near 提到 `far/10000`，避免深度乱序。正交相机 autoClip 时 near 可为负。
6. 隔离通道时关掉 Bloom / AO / Grade，避免后期污染通道视图。再点同一通道退出隔离。
7. packed glTF：metalness 读 **B**，roughness 读 **G**。
8. 高斯泼溅仅在真正打开 SPZ/SPLAT/KSPLAT/SOG 或 splat-PLY 时动态加载 Spark。
9. 不要把商业 HDR 打进公开发布包。环境默认用程序化预设。
10. 不要引入后端、账号、云存储。

## Formats

| 类别 | 扩展名 |
| --- | --- |
| 网格 | `.glb` `.gltf` `.obj` `.fbx` `.stl` `.ply` `.3mf` `.dae` `.usdz` `.vox` |
| 泼溅 | `.spz` `.splat` `.ksplat` `.sog`，以及高斯 PLY |
| 环境 | `.hdr` `.exr` |
| LUT | `.cube` `.3dl` |

glTF 必须接 Draco、KTX2/Basis、Meshopt。解码器路径：`vendor/draco/`、`vendor/basis/`。

PLY 先检测是否为 splat PLY，再决定走网格还是 Spark。

## Rendering

- 色调映射默认 **ACES Filmic**；可选 linear / reinhard / cineon / agx / neutral / none
- GPU 档位：`tier.ts` 根据 renderer 字符串与设备内存选 low/medium/high；DPR cap 1 / 1.5 / 2
- 阴影：PCF 柔和；可选关 / VSM
- 三点光：主光方位+仰角、补光、轮廓光；地面 ShadowMaterial 接影
- 程序化 IBL 预设至少：摄影棚、柔光箱、白背景、日光、黄昏（见 `references/environments.md`）
- 后期顺序（不可调换）：Render → GTAO → Bloom → Output(tonemap+sRGB) → LUT → Grade → SMAA/FXAA
- Bloom 必须在 OutputPass **之前**（场景线性 HDR）；LUT/调色在 OutputPass **之后**（显示空间）

## Material isolator

场景与显示面板，Substance 风格。无数据的通道可灰掉。

材质：Base Color、Metalness、Roughness、Scattering（thickness/attenuation）、Translucency（transmission）、Bump Map、Opacity、Specular F0、Clear Coat、Clear Coat Roughness

几何：Normal、UV、Vertex Color

着色模式另有：着色 / 着色+线框 / 线框 / 法线 / 素模(matcap)

## Camera

- OrbitControls + damping
- 六向 + 轴测预设
- 透视 / 正交
- 自动旋转
- Tab 显隐侧栏；F 重新框选；R 重置；Space 播放/暂停

## Animation / capture

- 载入后自动播放第一个 clip
- 时间轴、倍速、片段切换
- PNG 截图（可倍率）；MP4/WebM 录屏

## UI

深色玻璃 HUD。空状态：拖放 + 选择文件 + 加载程序化示例。顶栏：打开 / 重置 / 截图 / 录屏 / 全屏 / 面板。右侧可折叠面板，分组色见 `styles/tokens.css`。底部时间轴与 stats（三角面、贴图、FPS）。

面板标题固定为：场景与显示、环境与背景、灯光与阴影、相机、渲染与后期、调色。

## Acceptance

- 拖入 GLB 能出图、能旋转缩放、能自动框选
- 拖入带 bin+贴图的 glTF 文件夹能装配，而不是粉模丢贴图
- 点 Metalness / Roughness 能看到隔离，再点退出
- 打开侧栏后模型仍在可见区域中心
- 拉大 far/near 差距不会出现三角面闪烁乱序
- `npm run build` 产物可直接静态打开（相对路径）
- 首屏不加载 Spark；打开 splat 后才加载

更细的文件约定见 `references/`。
