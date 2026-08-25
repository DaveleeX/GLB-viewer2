# Procedural IBL presets

Build each preset as a small three.js scene of `RectAreaLight` (or emissive planes) + a gradient sky, then `PMREMGenerator.fromScene`. Dispose the helper scene after baking.

Do not ship commercial HDR files in the skill or the default viewer build.

| id | label | character |
| --- | --- | --- |
| studio | 摄影棚 | cool key + large overhead + bounce |
| softbox | 柔光箱 | large white key, dim fill |
| white | 白背景 | bright even, white bounce |
| outdoor | 日光 | small hot sun, blue fill, ground bounce |
| sunset | 黄昏 | warm low key, cool fill |

Users may replace any preset by dropping `.hdr` / `.exr`. Cache decoded textures by object URL / name. Only fetch a panorama when the user selects it.

Also keep a code-only gradient/color/transparent background path that does not require HDR.
