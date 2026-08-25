import * as THREE from 'three';

/**
 * Display-referred grading: lift / gamma / gain, tint, saturation, contrast and
 * a vignette, folded into a single pass. Runs after OutputPass so the controls
 * behave the way a colourist expects rather than fighting the tone curve.
 */
export const GradeShader = {
  name: 'GradeShader',

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 1 },
    saturation: { value: 1 },
    shadows: { value: 0 },
    midtones: { value: 1 },
    highlights: { value: 1 },
    tint: { value: new THREE.Color(0xffffff) },
    vignette: { value: 0 },
    vignetteSoftness: { value: 0.55 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    uniform float shadows;
    uniform float midtones;
    uniform float highlights;
    uniform vec3 tint;
    uniform float vignette;
    uniform float vignetteSoftness;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      // lift / gamma / gain
      c = c * highlights + shadows;
      c = max(c, vec3(0.0));
      c = pow(c, vec3(1.0 / max(midtones, 0.001)));

      c *= tint;

      // saturation around Rec.709 luma
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);

      // contrast around mid grey
      c = (c - 0.5) * contrast + 0.5;

      if (vignette > 0.0) {
        vec2 d = vUv - 0.5;
        float r = length(d) * 1.4142;
        float inner = mix(0.95, 0.15, clamp(vignetteSoftness, 0.0, 1.0));
        float v = 1.0 - vignette * smoothstep(inner, 1.05, r);
        c *= v;
      }

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), texel.a);
    }
  `,
};
