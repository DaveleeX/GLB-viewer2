# UI contract

Copy `styles/tokens.css`, `styles/base.css`, `styles/panels.css` into the app. Dark glass, 328px sidebar, 48px topbar.

## Empty state

Title: 通用模型预览器  
Sub: 拖放模型文件到此处，或选择文件开始预览  
Buttons: 选择模型文件 / 加载示例场景  
Format hint must list mesh, splat, and multi-file support.

## Topbar

打开 / 重置 / 截图 / 录屏 / 全屏 / 面板

## Panels (titles and hues)

| title | hue token |
| --- | --- |
| 场景与显示 | --g-scene |
| 环境与背景 | --g-env |
| 灯光与阴影 | --g-light |
| 相机 | --g-camera |
| 渲染与后期 | --g-render |
| 调色 | --g-color |

场景与显示 opens first. Isolator rows live here, not in a separate window.

## Shortcuts

Tab sidebar, F frame, R reset, Space play/pause.

## Stats

triangles, textures, format, FPS. Keep it as a corner readout, not a blocking overlay.
