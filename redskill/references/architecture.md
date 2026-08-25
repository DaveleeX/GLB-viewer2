# Architecture notes

## FileResolver

Keep both a full-path map and a basename map. Look up glTF/OBJ URI in this order:

1. exact normalized relative path
2. suffix / prefix path match
3. basename-only fallback

Always revoke ObjectURLs on unload or failed load.

## Framing

Compute a bounding sphere of the loaded root. Place the orbit target at the sphere center. Distance = radius / sin(fov/2) with a small padding. When the sidebar is open, set `camera.setViewOffset` so the projection center sits in the remaining viewport, not the full canvas.

## Clip planes

```text
MAX_RATIO = 10000
if autoClip:
  near = max(dist/100, size/100, 0.001)
  far  = dist + size * 20
near = max(near, 0.0001)
far  = max(far, near * 2)
if far/near > MAX_RATIO: near = far / MAX_RATIO
```

Orthographic + autoClip: `near = -(radius*200 + 100)`, `far = radius*200 + 1000` so geometry between camera and subject is not clipped.

## Packed glTF

`metalnessMap` / `roughnessMap` often share one texture:

- roughness → green
- metalness → blue

Do not display the full RGB map as either channel.

## Post chain

Render → GTAO → UnrealBloom → OutputPass → LUT → Grade (lift/gamma/gain, sat, contrast, vignette) → SMAA or FXAA.

Disable bloom, AO, and grade while any isolator is active.

## GPU tier

Software (SwiftShader / llvmpipe) → low.
Discrete NVIDIA/AMD/Apple M → high (if not coarse pointer).
Weak Intel HD / Mali / old Adreno → low.
Phone: medium only if memory>=6 and cores>=6, else low.
DPR cap: low 1, medium 1.5, high 2.

## Spark

Dynamic `import('@sparkjsdev/spark')` only from the splat load path. Mesh loads must not import it.
