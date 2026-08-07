// Ripple Tank — browser-native damped height-field waves with reflective rocks.
(function () {
  "use strict";

  const core = window.WaveTankCore;
  const canvas = document.getElementById("wave-canvas");
  const context = canvas?.getContext("2d", { alpha: false });
  const status = document.getElementById("status");

  if (!core || !canvas || !context) {
    if (status) status.textContent = "Ripple Tank needs Canvas 2D support.";
    return;
  }

  const { WaveTank, clamp } = core;
  const resetButton = document.getElementById("reset-btn");
  const pauseButton = document.getElementById("pause-btn");
  const rainButton = document.getElementById("rain-btn");
  const dropButton = document.getElementById("drop-btn");
  const layoutButton = document.getElementById("layout-btn");
  const forceInput = document.getElementById("force-input");
  const speedInput = document.getElementById("speed-input");
  const dampingInput = document.getElementById("damping-input");
  const forceValue = document.getElementById("force-value");
  const speedValue = document.getElementById("speed-value");
  const dampingValue = document.getElementById("damping-value");
  const playHint = document.getElementById("play-hint");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const layouts = [
    {
      name: "Reef Garden",
      shortName: "Reefs",
      obstacles: [
        { type: "circle", x: 0.27, y: 0.31, radius: 0.078 },
        { type: "circle", x: 0.7, y: 0.45, radius: 0.105 },
        { type: "pill", x: 0.46, y: 0.72, length: 0.25, width: 0.065, rotation: -0.36 },
        { type: "circle", x: 0.84, y: 0.76, radius: 0.052 },
      ],
    },
    {
      name: "Breakwater",
      shortName: "Barrier",
      obstacles: [
        { type: "pill", x: 0.48, y: 0.35, length: 0.31, width: 0.062, rotation: 0.12 },
        { type: "pill", x: 0.66, y: 0.7, length: 0.24, width: 0.06, rotation: -0.6 },
        { type: "circle", x: 0.19, y: 0.66, radius: 0.07 },
      ],
    },
    {
      name: "Island Run",
      shortName: "Islands",
      obstacles: [
        { type: "circle", x: 0.34, y: 0.37, radius: 0.115 },
        { type: "circle", x: 0.58, y: 0.6, radius: 0.083 },
        { type: "circle", x: 0.78, y: 0.3, radius: 0.062 },
        { type: "pill", x: 0.22, y: 0.78, length: 0.18, width: 0.055, rotation: 0.48 },
      ],
    },
  ];

  const state = {
    tank: null,
    layoutIndex: 0,
    paused: motionQuery.matches,
    rain: false,
    lastFrame: performance.now(),
    accumulator: 0,
    lastRain: 0,
    fps: 0,
    fpsFrames: 0,
    fpsClock: performance.now(),
    width: 1,
    height: 1,
    dpr: 1,
    surfaceCanvas: document.createElement("canvas"),
    surfaceContext: null,
    surfaceImage: null,
    markers: [],
    pointers: new Map(),
  };
  state.surfaceContext = state.surfaceCanvas.getContext("2d", { alpha: false });

  const fixedStep = 1 / 60;
  const maxStepsPerFrame = 3;

  function currentLayout() {
    return layouts[state.layoutIndex];
  }

  function isSolidAt(u, v) {
    const tank = state.tank;
    if (!tank) return true;
    const x = clamp(Math.floor(u * tank.columns), 0, tank.columns - 1);
    const y = clamp(Math.floor(v * tank.rows), 0, tank.rows - 1);
    return tank.solid[tank.index(x, y)] === 1;
  }

  function pointInObstacle(u, v, shape, aspect) {
    const dx = (u - shape.x) * aspect;
    const dy = v - shape.y;
    if (shape.type === "circle") return dx * dx + dy * dy <= shape.radius * shape.radius;

    const cosine = Math.cos(shape.rotation || 0);
    const sine = Math.sin(shape.rotation || 0);
    const localX = dx * cosine + dy * sine;
    const localY = -dx * sine + dy * cosine;
    const halfLength = Math.max(0, shape.length * 0.5 - shape.width * 0.5);
    const clampedX = clamp(localX, -halfLength, halfLength);
    const distanceX = localX - clampedX;
    return distanceX * distanceX + localY * localY <= (shape.width * 0.5) ** 2;
  }

  function applyLayout() {
    const layout = currentLayout();
    state.tank.rasterizeSolids((u, v, aspect) => layout.obstacles.some((shape) => pointInObstacle(u, v, shape, aspect)));
    state.markers.length = 0;
    layoutButton.textContent = `Layout: ${layout.shortName}`;
    layoutButton.setAttribute("aria-label", `Obstacle layout: ${layout.name}. Change layout.`);
    updateStatus();
  }

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = Math.max(1, window.innerWidth);
    state.height = Math.max(1, window.innerHeight);
    canvas.width = Math.max(1, Math.floor(state.width * state.dpr));
    canvas.height = Math.max(1, Math.floor(state.height * state.dpr));

    const displayAspect = state.width / state.height;
    const longSide = clamp(Math.round(Math.max(state.width, state.height) * 0.26), 148, 270);
    const columns = displayAspect >= 1
      ? longSide
      : clamp(Math.round(longSide * displayAspect), 84, longSide);
    const rows = displayAspect >= 1
      ? clamp(Math.round(longSide / displayAspect), 84, longSide)
      : longSide;

    const needsTank = !state.tank || state.tank.columns !== columns || state.tank.rows !== rows;
    if (needsTank) {
      state.tank = new WaveTank({ columns, rows });
      state.surfaceCanvas.width = columns;
      state.surfaceCanvas.height = rows;
      state.surfaceImage = state.surfaceContext.createImageData(columns, rows);
      applyLayout();
    }
    state.lastFrame = performance.now();
    state.accumulator = 0;
    render();
  }

  function syncPauseButton() {
    pauseButton.dataset.paused = String(state.paused);
    pauseButton.setAttribute("aria-pressed", String(state.paused));
    pauseButton.setAttribute("aria-label", state.paused ? "Resume simulation" : "Pause simulation");
    pauseButton.title = state.paused ? "Resume simulation" : "Pause simulation";
  }

  function setRain(nextRain) {
    state.rain = nextRain;
    rainButton.classList.toggle("is-active", state.rain);
    rainButton.setAttribute("aria-checked", String(state.rain));
    updateStatus();
  }

  function applySettings() {
    forceValue.textContent = `${forceInput.value}%`;
    speedValue.textContent = speedInput.value;
    dampingValue.textContent = `${(Number(dampingInput.value) / 10).toFixed(1)}%`;
  }

  function rippleForce(scale = 1) {
    // Surface height is intentionally kept small; the solver then reads as a
    // water ripple instead of a full-screen shockwave at mobile resolutions.
    return (0.035 + Number(forceInput.value) / 100 * 0.16) * scale;
  }

  function addRipple(u, v, scale = 1, radiusScale = 1) {
    if (!state.tank || isSolidAt(u, v)) return false;
    state.tank.impact(
      clamp(u, 0.01, 0.99),
      clamp(v, 0.01, 0.99),
      rippleForce(scale),
      (0.018 + Number(forceInput.value) / 100 * 0.022) * radiusScale,
    );
    state.markers.push({ u, v, age: 0, intensity: scale });
    if (state.markers.length > 18) state.markers.shift();
    playHint.classList.add("is-dismissed");
    return true;
  }

  function dropRipple() {
    const candidates = [
      [0.5, 0.5],
      [0.38, 0.45],
      [0.62, 0.58],
      [0.2, 0.72],
      [0.83, 0.24],
    ];
    const target = candidates.find(([u, v]) => !isSolidAt(u, v)) || [0.5, 0.5];
    addRipple(target[0], target[1], 1.1, 1.16);
  }

  function setPaused(nextPaused) {
    state.paused = nextPaused;
    syncPauseButton();
    updateStatus();
  }

  function reset() {
    state.tank.clear();
    state.markers.length = 0;
    state.accumulator = 0;
    updateStatus();
  }

  function update(now) {
    for (let index = state.markers.length - 1; index >= 0; index -= 1) {
      state.markers[index].age += fixedStep;
      if (state.markers[index].age > 1.1) state.markers.splice(index, 1);
    }

    if (state.rain && now - state.lastRain > 290) {
      for (let tries = 0; tries < 8; tries += 1) {
        const u = 0.08 + Math.random() * 0.84;
        const v = 0.12 + Math.random() * 0.76;
        if (addRipple(u, v, 0.16, 0.48)) break;
      }
      state.lastRain = now;
    }

    const propagation = Number(speedInput.value) / 100;
    const damping = Number(dampingInput.value) / 1000;
    state.tank.step(propagation, damping);
  }

  function drawBackground() {
    const gradient = context.createLinearGradient(0, 0, 0, state.height);
    gradient.addColorStop(0, "#0a2029");
    gradient.addColorStop(0.48, "#06141b");
    gradient.addColorStop(1, "#03080b");
    context.fillStyle = gradient;
    context.fillRect(0, 0, state.width, state.height);

    const dawn = context.createRadialGradient(
      state.width * 0.17,
      state.height * 0.11,
      0,
      state.width * 0.17,
      state.height * 0.11,
      Math.max(state.width, state.height) * 0.68,
    );
    dawn.addColorStop(0, "rgba(118, 235, 218, 0.16)");
    dawn.addColorStop(1, "rgba(118, 235, 218, 0)");
    context.fillStyle = dawn;
    context.fillRect(0, 0, state.width, state.height);

    context.strokeStyle = "rgba(205, 247, 242, 0.025)";
    context.lineWidth = 1;
    for (let row = 1; row < 6; row += 1) {
      const y = state.height * (0.1 + row * 0.13);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(state.width, y);
      context.stroke();
    }
  }

  function populateSurface() {
    const tank = state.tank;
    const pixels = state.surfaceImage.data;
    const { columns, rows, height, velocity, solid } = tank;
    const time = performance.now() * 0.001;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const index = tank.index(x, y);
        const pixel = index * 4;
        if (solid[index]) {
          const fleck = 9 + 6 * Math.sin(x * 0.91 + y * 1.37) + 3 * Math.sin(x * 2.7 - y * 1.6);
          pixels[pixel] = 20 + fleck;
          pixels[pixel + 1] = 35 + fleck;
          pixels[pixel + 2] = 37 + fleck;
          pixels[pixel + 3] = 255;
          continue;
        }

        const center = height[index];
        const left = tank.sampleHeight(x - 1, y, center);
        const right = tank.sampleHeight(x + 1, y, center);
        const top = tank.sampleHeight(x, y - 1, center);
        const bottom = tank.sampleHeight(x, y + 1, center);
        const slopeX = right - left;
        const slopeY = bottom - top;
        const slope = Math.hypot(slopeX, slopeY);
        const crest = clamp(Math.abs(center) * 5.2 + slope * 6.4 + Math.abs(velocity[index]) * 0.58, 0, 1);
        const light = clamp(0.48 - slopeX * 0.82 - slopeY * 0.56 + center * 0.18, 0.14, 0.92);
        const shimmer = 0.06 * Math.sin(time * 0.75 + x * 0.19 + y * 0.12);
        pixels[pixel] = clamp(Math.round(3 + light * 9 + crest * 56 + shimmer * 14), 0, 255);
        pixels[pixel + 1] = clamp(Math.round(28 + light * 32 + crest * 112 + shimmer * 24), 0, 255);
        pixels[pixel + 2] = clamp(Math.round(42 + light * 42 + crest * 122 + shimmer * 20), 0, 255);
        pixels[pixel + 3] = 255;
      }
    }
    state.surfaceContext.putImageData(state.surfaceImage, 0, 0);
  }

  function traceObstacle(shape) {
    if (shape.type === "circle") {
      context.arc(0, 0, shape.radius, 0, Math.PI * 2);
      return;
    }
    const radius = shape.width * 0.5;
    const halfLength = Math.max(0, shape.length * 0.5 - radius);
    context.moveTo(-halfLength, -radius);
    context.lineTo(halfLength, -radius);
    context.arc(halfLength, 0, radius, -Math.PI / 2, Math.PI / 2);
    context.lineTo(-halfLength, radius);
    context.arc(-halfLength, 0, radius, Math.PI / 2, Math.PI * 1.5);
  }

  function drawObstacles() {
    const layout = currentLayout();
    for (const shape of layout.obstacles) {
      context.save();
      context.translate(shape.x * state.width, shape.y * state.height);
      // The solver uses a field-aspect correction, so scale both axes by the
      // display height here to keep circular rocks visually circular too.
      context.scale(state.height, state.height);
      context.rotate(shape.rotation || 0);
      context.beginPath();
      traceObstacle(shape);
      context.closePath();
      context.shadowColor = "rgba(0, 0, 0, 0.54)";
      context.shadowBlur = 0.026;
      context.shadowOffsetY = 0.012;
      context.fillStyle = "rgba(17, 31, 33, 0.86)";
      context.fill();
      context.shadowColor = "transparent";
      context.lineWidth = 0.008;
      context.strokeStyle = "rgba(169, 226, 213, 0.26)";
      context.stroke();
      context.restore();
    }
  }

  function drawMarkers() {
    context.save();
    for (const marker of state.markers) {
      const progress = marker.age / 1.1;
      const radius = (0.012 + progress * 0.12) * state.height;
      context.beginPath();
      context.arc(marker.u * state.width, marker.v * state.height, radius, 0, Math.PI * 2);
      context.lineWidth = Math.max(1, state.height * 0.0022);
      context.strokeStyle = `rgba(187, 255, 244, ${(1 - progress) * 0.36 * marker.intensity})`;
      context.stroke();
    }
    context.restore();
  }

  function render() {
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    drawBackground();
    populateSurface();
    context.imageSmoothingEnabled = true;
    context.globalAlpha = 0.96;
    context.drawImage(state.surfaceCanvas, 0, 0, state.width, state.height);
    context.globalAlpha = 1;
    drawMarkers();
    drawObstacles();
  }

  function updateStatus() {
    if (!state.tank) return;
    const stateLabel = state.paused ? "Paused" : "Running";
    status.textContent = `${stateLabel} · ${state.fps} fps · ${state.tank.columns}×${state.tank.rows} cells · ${currentLayout().name}`;
  }

  function frame(now) {
    const elapsed = Math.min((now - state.lastFrame) / 1000, fixedStep * maxStepsPerFrame);
    state.lastFrame = now;
    if (!state.paused) {
      state.accumulator += elapsed;
      let steps = 0;
      while (state.accumulator >= fixedStep && steps < maxStepsPerFrame) {
        update(now);
        state.accumulator -= fixedStep;
        steps += 1;
      }
    }
    render();
    state.fpsFrames += 1;
    if (now - state.fpsClock >= 500) {
      state.fps = Math.round((state.fpsFrames * 1000) / (now - state.fpsClock));
      state.fpsClock = now;
      state.fpsFrames = 0;
      updateStatus();
    }
    requestAnimationFrame(frame);
  }

  function pointFromEvent(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      u: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
      v: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
    };
  }

  function attachPointers() {
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture?.(event.pointerId);
      const point = pointFromEvent(event);
      state.pointers.set(event.pointerId, { ...point, lastU: point.u, lastV: point.v });
      addRipple(point.u, point.v, 1, 1);
    });

    canvas.addEventListener("pointermove", (event) => {
      const pointer = state.pointers.get(event.pointerId);
      if (!pointer) return;
      event.preventDefault();
      const point = pointFromEvent(event);
      const distance = Math.hypot(point.u - pointer.lastU, point.v - pointer.lastV);
      if (distance > 0.018) {
        const count = Math.min(4, Math.ceil(distance / 0.025));
        for (let index = 1; index <= count; index += 1) {
          const amount = index / count;
          addRipple(
            pointer.lastU + (point.u - pointer.lastU) * amount,
            pointer.lastV + (point.v - pointer.lastV) * amount,
            0.27,
            0.62,
          );
        }
        pointer.lastU = point.u;
        pointer.lastV = point.v;
      }
    });

    const release = (event) => {
      state.pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("lostpointercapture", release);
  }

  function isControlTarget(target) {
    return target instanceof HTMLElement && Boolean(target.closest("button, input, summary, a"));
  }

  document.addEventListener("keydown", (event) => {
    if (isControlTarget(event.target)) return;
    if (event.code === "Space") {
      event.preventDefault();
      setPaused(!state.paused);
    } else if (event.code === "Enter") {
      event.preventDefault();
      dropRipple();
    } else if (event.code === "KeyM") {
      event.preventDefault();
      state.layoutIndex = (state.layoutIndex + 1) % layouts.length;
      applyLayout();
    } else if (event.code === "KeyR") {
      event.preventDefault();
      reset();
    }
  });

  resetButton.addEventListener("click", reset);
  pauseButton.addEventListener("click", () => setPaused(!state.paused));
  rainButton.addEventListener("click", () => setRain(!state.rain));
  dropButton.addEventListener("click", dropRipple);
  layoutButton.addEventListener("click", () => {
    state.layoutIndex = (state.layoutIndex + 1) % layouts.length;
    applyLayout();
  });
  [forceInput, speedInput, dampingInput].forEach((input) => input.addEventListener("input", applySettings));
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    state.lastFrame = performance.now();
    state.accumulator = 0;
    if (document.hidden) state.pointers.clear();
  });
  motionQuery.addEventListener("change", (event) => {
    if (event.matches) setPaused(true);
  });

  applySettings();
  syncPauseButton();
  attachPointers();
  resize();
  updateStatus();
  requestAnimationFrame(frame);
})();
