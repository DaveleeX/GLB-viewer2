import * as THREE from 'three';

/**
 * A ground grid drawn analytically in the fragment shader, so line weight stays
 * constant on screen and the grid dissolves with distance instead of ending at
 * a hard edge the way GridHelper does.
 */
export class InfiniteGrid extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  constructor() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        cellSize: { value: 0.25 },
        sectionSize: { value: 2.5 },
        cellColor: { value: new THREE.Color(0x2c3543) },
        sectionColor: { value: new THREE.Color(0x4a5b72) },
        axisColor: { value: new THREE.Color(0x4a9bff) },
        fadeDistance: { value: 24 },
        fadeStrength: { value: 1.6 },
        opacity: { value: 0.9 },
        showAxes: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        uniform float cellSize;
        uniform float sectionSize;
        uniform vec3 cellColor;
        uniform vec3 sectionColor;
        uniform vec3 axisColor;
        uniform float fadeDistance;
        uniform float fadeStrength;
        uniform float opacity;
        uniform float showAxes;

        // Screen-space-consistent line coverage for a grid of the given pitch.
        float gridLine(vec2 p, float pitch) {
          vec2 coord = p / pitch;
          vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          return 1.0 - min(min(grid.x, grid.y), 1.0);
        }

        void main() {
          vec2 p = vWorld.xz;

          float cells = gridLine(p, cellSize);
          float sections = gridLine(p, sectionSize);

          vec3 color = cellColor;
          float alpha = cells * 0.55;

          color = mix(color, sectionColor, sections);
          alpha = max(alpha, sections * 0.9);

          if (showAxes > 0.5) {
            vec2 axis = abs(p) / fwidth(p);
            float onAxis = 1.0 - min(min(axis.x, axis.y), 1.0);
            color = mix(color, axisColor, onAxis);
            alpha = max(alpha, onAxis);
          }

          float d = length(p) / fadeDistance;
          alpha *= 1.0 - clamp(pow(d, fadeStrength), 0.0, 1.0);
          if (alpha < 0.002) discard;

          gl_FragColor = vec4(color, alpha * opacity);
        }
      `,
    });

    super(new THREE.PlaneGeometry(1, 1), material);
    this.rotation.x = -Math.PI / 2;
    this.frustumCulled = false;
    this.renderOrder = -1;
    this.name = 'InfiniteGrid';
  }

  /** Re-pitches the grid so it reads well at the scale of the current model. */
  fitTo(radius: number): void {
    const extent = Math.max(radius * 12, 1);
    this.scale.set(extent, extent, 1);

    // Snap the cell pitch to a 1/2/5 sequence, like a chart axis.
    const raw = radius / 4;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
    const norm = raw / magnitude;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * magnitude;

    const u = this.material.uniforms;
    u.cellSize.value = step;
    u.sectionSize.value = step * 10;
    u.fadeDistance.value = Math.max(radius * 9, 1);
  }

  setAxesVisible(visible: boolean): void {
    this.material.uniforms.showAxes.value = visible ? 1 : 0;
  }
}
