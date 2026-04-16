(function () {
  const canvas = document.getElementById("sim-canvas");
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");
  const autoBtn = document.getElementById("auto-btn");
  const paletteBtn = document.getElementById("palette-btn");
  const swirlInput = document.getElementById("swirl-input");
  const glowInput = document.getElementById("glow-input");
  const trailInput = document.getElementById("trail-input");
  const status = document.getElementById("status");

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
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

  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);

  const config = {
    velocityDissipation: 0.992,
    dyeDissipation: 0.986,
    pressureIterations: 18,
    splatRadius: 0.00024,
    splatForce: 6200.0,
    curl: 42.0,
    glow: 0.58,
    auto: true,
  };

  const palettes = [
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
  ];

  const pointers = new Map();
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
    void main() {
      vec2 delta = vUv - point;
      delta.x *= aspect;
      float falloff = exp(-dot(delta, delta) / radius);
      vec4 base = texture(uTarget, vUv);
      fragColor = base + vec4(color * falloff, 0.0);
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
      vec2 velocity = bilerp(uVelocity, vUv).xy;
      vec2 coord = clamp(vUv - dt * velocity * texelSize, texelSize * 0.5, 1.0 - texelSize * 0.5);
      fragColor = dissipation * bilerp(uSource, coord);
    }
  `;

  const divergenceShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 texelSize;
    out vec4 fragColor;
    void main() {
      vec2 left = texture(uVelocity, vUv - vec2(texelSize.x, 0.0)).xy;
      vec2 right = texture(uVelocity, vUv + vec2(texelSize.x, 0.0)).xy;
      vec2 bottom = texture(uVelocity, vUv - vec2(0.0, texelSize.y)).xy;
      vec2 top = texture(uVelocity, vUv + vec2(0.0, texelSize.y)).xy;
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
    void main() {
      float left = texture(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
      float right = texture(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
      float bottom = texture(uPressure, vUv - vec2(0.0, texelSize.y)).x;
      float top = texture(uPressure, vUv + vec2(0.0, texelSize.y)).x;
      float div = texture(uDivergence, vUv).x;
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
    void main() {
      float left = texture(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
      float right = texture(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
      float bottom = texture(uPressure, vUv - vec2(0.0, texelSize.y)).x;
      float top = texture(uPressure, vUv + vec2(0.0, texelSize.y)).x;
      vec2 velocity = texture(uVelocity, vUv).xy;
      velocity -= vec2(right - left, top - bottom) * 0.5;
      fragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  const curlShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 texelSize;
    out vec4 fragColor;
    void main() {
      float left = texture(uVelocity, vUv - vec2(texelSize.x, 0.0)).y;
      float right = texture(uVelocity, vUv + vec2(texelSize.x, 0.0)).y;
      float bottom = texture(uVelocity, vUv - vec2(0.0, texelSize.y)).x;
      float top = texture(uVelocity, vUv + vec2(0.0, texelSize.y)).x;
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
    void main() {
      float left = abs(texture(uCurl, vUv - vec2(texelSize.x, 0.0)).x);
      float right = abs(texture(uCurl, vUv + vec2(texelSize.x, 0.0)).x);
      float bottom = abs(texture(uCurl, vUv - vec2(0.0, texelSize.y)).x);
      float top = abs(texture(uCurl, vUv + vec2(0.0, texelSize.y)).x);
      float center = texture(uCurl, vUv).x;

      vec2 force = 0.5 * vec2(top - bottom, right - left);
      force /= length(force) + 0.0001;
      force *= curlStrength * center;
      force.y *= -1.0;

      vec2 velocity = texture(uVelocity, vUv).xy;
      velocity += force * dt;
      fragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  const displayShader = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uDye;
    uniform sampler2D uVelocity;
    uniform vec2 texelSize;
    uniform float glow;
    uniform float time;
    out vec4 fragColor;

    vec3 tonemap(vec3 x) {
      return clamp((x * (2.25 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    void main() {
      vec3 dye = texture(uDye, vUv).rgb;
      vec2 velocity = texture(uVelocity, vUv).xy;
      float speed = length(velocity);

      vec3 blur = vec3(0.0);
      blur += texture(uDye, vUv + vec2(texelSize.x, 0.0) * 3.0).rgb;
      blur += texture(uDye, vUv - vec2(texelSize.x, 0.0) * 3.0).rgb;
      blur += texture(uDye, vUv + vec2(0.0, texelSize.y) * 3.0).rgb;
      blur += texture(uDye, vUv - vec2(0.0, texelSize.y) * 3.0).rgb;
      blur += texture(uDye, vUv + texelSize * 2.0).rgb;
      blur += texture(uDye, vUv - texelSize * 2.0).rgb;
      blur *= 0.16666667;

      float edge = max(length(blur - dye), 0.0);
      float vignette = smoothstep(1.25, 0.12, length(vUv - 0.5));
      float shimmer = 0.025 * sin(time * 0.8 + vUv.x * 9.0 + vUv.y * 6.0);

      vec3 base = vec3(0.014, 0.018, 0.022);
      base += vignette * vec3(0.028, 0.022, 0.014);
      base += shimmer * vec3(1.0, 0.75, 0.35);

      vec3 glowColor = max(blur - dye * 0.08, 0.0);
      vec3 color = base + dye + glowColor * (0.55 + glow * 1.4);
      color += edge * 0.18 * vec3(1.0, 0.82, 0.5);
      color += speed * 0.018 * vec3(0.8, 1.0, 0.6);
      color = tonemap(color);
      color = pow(color, vec3(0.92));
      fragColor = vec4(color, 1.0);
    }
  `;

  const clearProgram = createProgram(baseVertexShader, clearShader);
  const splatProgram = createProgram(baseVertexShader, splatShader);
  const advectionProgram = createProgram(baseVertexShader, advectionShader);
  const divergenceProgram = createProgram(baseVertexShader, divergenceShader);
  const pressureProgram = createProgram(baseVertexShader, pressureShader);
  const gradientSubtractProgram = createProgram(baseVertexShader, gradientSubtractShader);
  const curlProgram = createProgram(baseVertexShader, curlShader);
  const vorticityProgram = createProgram(baseVertexShader, vorticityShader);
  const displayProgram = createProgram(baseVertexShader, displayShader);

  resizeCanvas();
  resetSimulation(true);
  updateStatus();

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

  swirlInput.addEventListener("input", () => {
    config.curl = Number(swirlInput.value);
    updateStatus();
  });

  glowInput.addEventListener("input", () => {
    config.glow = Number(glowInput.value) / 100;
  });

  trailInput.addEventListener("input", () => {
    config.dyeDissipation = Number(trailInput.value) / 1000;
    updateStatus();
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      paused = !paused;
      pauseBtn.textContent = paused ? "Resume" : "Pause";
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
      if (config.auto && now - lastAutoBurst > 130) {
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
      uSource: bindTexture(sim.velocity.read.texture, 1),
      texelSize,
      dt,
      dissipation: config.velocityDissipation,
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

    if (Math.random() < 0.02) {
      const pulse = 0.00003 + 0.00003 * Math.sin(time * 0.7 + 1.7);
      splat(
        0.5 + Math.sin(time * 0.21) * 0.16,
        0.5 + Math.cos(time * 0.17) * 0.16,
        0,
        0,
        scaleColor(paletteColor(time * 0.7 + 4.0), 0.35),
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

  function seedScene(count) {
    for (let i = 0; i < count; i += 1) {
      const x = 0.16 + Math.random() * 0.68;
      const y = 0.16 + Math.random() * 0.68;
      const angle = Math.random() * Math.PI * 2;
      const force = 120 + Math.random() * 380;
      const color = scaleColor(paletteColor(i * 0.9 + Math.random() * 4.0), 1.1);
      splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, color, 0.0002 + Math.random() * 0.00018);
    }
  }

  function spawnAutoBurst(time) {
    const x = 0.5 + Math.sin(time * 0.37) * 0.24 + (Math.random() - 0.5) * 0.05;
    const y = 0.5 + Math.cos(time * 0.29) * 0.24 + (Math.random() - 0.5) * 0.05;
    const angle = time * 1.1 + Math.sin(time * 0.3);
    const force = 90 + 160 * (0.5 + 0.5 * Math.sin(time * 0.63));
    const color = scaleColor(paletteColor(time * 1.9 + x * 3.0 + y), 0.9);
    splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, color, 0.00022);
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

      const color = scaleColor(paletteColor(performance.now() * 0.002 + x * 3.0 + y), 0.85);
      splat(x, 1.0 - y, 0, 0, color, config.splatRadius * 1.8);
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
    const activity = paused ? "paused" : config.auto ? "auto drift" : "hands only";
    status.textContent = `${Math.round(fps || 0)} fps | ${sim.width}x${sim.height} | swirl ${Math.round(config.curl)} | trail ${Math.round(config.dyeDissipation * 1000)} | ${activity}`;
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
