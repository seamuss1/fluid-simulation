(function () {
  const canvas = document.getElementById("sim-canvas");
  const eyebrow = document.querySelector(".eyebrow");
  const headline = document.querySelector(".brand h1");
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");
  const modeBtn = document.getElementById("mode-btn");
  const pourBtn = document.getElementById("pour-btn");
  const autoBtn = document.getElementById("auto-btn");
  const paletteBtn = document.getElementById("palette-btn");
  const primaryLabel = document.getElementById("primary-label");
  const secondaryLabel = document.getElementById("secondary-label");
  const tertiaryLabel = document.getElementById("tertiary-label");
  const weightInput = document.getElementById("weight-input");
  const glossInput = document.getElementById("gloss-input");
  const bodyInput = document.getElementById("body-input");
  const status = document.getElementById("status");
  const gpuNote = document.getElementById("gpu-note");

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    failIfMajorPerformanceCaveat: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    status.textContent = "WebGL2 is missing here.";
    document.body.classList.add("unsupported");
    return;
  }

  const ext = gl.getExtension("EXT_color_buffer_float");
  if (!ext) {
    status.textContent = "Floating point framebuffers are unavailable.";
    return;
  }

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const gpuInfo = detectGpu(gl);
  updateGpuNote();

  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);

  const modeConfigs = {
    heavy: {
      title: "Heavy Current",
      headline: "Drag to stretch the liquid. Tap to drop it.",
      footer: "Thick drips. Slow stretch. WebGL2 powered.",
      action: "Pour",
      activity: "auto pour",
      liquidMode: 1,
      labels: ["Weight", "Gloss", "Body"],
      controls: [
        { min: 20, max: 90, value: 54 },
        { min: 0, max: 100, value: 46 },
        { min: 970, max: 998, value: 993 },
      ],
      palettes: [
        {
          name: "Amber",
          sample(t) {
            return [
              0.92 + 0.08 * Math.sin(t * 0.9 + 0.2),
              0.52 + 0.28 * Math.sin(t * 1.1 + 1.3),
              0.1 + 0.12 * Math.sin(t * 1.5 + 2.6),
            ];
          },
        },
        {
          name: "Moss",
          sample(t) {
            return [
              0.18 + 0.12 * Math.sin(t * 1.1 + 1.1),
              0.48 + 0.28 * Math.sin(t * 1.4 + 0.4),
              0.12 + 0.08 * Math.sin(t * 1.8 + 2.0),
            ];
          },
        },
        {
          name: "Chrome",
          sample(t) {
            return [
              0.72 + 0.16 * Math.sin(t * 1.6 + 0.8),
              0.72 + 0.16 * Math.sin(t * 1.2 + 2.2),
              0.74 + 0.18 * Math.sin(t * 1.8 + 1.7),
            ];
          },
        },
      ],
    },
    arc: {
      title: "Arc Current",
      headline: "Drag to stir. Tap to ignite.",
      footer: "Fast curls. Bright trails. WebGL2 powered.",
      action: "Ignite",
      activity: "auto drift",
      liquidMode: 0,
      labels: ["Swirl", "Glow", "Trail"],
      controls: [
        { min: 10, max: 80, value: 42 },
        { min: 0, max: 100, value: 58 },
        { min: 920, max: 999, value: 986 },
      ],
      palettes: [
        {
          name: "Ember",
          sample(t) {
            return [
              0.88 + 0.12 * Math.sin(t * 0.9),
              0.28 + 0.32 * Math.sin(t * 1.3 + 1.1),
              0.08 + 0.18 * Math.sin(t * 1.7 + 2.7),
            ];
          },
        },
        {
          name: "Aurora",
          sample(t) {
            return [
              0.18 + 0.24 * Math.sin(t * 1.2 + 2.1),
              0.75 + 0.22 * Math.sin(t * 1.4 + 0.7),
              0.48 + 0.42 * Math.sin(t * 1.8 + 1.4),
            ];
          },
        },
        {
          name: "Voltage",
          sample(t) {
            return [
              0.9 + 0.08 * Math.sin(t * 1.5 + 0.6),
              0.84 + 0.14 * Math.sin(t * 1.1 + 2.3),
              0.2 + 0.3 * Math.sin(t * 2.2 + 1.9),
            ];
          },
        },
      ],
    },
  };

  const config = {
    velocityDissipation: 0.986,
    dyeDissipation: 0.993,
    pressureIterations: 24,
    splatRadius: 0.00038,
    splatForce: 3600.0,
    curl: 11.0,
    glow: 0.46,
    gravity: 118.0,
    velocityDiffuse: 0.2,
    dyeDiffuse: 0.18,
    containment: 0.0,
    autoBurstInterval: 210,
    auto: true,
  };

  const pointers = new Map();
  let modeKey = "heavy";
  let palettes = modeConfigs[modeKey].palettes;
  let paletteIndex = 0;
  let sim = null;
  let paused = false;
  let lastTime = performance.now();
  let lastAutoBurst = 0;
  let fps = 0;
  let fpsSmoother = 0.08;
  let framesSinceUpdate = 0;

  const baseVertexShader = `#version 300 es
    precision highp float;
    out vec2 vUv;
    void main() {
      vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      vUv = pos;
      gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
    }
  `;

  const clearShader = `#version 300 es
    precision highp float;
    uniform vec4 value;
    out vec4 fragColor;
    void main() {
      fragColor = value;
    }
  `;

  const splatShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTarget;
    uniform vec2 point;
    uniform vec3 color;
    uniform float radius;
    uniform float aspect;
    out vec4 fragColor;

    vec4 sanitize(vec4 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec4(0.0, 0.0, 0.0, 1.0);
      }
      return clamp(value, vec4(-limit, -limit, -limit, 0.0), vec4(limit, limit, limit, 1.0));
    }

    void main() {
      vec2 delta = vUv - point;
      delta.x *= aspect;
      float falloff = exp(-dot(delta, delta) / radius);
      vec4 base = sanitize(texture(uTarget, vUv), 512.0);
      fragColor = sanitize(base + vec4(color * falloff, 0.0), 512.0);
    }
  `;

  const forceShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 force;
    uniform float dt;
    uniform float damping;
    out vec4 fragColor;

    vec2 sanitize(vec2 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec2(0.0);
      }
      return clamp(value, vec2(-limit), vec2(limit));
    }

    void main() {
      vec2 velocity = sanitize(texture(uVelocity, vUv).xy, 512.0);
      velocity = velocity * damping + force * dt;
      fragColor = vec4(sanitize(velocity, 512.0), 0.0, 1.0);
    }
  `;

  const relaxShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTarget;
    uniform vec2 texelSize;
    uniform float blend;
    uniform float centerLift;
    uniform float dt;
    out vec4 fragColor;

    vec4 sanitize(vec4 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec4(0.0, 0.0, 0.0, 1.0);
      }
      return clamp(value, vec4(-limit, -limit, -limit, 0.0), vec4(limit, limit, limit, 1.0));
    }

    void main() {
      vec4 center = sanitize(texture(uTarget, vUv), 512.0);
      vec4 left = sanitize(texture(uTarget, vUv - vec2(texelSize.x, 0.0)), 512.0);
      vec4 right = sanitize(texture(uTarget, vUv + vec2(texelSize.x, 0.0)), 512.0);
      vec4 bottom = sanitize(texture(uTarget, vUv - vec2(0.0, texelSize.y)), 512.0);
      vec4 top = sanitize(texture(uTarget, vUv + vec2(0.0, texelSize.y)), 512.0);
      vec4 softened = (left + right + bottom + top + center * centerLift) / (4.0 + centerLift);
      float scaledBlend = 1.0 - pow(clamp(1.0 - blend, 0.0, 1.0), dt * 60.0);
      fragColor = sanitize(mix(center, softened, scaledBlend), 512.0);
    }
  `;

  const containShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform float dt;
    uniform float strength;
    out vec4 fragColor;

    vec2 sanitize(vec2 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec2(0.0);
      }
      return clamp(value, vec2(-limit), vec2(limit));
    }

    void main() {
      vec2 velocity = sanitize(texture(uVelocity, vUv).xy, 512.0);
      float left = 1.0 - smoothstep(0.0, 0.08, vUv.x);
      float right = smoothstep(0.92, 1.0, vUv.x);
      float bottom = 1.0 - smoothstep(0.0, 0.18, vUv.y);
      float top = smoothstep(0.96, 1.0, vUv.y);
      float wall = clamp(left + right + bottom + top, 0.0, 1.0);

      vec2 inward = vec2(left - right, bottom * 1.65 - top * 0.35);
      velocity += inward * strength * dt;
      velocity *= 1.0 - wall * 0.36;

      if (bottom > 0.01) {
        velocity.y = max(velocity.y, -18.0 * (1.0 - bottom));
        velocity.x += sin(vUv.y * 42.0 + vUv.x * 8.0) * bottom * strength * dt * 0.16;
      }

      fragColor = vec4(sanitize(velocity, 512.0), 0.0, 1.0);
    }
  `;

  const advectionShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;
    out vec4 fragColor;

    vec4 sanitize(vec4 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec4(0.0, 0.0, 0.0, 1.0);
      }
      return clamp(value, vec4(-limit, -limit, -limit, 0.0), vec4(limit, limit, limit, 1.0));
    }

    vec2 sanitize2(vec2 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec2(0.0);
      }
      return clamp(value, vec2(-limit), vec2(limit));
    }

    vec4 bilerp(sampler2D tex, vec2 uv) {
      vec2 texSize = 1.0 / texelSize;
      vec2 coord = clamp(uv * texSize - 0.5, vec2(0.0), texSize - 2.0);
      vec2 index = floor(coord);
      vec2 fraction = fract(coord);

      vec2 uv00 = (index + vec2(0.5)) * texelSize;
      vec2 uv10 = uv00 + vec2(texelSize.x, 0.0);
      vec2 uv01 = uv00 + vec2(0.0, texelSize.y);
      vec2 uv11 = uv00 + texelSize;

      vec4 a = texture(tex, uv00);
      vec4 b = texture(tex, uv10);
      vec4 c = texture(tex, uv01);
      vec4 d = texture(tex, uv11);

      return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
    }

    void main() {
      vec2 velocity = sanitize2(bilerp(uVelocity, vUv).xy, 512.0);
      vec2 coord = clamp(vUv - dt * velocity * texelSize, texelSize * 0.5, 1.0 - texelSize * 0.5);
      float scaledDissipation = pow(clamp(dissipation, 0.0, 1.0), dt * 60.0);
      fragColor = sanitize(scaledDissipation * bilerp(uSource, coord), 512.0);
    }
  `;

  const divergenceShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 texelSize;
    out vec4 fragColor;

    vec2 sanitize(vec2 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec2(0.0);
      }
      return clamp(value, vec2(-limit), vec2(limit));
    }

    void main() {
      vec2 left = sanitize(texture(uVelocity, vUv - vec2(texelSize.x, 0.0)).xy, 512.0);
      vec2 right = sanitize(texture(uVelocity, vUv + vec2(texelSize.x, 0.0)).xy, 512.0);
      vec2 bottom = sanitize(texture(uVelocity, vUv - vec2(0.0, texelSize.y)).xy, 512.0);
      vec2 top = sanitize(texture(uVelocity, vUv + vec2(0.0, texelSize.y)).xy, 512.0);
      float div = 0.5 * ((right.x - left.x) + (top.y - bottom.y));
      fragColor = vec4(div, 0.0, 0.0, 1.0);
    }
  `;

  const pressureShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    uniform vec2 texelSize;
    out vec4 fragColor;

    float sanitize1(float value, float limit) {
      if (isnan(value) || isinf(value)) {
        return 0.0;
      }
      return clamp(value, -limit, limit);
    }

    void main() {
      float left = sanitize1(texture(uPressure, vUv - vec2(texelSize.x, 0.0)).x, 512.0);
      float right = sanitize1(texture(uPressure, vUv + vec2(texelSize.x, 0.0)).x, 512.0);
      float bottom = sanitize1(texture(uPressure, vUv - vec2(0.0, texelSize.y)).x, 512.0);
      float top = sanitize1(texture(uPressure, vUv + vec2(0.0, texelSize.y)).x, 512.0);
      float div = sanitize1(texture(uDivergence, vUv).x, 512.0);
      float pressure = (left + right + bottom + top - div) * 0.25;
      fragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
  `;

  const gradientSubtractShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    uniform vec2 texelSize;
    out vec4 fragColor;

    vec2 sanitize(vec2 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec2(0.0);
      }
      return clamp(value, vec2(-limit), vec2(limit));
    }

    float sanitize1(float value, float limit) {
      if (isnan(value) || isinf(value)) {
        return 0.0;
      }
      return clamp(value, -limit, limit);
    }

    void main() {
      float left = sanitize1(texture(uPressure, vUv - vec2(texelSize.x, 0.0)).x, 512.0);
      float right = sanitize1(texture(uPressure, vUv + vec2(texelSize.x, 0.0)).x, 512.0);
      float bottom = sanitize1(texture(uPressure, vUv - vec2(0.0, texelSize.y)).x, 512.0);
      float top = sanitize1(texture(uPressure, vUv + vec2(0.0, texelSize.y)).x, 512.0);
      vec2 velocity = sanitize(texture(uVelocity, vUv).xy, 512.0);
      velocity -= vec2(right - left, top - bottom) * 0.5;
      fragColor = vec4(sanitize(velocity, 512.0), 0.0, 1.0);
    }
  `;

  const curlShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 texelSize;
    out vec4 fragColor;

    vec2 sanitize(vec2 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec2(0.0);
      }
      return clamp(value, vec2(-limit), vec2(limit));
    }

    void main() {
      vec2 leftSample = sanitize(texture(uVelocity, vUv - vec2(texelSize.x, 0.0)).xy, 512.0);
      vec2 rightSample = sanitize(texture(uVelocity, vUv + vec2(texelSize.x, 0.0)).xy, 512.0);
      vec2 bottomSample = sanitize(texture(uVelocity, vUv - vec2(0.0, texelSize.y)).xy, 512.0);
      vec2 topSample = sanitize(texture(uVelocity, vUv + vec2(0.0, texelSize.y)).xy, 512.0);
      float left = leftSample.y;
      float right = rightSample.y;
      float bottom = bottomSample.x;
      float top = topSample.x;
      float curl = 0.5 * (right - left - top + bottom);
      fragColor = vec4(curl, 0.0, 0.0, 1.0);
    }
  `;

  const vorticityShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float curlStrength;
    out vec4 fragColor;

    vec2 sanitize(vec2 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec2(0.0);
      }
      return clamp(value, vec2(-limit), vec2(limit));
    }

    float sanitize1(float value, float limit) {
      if (isnan(value) || isinf(value)) {
        return 0.0;
      }
      return clamp(value, -limit, limit);
    }

    void main() {
      float left = abs(sanitize1(texture(uCurl, vUv - vec2(texelSize.x, 0.0)).x, 512.0));
      float right = abs(sanitize1(texture(uCurl, vUv + vec2(texelSize.x, 0.0)).x, 512.0));
      float bottom = abs(sanitize1(texture(uCurl, vUv - vec2(0.0, texelSize.y)).x, 512.0));
      float top = abs(sanitize1(texture(uCurl, vUv + vec2(0.0, texelSize.y)).x, 512.0));
      float center = sanitize1(texture(uCurl, vUv).x, 512.0);

      vec2 force = 0.5 * vec2(top - bottom, right - left);
      force /= length(force) + 0.0001;
      force *= curlStrength * center;
      force.y *= -1.0;

      vec2 velocity = sanitize(texture(uVelocity, vUv).xy, 512.0);
      velocity += force * dt;
      fragColor = vec4(sanitize(velocity, 512.0), 0.0, 1.0);
    }
  `;

  const displayShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uDye;
    uniform sampler2D uVelocity;
    uniform vec2 texelSize;
    uniform float glow;
    uniform float liquidMode;
    uniform float time;
    out vec4 fragColor;

    vec4 sanitize(vec4 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec4(0.0, 0.0, 0.0, 1.0);
      }
      return clamp(value, vec4(-limit, -limit, -limit, 0.0), vec4(limit, limit, limit, 1.0));
    }

    vec2 sanitize2(vec2 value, float limit) {
      if (any(isnan(value)) || any(isinf(value))) {
        return vec2(0.0);
      }
      return clamp(value, vec2(-limit), vec2(limit));
    }

    vec3 tonemap(vec3 x) {
      return clamp((x * (2.25 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    void main() {
      vec3 dye = sanitize(texture(uDye, vUv), 64.0).rgb;
      vec2 velocity = sanitize2(texture(uVelocity, vUv).xy, 512.0);
      float speed = length(velocity);

      vec3 blur = vec3(0.0);
      blur += sanitize(texture(uDye, vUv + vec2(texelSize.x, 0.0) * 3.0), 64.0).rgb;
      blur += sanitize(texture(uDye, vUv - vec2(texelSize.x, 0.0) * 3.0), 64.0).rgb;
      blur += sanitize(texture(uDye, vUv + vec2(0.0, texelSize.y) * 3.0), 64.0).rgb;
      blur += sanitize(texture(uDye, vUv - vec2(0.0, texelSize.y) * 3.0), 64.0).rgb;
      blur += sanitize(texture(uDye, vUv + texelSize * 2.0), 64.0).rgb;
      blur += sanitize(texture(uDye, vUv - texelSize * 2.0), 64.0).rgb;
      blur *= 0.16666667;

      float edge = max(length(blur - dye), 0.0);
      float density = max(max(dye.r, dye.g), dye.b);
      float pooled = smoothstep(0.0002, 0.03, density);

      float arcVignette = 1.0 - smoothstep(0.12, 1.25, length(vUv - 0.5));
      float arcShimmer = 0.025 * sin(time * 0.8 + vUv.x * 9.0 + vUv.y * 6.0);
      vec3 arcBase = vec3(0.014, 0.018, 0.022);
      arcBase += arcVignette * vec3(0.028, 0.022, 0.014);
      arcBase += arcShimmer * vec3(1.0, 0.75, 0.35);
      vec3 glowColor = max(blur - dye * 0.08, 0.0);
      vec3 arcColor = arcBase + dye + glowColor * (0.55 + glow * 1.4);
      arcColor += edge * 0.18 * vec3(1.0, 0.82, 0.5);
      arcColor += speed * 0.018 * vec3(0.8, 1.0, 0.6);

      float heavyVignette = 1.0 - smoothstep(0.16, 1.22, length(vUv - 0.5));
      float heavyShimmer = 0.02 * sin(time * 0.55 + vUv.x * 7.0 + vUv.y * 5.0);
      vec3 heavyBase = vec3(0.012, 0.011, 0.012);
      heavyBase += heavyVignette * vec3(0.036, 0.024, 0.012);
      heavyBase += heavyShimmer * vec3(0.8, 0.58, 0.24);

      vec3 liquid = dye * (3.1 + pooled * 4.2);
      vec3 subsurface = max(blur, dye) * (0.55 + 1.15 * glow) * (0.45 + pooled * 1.0);
      float highlight = pow(clamp(pooled * 1.24 - edge * 1.3 + 0.08 * sin(time * 0.8 + vUv.x * 12.0 - vUv.y * 9.0), 0.0, 1.0), 8.0);
      float rim = 1.0 - smoothstep(0.015, 0.18, edge);

      vec3 heavyColor = heavyBase + liquid + subsurface;
      heavyColor += glowColor * (0.35 + glow * 0.9);
      heavyColor += highlight * vec3(1.0, 0.97, 0.88) * (0.18 + glow * 1.1);
      heavyColor += rim * pooled * vec3(0.32, 0.24, 0.14) * 0.22;
      heavyColor += speed * 0.009 * vec3(0.4, 0.32, 0.22);

      vec3 color = mix(arcColor, heavyColor, liquidMode);
      color = tonemap(color);
      color = pow(color, mix(vec3(0.92), vec3(0.94), liquidMode));
      fragColor = vec4(color, 1.0);
    }
  `;

  let clearProgram;
  let splatProgram;
  let forceProgram;
  let relaxProgram;
  let containProgram;
  let advectionProgram;
  let divergenceProgram;
  let pressureProgram;
  let gradientSubtractProgram;
  let curlProgram;
  let vorticityProgram;
  let displayProgram;

  try {
    clearProgram = createProgram(baseVertexShader, clearShader);
    splatProgram = createProgram(baseVertexShader, splatShader);
    forceProgram = createProgram(baseVertexShader, forceShader);
    relaxProgram = createProgram(baseVertexShader, relaxShader);
    containProgram = createProgram(baseVertexShader, containShader);
    advectionProgram = createProgram(baseVertexShader, advectionShader);
    divergenceProgram = createProgram(baseVertexShader, divergenceShader);
    pressureProgram = createProgram(baseVertexShader, pressureShader);
    gradientSubtractProgram = createProgram(baseVertexShader, gradientSubtractShader);
    curlProgram = createProgram(baseVertexShader, curlShader);
    vorticityProgram = createProgram(baseVertexShader, vorticityShader);
    displayProgram = createProgram(baseVertexShader, displayShader);

    resizeCanvas();
    configureMode("heavy", false);
    resetSimulation(true);
    updateStatus();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }

  window.addEventListener("resize", () => {
    resizeCanvas();
    resetSimulation(false);
    seedScene(6);
  });

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
  });

  resetBtn.addEventListener("click", () => {
    resetSimulation(true);
  });

  pourBtn.addEventListener("click", () => {
    burst(6);
  });

  modeBtn.addEventListener("click", () => {
    configureMode(modeKey === "heavy" ? "arc" : "heavy", true);
  });

  autoBtn.addEventListener("click", () => {
    config.auto = !config.auto;
    autoBtn.classList.toggle("is-active", config.auto);
    updateStatus();
  });

  paletteBtn.addEventListener("click", () => {
    paletteIndex = (paletteIndex + 1) % palettes.length;
    paletteBtn.textContent = `Palette: ${palettes[paletteIndex].name}`;
    seedScene(6);
  });

  weightInput.addEventListener("input", applyControls);
  glossInput.addEventListener("input", applyControls);
  bodyInput.addEventListener("input", applyControls);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      paused = !paused;
      pauseBtn.textContent = paused ? "Resume" : "Pause";
    } else if (event.code === "Enter") {
      burst(6);
    } else if (event.code === "KeyM") {
      configureMode(modeKey === "heavy" ? "arc" : "heavy", true);
    }
  });

  attachPointerEvents();
  requestAnimationFrame(frame);

  function frame(now) {
    const delta = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    fps = fps === 0 ? 1 / Math.max(delta, 1e-4) : mix(fps, 1 / Math.max(delta, 1e-4), fpsSmoother);

    if (!paused && sim) {
      processPointers(now);
      if (config.auto && now - lastAutoBurst > config.autoBurstInterval) {
        spawnAutoBurst(now * 0.001);
        lastAutoBurst = now;
      }
      step(delta, now * 0.001);
    }

    render(now * 0.001);
    framesSinceUpdate += 1;
    if (framesSinceUpdate >= 12) {
      updateStatus();
      framesSinceUpdate = 0;
    }
    requestAnimationFrame(frame);
  }

  function step(dt, time) {
    const texelSize = [1 / sim.width, 1 / sim.height];

    gl.viewport(0, 0, sim.width, sim.height);

    useProgram(advectionProgram, {
      uVelocity: bindTexture(sim.velocity.read.texture, 0),
      uSource: bindTexture(sim.velocity.read.texture, 1),
      texelSize,
      dt,
      dissipation: config.velocityDissipation,
    });
    blit(sim.velocity.write);
    sim.velocity.swap();

    if (config.gravity > 0) {
      useProgram(forceProgram, {
        uVelocity: bindTexture(sim.velocity.read.texture, 0),
        force: [0.0, -config.gravity],
        dt,
        damping: 0.998,
      });
      blit(sim.velocity.write);
      sim.velocity.swap();
    }

    if (config.containment > 0) {
      useProgram(containProgram, {
        uVelocity: bindTexture(sim.velocity.read.texture, 0),
        dt,
        strength: config.containment,
      });
      blit(sim.velocity.write);
      sim.velocity.swap();
    }

    if (config.velocityDiffuse > 0) {
      for (let i = 0; i < 2; i += 1) {
        useProgram(relaxProgram, {
          uTarget: bindTexture(sim.velocity.read.texture, 0),
          texelSize,
          blend: config.velocityDiffuse,
          centerLift: 2.6,
          dt,
        });
        blit(sim.velocity.write);
        sim.velocity.swap();
      }
    }

    useProgram(curlProgram, {
      uVelocity: bindTexture(sim.velocity.read.texture, 0),
      texelSize,
    });
    blit(sim.curl.write);
    sim.curl.swap();

    useProgram(vorticityProgram, {
      uVelocity: bindTexture(sim.velocity.read.texture, 0),
      uCurl: bindTexture(sim.curl.read.texture, 1),
      texelSize,
      dt,
      curlStrength: config.curl,
    });
    blit(sim.velocity.write);
    sim.velocity.swap();

    useProgram(divergenceProgram, {
      uVelocity: bindTexture(sim.velocity.read.texture, 0),
      texelSize,
    });
    blit(sim.divergence.write);
    sim.divergence.swap();

    useProgram(clearProgram, {
      value: [0, 0, 0, 1],
    });
    blit(sim.pressure.write);
    sim.pressure.swap();

    for (let i = 0; i < config.pressureIterations; i += 1) {
      useProgram(pressureProgram, {
        uPressure: bindTexture(sim.pressure.read.texture, 0),
        uDivergence: bindTexture(sim.divergence.read.texture, 1),
        texelSize,
      });
      blit(sim.pressure.write);
      sim.pressure.swap();
    }

    useProgram(gradientSubtractProgram, {
      uPressure: bindTexture(sim.pressure.read.texture, 0),
      uVelocity: bindTexture(sim.velocity.read.texture, 1),
      texelSize,
    });
    blit(sim.velocity.write);
    sim.velocity.swap();

    useProgram(advectionProgram, {
      uVelocity: bindTexture(sim.velocity.read.texture, 0),
      uSource: bindTexture(sim.dye.read.texture, 1),
      texelSize,
      dt,
      dissipation: config.dyeDissipation,
    });
    blit(sim.dye.write);
    sim.dye.swap();

    if (config.dyeDiffuse > 0) {
      useProgram(relaxProgram, {
        uTarget: bindTexture(sim.dye.read.texture, 0),
        texelSize,
        blend: config.dyeDiffuse,
        centerLift: 1.2,
        dt,
      });
      blit(sim.dye.write);
      sim.dye.swap();
    }

    if (modeKey === "heavy" && Math.random() < 0.045) {
      const x = 0.22 + Math.random() * 0.56;
      splat(
        x,
        0.08 + Math.random() * 0.08,
        (0.5 - x) * 160 + Math.sin(time * 1.7 + x * 5.0) * 45,
        -155 - Math.random() * 70,
        scaleColor(paletteColor(time * 0.6 + x * 3.0), 0.18),
        config.splatRadius * 0.85
      );
    }

    if (Math.random() < 0.02) {
      const pulse = 0.000035 + 0.00004 * Math.sin(time * 0.7 + 1.7);
      splat(
        0.5 + Math.sin(time * 0.21) * 0.15,
        0.26 + Math.cos(time * 0.17) * 0.08,
        0,
        46,
        scaleColor(paletteColor(time * 0.7 + 4.0), 0.25),
        pulse
      );
    }
  }

  function render(time) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    useProgram(displayProgram, {
      uDye: bindTexture(sim.dye.read.texture, 0),
      uVelocity: bindTexture(sim.velocity.read.texture, 1),
      texelSize: [1 / sim.width, 1 / sim.height],
      glow: config.glow,
      liquidMode: modeConfigs[modeKey].liquidMode,
      time,
    });
    blit(null);
  }

  function resetSimulation(withClear) {
    if (sim) {
      destroyDoubleFbo(sim.velocity);
      destroyDoubleFbo(sim.dye);
      destroyDoubleFbo(sim.divergence);
      destroyDoubleFbo(sim.pressure);
      destroyDoubleFbo(sim.curl);
    }

    const resolution = chooseResolution(canvas.width, canvas.height);
    sim = {
      width: resolution.width,
      height: resolution.height,
      velocity: createDoubleFbo(resolution.width, resolution.height),
      dye: createDoubleFbo(resolution.width, resolution.height),
      divergence: createDoubleFbo(resolution.width, resolution.height),
      pressure: createDoubleFbo(resolution.width, resolution.height),
      curl: createDoubleFbo(resolution.width, resolution.height),
    };

    clearTarget(sim.velocity.read, [0, 0, 0, 1]);
    clearTarget(sim.velocity.write, [0, 0, 0, 1]);
    clearTarget(sim.dye.read, [0, 0, 0, 1]);
    clearTarget(sim.dye.write, [0, 0, 0, 1]);
    clearTarget(sim.divergence.read, [0, 0, 0, 1]);
    clearTarget(sim.divergence.write, [0, 0, 0, 1]);
    clearTarget(sim.pressure.read, [0, 0, 0, 1]);
    clearTarget(sim.pressure.write, [0, 0, 0, 1]);
    clearTarget(sim.curl.read, [0, 0, 0, 1]);
    clearTarget(sim.curl.write, [0, 0, 0, 1]);

    if (withClear) {
      seedScene(8);
    }
    updateStatus();
    render(performance.now() * 0.001);
  }

  function burst(count) {
    if (modeKey === "arc") {
      ignite(count);
    } else {
      pour(Math.max(count, 10));
    }
  }

  function pour(count) {
    for (let i = 0; i < count; i += 1) {
      const x = 0.18 + (i / Math.max(1, count - 1)) * 0.64 + (Math.random() - 0.5) * 0.03;
      const y = 0.78 - Math.random() * 0.08;
      const dx = (Math.random() - 0.5) * 90;
      const dy = 72 + Math.random() * 70;
      const color = scaleColor(paletteColor(performance.now() * 0.0018 + i * 0.7 + x), 1.45);
      splat(clamp01(x), clamp01(y), dx, dy, color, config.splatRadius * (1.8 + Math.random() * 0.8));
    }
  }

  function ignite(count) {
    for (let i = 0; i < count; i += 1) {
      const x = 0.2 + Math.random() * 0.6;
      const y = 0.2 + Math.random() * 0.6;
      const angle = Math.random() * Math.PI * 2;
      const force = 180 + Math.random() * 520;
      const color = scaleColor(paletteColor(performance.now() * 0.002 + i * 0.9 + x), 1.12);
      splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, color, config.splatRadius * (0.9 + Math.random() * 0.7));
    }
  }

  function applyControls() {
    if (modeKey === "arc") {
      applyArcControls();
    } else {
      applyHeavyControls();
    }
  }

  function applyHeavyControls() {
    const value = Number(weightInput.value);
    const normalized = (value - 20) / 70;
    config.gravity = mix(28.0, 82.0, normalized);
    config.curl = mix(13.0, 7.5, normalized);
    config.velocityDissipation = mix(0.994, 0.989, normalized);
    config.splatForce = mix(4000.0, 2900.0, normalized);
    config.autoBurstInterval = Math.round(mix(260, 180, normalized));
    config.containment = mix(70.0, 150.0, normalized);
    config.glow = Number(glossInput.value) / 100;
    applyHeavyBody();
    updateStatus();
  }

  function applyArcControls() {
    config.curl = Number(weightInput.value);
    config.glow = Number(glossInput.value) / 100;
    config.dyeDissipation = Number(bodyInput.value) / 1000;
    config.velocityDissipation = 0.992;
    config.pressureIterations = 18;
    config.splatRadius = 0.00024;
    config.splatForce = 6200.0;
    config.gravity = 0.0;
    config.velocityDiffuse = 0.0;
    config.dyeDiffuse = 0.0;
    config.containment = 0.0;
    config.autoBurstInterval = 130;
    updateStatus();
  }

  function applyHeavyBody() {
    const value = Number(bodyInput.value);
    const normalized = clamp01((value - 970) / 28);
    config.dyeDissipation = mix(0.996, 0.991, normalized);
    config.dyeDiffuse = mix(0.0, 0.045, normalized);
    config.velocityDiffuse = mix(0.0, 0.08, normalized);
    config.splatRadius = mix(0.00034, 0.00058, normalized);
    config.pressureIterations = Math.round(mix(18, 24, normalized));
    updateStatus();
  }

  function configureMode(nextMode, shouldReset) {
    modeKey = nextMode;
    const mode = modeConfigs[modeKey];
    palettes = mode.palettes;
    paletteIndex = 0;
    document.title = mode.title;
    document.body.dataset.mode = modeKey;
    eyebrow.textContent = mode.title;
    headline.textContent = mode.headline;
    modeBtn.textContent = `Mode: ${modeKey === "heavy" ? "Heavy" : "Arc"}`;
    pourBtn.textContent = mode.action;
    primaryLabel.textContent = mode.labels[0];
    secondaryLabel.textContent = mode.labels[1];
    tertiaryLabel.textContent = mode.labels[2];
    [weightInput, glossInput, bodyInput].forEach((input, index) => {
      const control = mode.controls[index];
      input.min = String(control.min);
      input.max = String(control.max);
      input.value = String(control.value);
    });
    document.querySelector(".footer-note span:first-child").textContent = mode.footer;
    paletteBtn.textContent = `Palette: ${palettes[paletteIndex].name}`;
    applyControls();
    if (shouldReset) {
      resetSimulation(true);
    }
  }

  function seedScene(count) {
    if (modeKey === "arc") {
      for (let i = 0; i < count; i += 1) {
        const x = 0.16 + Math.random() * 0.68;
        const y = 0.16 + Math.random() * 0.68;
        const angle = Math.random() * Math.PI * 2;
        const force = 120 + Math.random() * 380;
        const color = scaleColor(paletteColor(i * 0.9 + Math.random() * 4.0), 1.1);
        splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, color, 0.0002 + Math.random() * 0.00018);
      }
      return;
    }

    for (let i = 0; i < count; i += 1) {
      const x = 0.16 + Math.random() * 0.68;
      const y = 0.48 + Math.random() * 0.36;
      const dx = (Math.random() - 0.5) * 160;
      const dy = 80 + Math.random() * 180;
      const color = scaleColor(paletteColor(i * 0.9 + Math.random() * 4.0), 1.05);
      splat(x, y, dx, dy, color, config.splatRadius * (0.95 + Math.random() * 1.1));
    }
  }

  function spawnAutoBurst(time) {
    if (modeKey === "arc") {
      const x = 0.5 + Math.sin(time * 0.37) * 0.24 + (Math.random() - 0.5) * 0.05;
      const y = 0.5 + Math.cos(time * 0.29) * 0.24 + (Math.random() - 0.5) * 0.05;
      const angle = time * 1.1 + Math.sin(time * 0.3);
      const force = 90 + 160 * (0.5 + 0.5 * Math.sin(time * 0.63));
      const color = scaleColor(paletteColor(time * 1.9 + x * 3.0 + y), 0.9);
      splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, color, 0.00022);
      return;
    }

    const x = 0.22 + 0.56 * (0.5 + 0.5 * Math.sin(time * 0.43 + Math.sin(time * 0.19)));
    const y = 0.72 + Math.random() * 0.1;
    const dx = Math.sin(time * 1.7 + x * 5.0) * 55.0;
    const dy = 78.0 + 42.0 * (0.5 + 0.5 * Math.sin(time * 0.83 + x * 4.0));
    const color = scaleColor(paletteColor(time * 1.6 + x * 2.0 + y * 1.3), 0.95);
    splat(x, y, dx, dy, color, config.splatRadius * (1.1 + Math.random() * 0.7));
    if (Math.random() < 0.35) {
      splat(
        clamp01(x + (Math.random() - 0.5) * 0.06),
        clamp01(y - 0.04 - Math.random() * 0.06),
        dx * 0.4,
        dy * 0.75,
        scaleColor(color, 0.92),
        config.splatRadius * 0.9
      );
    }
  }

  function splat(x, y, dx, dy, color, radius) {
    const safeRadius = radius || config.splatRadius;

    useProgram(splatProgram, {
      uTarget: bindTexture(sim.velocity.read.texture, 0),
      point: [x, y],
      color: [dx, -dy, 0],
      radius: safeRadius,
      aspect: sim.width / sim.height,
    });
    gl.viewport(0, 0, sim.width, sim.height);
    blit(sim.velocity.write);
    sim.velocity.swap();

    useProgram(splatProgram, {
      uTarget: bindTexture(sim.dye.read.texture, 0),
      point: [x, y],
      color,
      radius: safeRadius * 1.45,
      aspect: sim.width / sim.height,
    });
    blit(sim.dye.write);
    sim.dye.swap();
  }

  function processPointers(now) {
    pointers.forEach((pointer) => {
      if (!pointer.down || !pointer.moved) {
        return;
      }

      const dx = (pointer.x - pointer.prevX) * config.splatForce;
      const dy = (pointer.y - pointer.prevY) * config.splatForce;
      const speed = Math.hypot(dx, dy);
      if (speed < 0.001) {
        pointer.moved = false;
        return;
      }

      const color = scaleColor(
        paletteColor(now * 0.0016 + pointer.x * 2.0 + pointer.y * 1.3 + pointer.seed),
        0.7 + Math.min(speed / 3200, 0.8)
      );
      splat(pointer.x, 1.0 - pointer.y, dx, dy, color, config.splatRadius * (0.9 + Math.min(speed / 2000, 0.8)));
      pointer.prevX = pointer.x;
      pointer.prevY = pointer.y;
      pointer.moved = false;
    });
  }

  function attachPointerEvents() {
    const getBounds = () => canvas.getBoundingClientRect();

    const begin = (id, clientX, clientY) => {
      const rect = getBounds();
      const x = clamp01((clientX - rect.left) / rect.width);
      const y = clamp01((clientY - rect.top) / rect.height);
      pointers.set(id, {
        down: true,
        x,
        y,
        prevX: x,
        prevY: y,
        moved: false,
        seed: Math.random() * 10,
      });

      const color = scaleColor(paletteColor(performance.now() * 0.002 + x * 3.0 + y), modeKey === "heavy" ? 1.4 : 0.85);
      const radiusBoost = modeKey === "heavy" ? 2.8 : 1.8;
      splat(x, 1.0 - y, 0, modeKey === "heavy" ? 28 : 0, color, config.splatRadius * radiusBoost);
    };

    const move = (id, clientX, clientY) => {
      const pointer = pointers.get(id);
      if (!pointer) {
        return;
      }
      const rect = getBounds();
      pointer.x = clamp01((clientX - rect.left) / rect.width);
      pointer.y = clamp01((clientY - rect.top) / rect.height);
      pointer.moved = true;
    };

    const end = (id) => {
      const pointer = pointers.get(id);
      if (!pointer) {
        return;
      }
      pointer.down = false;
      pointers.delete(id);
    };

    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      begin(event.pointerId, event.clientX, event.clientY);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) {
        return;
      }
      move(event.pointerId, event.clientX, event.clientY);
    });

    canvas.addEventListener("pointerup", (event) => {
      end(event.pointerId);
    });

    canvas.addEventListener("pointercancel", (event) => {
      end(event.pointerId);
    });

    canvas.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse" && event.buttons === 0) {
        end(event.pointerId);
      }
    });
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width === width && canvas.height === height) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
  }

  function chooseResolution(width, height) {
    const maxSide = Math.max(width, height);
    const scale = maxSide > 1600 ? 0.5 : width < 820 ? 0.58 : 0.68;
    const simWidth = clampInt(Math.round(width * scale), 180, 960);
    const simHeight = clampInt(Math.round(height * scale), 180, 960);
    return {
      width: simWidth,
      height: simHeight,
    };
  }

  function updateStatus() {
    if (!sim) {
      return;
    }
    const activity = paused ? "paused" : config.auto ? modeConfigs[modeKey].activity : "hands only";
    const detail = modeKey === "arc"
      ? `swirl ${Math.round(config.curl)} | trail ${Math.round(config.dyeDissipation * 1000)}`
      : `weight ${Math.round(config.gravity)} | body ${Math.round(config.dyeDissipation * 1000)}`;
    status.classList.toggle("is-warning", !gpuInfo.usingArcB70);
    status.textContent = `${Math.round(fps || 0)} fps | ${sim.width}x${sim.height} | GPU ${gpuInfo.label} | ${detail} | ${activity}`;
  }

  function updateGpuNote() {
    if (!gpuNote) {
      return;
    }
    gpuNote.classList.toggle("is-warning", !gpuInfo.usingArcB70);
    gpuNote.textContent = gpuInfo.usingArcB70
      ? `GPU: ${gpuInfo.label}`
      : `GPU: ${gpuInfo.label}. Restart this browser after switching it to High performance.`;
    gpuNote.title = `${gpuInfo.vendor} | ${gpuInfo.renderer}`;
  }

  function detectGpu(context) {
    const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
    let vendor = "";
    let renderer = "";

    try {
      vendor = debugInfo
        ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
        : context.getParameter(context.VENDOR);
    } catch (error) {
      vendor = "";
    }

    try {
      renderer = debugInfo
        ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : context.getParameter(context.RENDERER);
    } catch (error) {
      renderer = "";
    }

    return {
      vendor: vendor || "Unknown vendor",
      renderer: renderer || "Unknown renderer",
      usingArcB70: isArcProB70(renderer),
      label: summarizeRenderer(renderer),
    };
  }

  function isArcProB70(renderer) {
    return /arc/i.test(renderer) && /\bb70\b/i.test(renderer);
  }

  function summarizeRenderer(renderer) {
    if (!renderer) {
      return "Unknown GPU";
    }

    if (isArcProB70(renderer)) {
      return "Arc Pro B70";
    }

    if (/iris/i.test(renderer) && /\bxe\b/i.test(renderer)) {
      return "Iris Xe";
    }

    const cleaned = renderer
      .replace(/^ANGLE\s*\(/i, "")
      .replace(/\)$/i, "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    const preferred = cleaned.find((part) => /arc|iris|radeon|geforce|nvidia|amd|intel/i.test(part)) || renderer;

    return preferred
      .replace(/\bDirect3D.+$/i, "")
      .replace(/\bOpenGL.+$/i, "")
      .replace(/\(R\)|\(TM\)/gi, "")
      .replace(/\s+Graphics$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function clearTarget(target, value) {
    gl.viewport(0, 0, target.width, target.height);
    useProgram(clearProgram, { value });
    blit(target);
  }

  function createProgram(vertexSource, fragmentSource) {
    const program = gl.createProgram();
    const vertex = compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Program failed to link.");
    }

    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    const uniforms = {};
    for (let i = 0; i < uniformCount; i += 1) {
      const info = gl.getActiveUniform(program, i);
      if (!info) {
        continue;
      }
      const name = info.name.replace(/\[0\]$/, "");
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    return {
      program,
      uniforms,
    };
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader failed to compile.");
    }
    return shader;
  }

  function useProgram(target, values) {
    gl.useProgram(target.program);
    Object.keys(values).forEach((key) => {
      const location = target.uniforms[key];
      if (location == null) {
        return;
      }
      const value = values[key];
      if (typeof value === "number") {
        gl.uniform1f(location, value);
      } else if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "textureUnit")) {
        gl.uniform1i(location, value.textureUnit);
      } else if (Array.isArray(value)) {
        if (value.length === 2) {
          gl.uniform2f(location, value[0], value[1]);
        } else if (value.length === 3) {
          gl.uniform3f(location, value[0], value[1], value[2]);
        } else if (value.length === 4) {
          gl.uniform4f(location, value[0], value[1], value[2], value[3]);
        }
      } else {
        gl.uniform1i(location, value);
      }
    });
  }

  function bindTexture(texture, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    return { textureUnit: unit };
  }

  function createDoubleFbo(width, height) {
    const read = createFbo(width, height);
    const write = createFbo(width, height);
    return {
      width,
      height,
      read,
      write,
      swap() {
        const temp = this.read;
        this.read = this.write;
        this.write = temp;
      },
    };
  }

  function createFbo(width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Framebuffer setup failed.");
    }

    return { texture, fbo, width, height };
  }

  function destroyDoubleFbo(target) {
    [target.read, target.write].forEach((single) => {
      gl.deleteFramebuffer(single.fbo);
      gl.deleteTexture(single.texture);
    });
  }

  function blit(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function paletteColor(time) {
    const raw = palettes[paletteIndex].sample(time);
    return [
      clamp01(raw[0]),
      clamp01(raw[1]),
      clamp01(raw[2]),
    ];
  }

  function scaleColor(color, strength) {
    return color.map((component) => component * strength);
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function clampInt(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
