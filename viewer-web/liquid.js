(function () {
  "use strict";

  const canvas = document.getElementById("liquid-canvas");
  const context = canvas.getContext("2d", { alpha: false });
  const fluidLayer = document.createElement("canvas");
  const fluidContext = fluidLayer.getContext("2d");
  const liquid = new window.PbdLiquid();
  const pauseButton = document.getElementById("pause-btn");
  const clearButton = document.getElementById("clear-btn");
  const autoButton = document.getElementById("auto-btn");
  const gravityInput = document.getElementById("gravity-input");
  const viscosityInput = document.getElementById("viscosity-input");
  const rateInput = document.getElementById("rate-input");
  const gravityValue = document.getElementById("gravity-value");
  const viscosityValue = document.getElementById("viscosity-value");
  const rateValue = document.getElementById("rate-value");
  const status = document.getElementById("status");
  const hint = document.getElementById("hint");

  let paused = false;
  let auto = true;
  let lastFrame = performance.now();
  let accumulator = 0;
  let lastEmission = 0;
  let frames = 0;
  let fps = 0;
  let fpsClock = performance.now();
  const fixedStep = 1 / 75;
  const maxStepsPerFrame = 3;
  const pointers = new Map();
  const trailingPours = [];
  const streamInterval = 1000 / 18;
  const minimumTapDuration = 320;

  resize();
  applySettings();
  requestAnimationFrame(frame);

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    lastFrame = performance.now();
    accumulator = 0;
    if (document.hidden) {
      pointers.clear();
    }
  });

  window.addEventListener("blur", () => pointers.clear());

  pauseButton.addEventListener("click", () => {
    paused = !paused;
    syncPauseButton();
  });

  clearButton.addEventListener("click", () => {
    liquid.clear();
    pointers.clear();
    trailingPours.length = 0;
    setAuto(false);
    updateStatus();
  });

  autoButton.addEventListener("click", () => setAuto(!auto));

  [gravityInput, viscosityInput, rateInput].forEach((input) => {
    input.addEventListener("input", applySettings);
  });

  attachPointers();

  function frame(now) {
    const elapsed = Math.min((now - lastFrame) / 1000, fixedStep * maxStepsPerFrame);
    lastFrame = now;

    if (!paused) {
      emitInteractiveStreams(now);
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= fixedStep && steps < maxStepsPerFrame) {
        liquid.step(fixedStep);
        accumulator -= fixedStep;
        steps += 1;
      }

      const particlesPerSecond = Number(rateInput.value);
      const emissionInterval = 1000 / Math.max(1, particlesPerSecond);
      if (auto && now - lastEmission >= emissionInterval) {
        liquid.emitStream(1);
        lastEmission = now;
      }
    }

    render();
    frames += 1;
    if (now - fpsClock >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsClock));
      frames = 0;
      fpsClock = now;
      updateStatus();
    }
    requestAnimationFrame(frame);
  }

  function render() {
    const width = canvas.width;
    const height = canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    context.setTransform(1, 0, 0, 1, 0, 0);

    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#102129");
    background.addColorStop(0.58, "#091318");
    background.addColorStop(1, "#05090b");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    drawBowl(context, width, height);

    fluidContext.setTransform(1, 0, 0, 1, 0, 0);
    const fluidWidth = fluidLayer.width;
    const fluidHeight = fluidLayer.height;
    fluidContext.clearRect(0, 0, fluidWidth, fluidHeight);
    fluidContext.save();
    fluidContext.filter = `blur(${1.5 * dpr}px)`;
    fluidContext.fillStyle = "rgba(92, 205, 235, 0.86)";
    const particlePixels = Math.max(5 * dpr, liquid.particleRadius * Math.min(width, height) * 2.1);
    const layerScale = fluidWidth / width;
    const layerParticlePixels = particlePixels * layerScale;
    for (const particle of liquid.particles) {
      fluidContext.beginPath();
      fluidContext.arc(
        particle.x * fluidWidth,
        particle.y * fluidHeight,
        layerParticlePixels,
        0,
        Math.PI * 2
      );
      fluidContext.fill();
    }
    fluidContext.restore();

    context.globalCompositeOperation = "screen";
    context.drawImage(fluidLayer, 0, 0, width, height);
    context.globalCompositeOperation = "source-over";

    context.fillStyle = "rgba(221, 250, 255, 0.52)";
    const highlightPixels = Math.max(1.4 * dpr, particlePixels * 0.22);
    for (let index = 0; index < liquid.particles.length; index += 3) {
      const particle = liquid.particles[index];
      context.beginPath();
      context.arc(
        particle.x * width - particlePixels * 0.2,
        particle.y * height - particlePixels * 0.22,
        highlightPixels,
        0,
        Math.PI * 2
      );
      context.fill();
    }
  }

  function drawBowl(target, width, height) {
    const centerX = liquid.bowlCenterX * width;
    const rimY = liquid.rimY * height;
    const radiusX = liquid.bowlRadiusX * width;
    const radiusY = liquid.bowlRadiusY * height;
    const bowlGradient = target.createLinearGradient(0, rimY, 0, rimY + radiusY);
    bowlGradient.addColorStop(0, "rgba(166, 211, 222, 0.2)");
    bowlGradient.addColorStop(1, "rgba(69, 103, 113, 0.08)");

    target.beginPath();
    target.ellipse(centerX, rimY, radiusX, radiusY, 0, 0, Math.PI);
    target.closePath();
    target.fillStyle = bowlGradient;
    target.fill();
    target.lineWidth = Math.max(2, Math.min(width, height) * 0.004);
    target.strokeStyle = "rgba(170, 215, 226, 0.68)";
    target.stroke();

    target.beginPath();
    target.moveTo(centerX - radiusX, rimY);
    target.lineTo(centerX + radiusX, rimY);
    target.lineWidth *= 0.65;
    target.strokeStyle = "rgba(211, 240, 246, 0.5)";
    target.stroke();

    target.fillStyle = "rgba(112, 215, 237, 0.28)";
    target.fillRect(centerX - 2, 0.055 * height, 4, 0.055 * height);
  }

  function attachPointers() {
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      hint.classList.add("is-hidden");
      const position = pointerPosition(event);
      pointers.set(event.pointerId, {
        ...position,
        startX: position.x,
        startY: position.y,
        startedAt: performance.now(),
        nextEmission: 0,
        moved: false,
      });
    });

    canvas.addEventListener("pointermove", (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) {
        return;
      }
      event.preventDefault();
      const current = pointerPosition(event);
      const moved = previous.moved || Math.hypot(
        current.x - previous.startX,
        current.y - previous.startY
      ) > 0.012;
      liquid.addImpulse(
        current.x,
        current.y,
        (current.x - previous.x) * 9,
        (current.y - previous.y) * 9,
        0.11
      );
      pointers.set(event.pointerId, {
        ...current,
        startX: previous.startX,
        startY: previous.startY,
        startedAt: previous.startedAt,
        nextEmission: previous.nextEmission,
        moved,
      });
    });

    canvas.addEventListener("pointerup", (event) => {
      const pointer = pointers.get(event.pointerId);
      if (pointer) {
        const position = pointerPosition(event);
        const now = performance.now();
        const remainingTapTime = minimumTapDuration - (now - pointer.startedAt);
        if (remainingTapTime > 0) {
          trailingPours.push({
            x: position.x,
            y: position.y,
            endsAt: now + remainingTapTime,
            nextEmission: Math.min(pointer.nextEmission, now),
          });
        }
      }
      pointers.delete(event.pointerId);
    });
    canvas.addEventListener("pointercancel", (event) => pointers.delete(event.pointerId));
    canvas.addEventListener("lostpointercapture", (event) => pointers.delete(event.pointerId));
  }

  function pointerPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  }

  function emitInteractiveStreams(now) {
    for (const pointer of pointers.values()) {
      if (now >= pointer.nextEmission) {
        liquid.emitStream(1, pointer.x, pointer.y);
        pointer.nextEmission = now + streamInterval;
      }
    }

    for (let index = trailingPours.length - 1; index >= 0; index -= 1) {
      const pour = trailingPours[index];
      if (now > pour.endsAt) {
        trailingPours.splice(index, 1);
        continue;
      }
      if (now >= pour.nextEmission) {
        liquid.emitStream(1, pour.x, pour.y);
        pour.nextEmission = now + streamInterval;
      }
    }

  }

  function setAuto(next) {
    auto = next;
    autoButton.classList.toggle("is-active", auto);
    autoButton.setAttribute("aria-checked", String(auto));
  }

  function syncPauseButton() {
    pauseButton.dataset.paused = String(paused);
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.setAttribute("aria-label", paused ? "Play simulation" : "Pause simulation");
    pauseButton.title = paused ? "Play simulation" : "Pause simulation";
  }

  function applySettings() {
    liquid.setGravity(Number(gravityInput.value) / 100);
    liquid.setViscosity(Number(viscosityInput.value) / 100);
    gravityValue.textContent = (Number(gravityInput.value) / 100).toFixed(2);
    viscosityValue.textContent = `${viscosityInput.value}%`;
    rateValue.textContent = `${rateInput.value}/s`;
  }

  function updateStatus() {
    status.textContent = `${liquid.particles.length} particles · ${fps} fps`;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.width = width;
    canvas.height = height;
    // The blurred metaball layer does not need full display resolution. Its
    // half-size buffer is scaled back up for a smoother surface at a fraction
    // of the fill and blur cost.
    fluidLayer.width = Math.max(1, Math.floor(width * 0.5));
    fluidLayer.height = Math.max(1, Math.floor(height * 0.5));
  }
})();
