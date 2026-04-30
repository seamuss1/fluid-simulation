(function () {
  const canvas = document.getElementById("sim-canvas");
  const stageWrap = document.querySelector(".stage-wrap");
  const fillToggle = document.getElementById("fill-toggle");
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");
  const flowInput = document.getElementById("flow-input");
  const viscosityInput = document.getElementById("viscosity-input");
  const orbitInput = document.getElementById("orbit-input");
  const flowValue = document.getElementById("flow-value");
  const viscosityValue = document.getElementById("viscosity-value");
  const orbitValue = document.getElementById("orbit-value");
  const fillStat = document.getElementById("fill-stat");
  const heightStat = document.getElementById("height-stat");
  const particleStat = document.getElementById("particle-stat");
  const statusLine = document.getElementById("status-line");
  const progressBar = document.getElementById("progress-bar");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    statusLine.textContent = "Canvas 2D is unavailable in this browser.";
    return;
  }

  const container = {
    width: 3.2,
    depth: 1.9,
    height: 3.5,
    inset: 0.1,
  };
  const bounds = {
    left: -container.width * 0.5 + container.inset,
    right: container.width * 0.5 - container.inset,
    front: -container.depth * 0.5 + container.inset,
    back: container.depth * 0.5 - container.inset,
  };
  const footprint = (bounds.right - bounds.left) * (bounds.back - bounds.front);
  const maxFillHeight = container.height - 0.18;
  const capacity = footprint * maxFillHeight;
  const nozzle = {
    x: bounds.left - 0.76,
    y: container.height + 1.55,
    z: -0.08,
  };
  const surfaceField = createSurfaceField(26, 18);
  const lightDir = normalizeVector(0.3, 0.9, -0.32);
  const halfVector = normalizeVector(0.16, 0.87, 0.46);
  const state = createState();

  function createState() {
    return {
      lastFrame: performance.now(),
      time: 0,
      fillVolume: 0,
      isPaused: false,
      isFilling: true,
      orbitOffset: 0.06,
      pitch: -0.56,
      spawnCarry: 0,
      droplets: [],
      spray: [],
      bulkTiltX: 0,
      bulkTiltZ: 0,
      bulkTiltVX: 0,
      bulkTiltVZ: 0,
      drag: {
        active: false,
        id: null,
        x: 0,
        y: 0,
      },
      stage: {
        width: 1,
        height: 1,
        cx: 0,
        cy: 0,
        scale: 1,
      },
    };
  }

  function createSurfaceField(cols, rows) {
    return {
      cols,
      rows,
      heights: new Float32Array(cols * rows),
      velocities: new Float32Array(cols * rows),
      nextHeights: new Float32Array(cols * rows),
      nextVelocities: new Float32Array(cols * rows),
      foam: new Float32Array(cols * rows),
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function rgba(r, g, b, a) {
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function normalizeVector(x, y, z) {
    const length = Math.hypot(x, y, z) || 1;
    return {
      x: x / length,
      y: y / length,
      z: z / length,
    };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function settings() {
    return {
      flow: Number(flowInput.value) / 100,
      viscosity: Number(viscosityInput.value) / 100,
      orbitSweep: Number(orbitInput.value) / 100,
    };
  }

  function resizeCanvas() {
    const rect = stageWrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.stage.width = rect.width;
    state.stage.height = rect.height;
    state.stage.cx = rect.width * 0.52;
    state.stage.cy = rect.height * 0.6;
    state.stage.scale = Math.min(rect.width, rect.height) * 0.72;
  }

  function currentOrbit() {
    const control = settings().orbitSweep;
    return lerp(0.42, 1.02, control) + state.orbitOffset;
  }

  function toCamera(point) {
    const yaw = currentOrbit();
    const pitch = state.pitch;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const centeredX = point.x;
    const centeredY = point.y - container.height * 0.48;
    const centeredZ = point.z;
    const x1 = centeredX * cy - centeredZ * sy;
    const z1 = centeredX * sy + centeredZ * cy;
    const y2 = centeredY * cp - z1 * sp;
    const z2 = centeredY * sp + z1 * cp + 7.2;
    return { x: x1, y: y2, z: z2 };
  }

  function project(point) {
    const camera = toCamera(point);
    if (camera.z <= 0.2) {
      return null;
    }
    const scale = state.stage.scale / camera.z;
    return {
      x: state.stage.cx + camera.x * scale,
      y: state.stage.cy - camera.y * scale,
      depth: camera.z,
      scale,
    };
  }

  function fillHeight() {
    return clamp(state.fillVolume / footprint, 0, maxFillHeight);
  }

  function cellIndex(ix, iz) {
    return iz * surfaceField.cols + ix;
  }

  function cellWorld(ix, iz) {
    return {
      x: lerp(bounds.left, bounds.right, ix / (surfaceField.cols - 1)),
      z: lerp(bounds.front, bounds.back, iz / (surfaceField.rows - 1)),
    };
  }

  function sampleField(array, x, z) {
    const u = clamp((x - bounds.left) / (bounds.right - bounds.left), 0, 1);
    const v = clamp((z - bounds.front) / (bounds.back - bounds.front), 0, 1);
    const gx = u * (surfaceField.cols - 1);
    const gz = v * (surfaceField.rows - 1);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(surfaceField.cols - 1, x0 + 1);
    const z1 = Math.min(surfaceField.rows - 1, z0 + 1);
    const tx = gx - x0;
    const tz = gz - z0;
    const a = array[cellIndex(x0, z0)];
    const b = array[cellIndex(x1, z0)];
    const c = array[cellIndex(x0, z1)];
    const d = array[cellIndex(x1, z1)];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  function wallMeniscus(x, z) {
    const baseHeight = fillHeight();
    if (baseHeight <= 0.02) {
      return 0;
    }
    const distanceToWall = Math.min(x - bounds.left, bounds.right - x, z - bounds.front, bounds.back - z);
    const edge = Math.exp(-Math.max(0, distanceToWall) * 14);
    return edge * (0.018 + settings().viscosity * 0.024) * Math.pow(baseHeight / maxFillHeight, 0.55);
  }

  function sampleSurface(x, z) {
    const baseHeight = fillHeight();
    if (baseHeight <= 0.001) {
      return 0;
    }
    const tilt = state.bulkTiltX * x + state.bulkTiltZ * z;
    return clamp(baseHeight + sampleField(surfaceField.heights, x, z) + tilt + wallMeniscus(x, z), 0, maxFillHeight);
  }

  function sampleFoam(x, z) {
    if (fillHeight() <= 0.02) {
      return 0;
    }
    return clamp(sampleField(surfaceField.foam, x, z), 0, 1);
  }

  function sampleSurfaceNormal(x, z) {
    const stepX = (bounds.right - bounds.left) / (surfaceField.cols - 1);
    const stepZ = (bounds.back - bounds.front) / (surfaceField.rows - 1);
    const left = sampleSurface(clamp(x - stepX, bounds.left, bounds.right), z);
    const right = sampleSurface(clamp(x + stepX, bounds.left, bounds.right), z);
    const front = sampleSurface(x, clamp(z - stepZ, bounds.front, bounds.back));
    const back = sampleSurface(x, clamp(z + stepZ, bounds.front, bounds.back));
    return normalizeVector(-(right - left) / (stepX * 2), 1, -(back - front) / (stepZ * 2));
  }

  function getPourTarget() {
    const wobble = 1 - settings().viscosity * 0.48;
    const x = bounds.left * 0.34 + 0.08 + Math.sin(state.time * 1.08) * 0.04 * wobble;
    const z = -0.04 + Math.cos(state.time * 0.74) * 0.026 * wobble;
    return {
      x,
      y: Math.max(sampleSurface(x, z), 0.02),
      z,
    };
  }

  function emitDroplet() {
    const { flow } = settings();
    const target = getPourTarget();
    const spread = 0.035 + flow * 0.05;
    state.droplets.push({
      x: nozzle.x + (Math.random() - 0.5) * spread,
      y: nozzle.y + Math.random() * 0.05,
      z: nozzle.z + (Math.random() - 0.5) * spread * 0.9,
      vx: (target.x - nozzle.x) * 0.82 + (Math.random() - 0.5) * 0.08,
      vy: -(4.4 + flow * 2.25) + (Math.random() - 0.5) * 0.18,
      vz: (target.z - nozzle.z) * 0.9 + (Math.random() - 0.5) * 0.07,
      radius: 0.018 + Math.random() * 0.012 + flow * 0.009,
      payload: 0.012 + flow * 0.028,
    });
  }

  function addSurfaceImpulse(x, z, speed, vx, vz) {
    const radius = 0.17 + speed * 0.018 + fillHeight() / maxFillHeight * 0.05;
    const radiusSq = radius * radius;
    for (let iz = 0; iz < surfaceField.rows; iz += 1) {
      for (let ix = 0; ix < surfaceField.cols; ix += 1) {
        const idx = cellIndex(ix, iz);
        const world = cellWorld(ix, iz);
        const dx = world.x - x;
        const dz = world.z - z;
        const distSq = dx * dx + dz * dz;
        if (distSq > radiusSq * 4) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        const gaussian = Math.exp(-distSq / (radiusSq * 0.9 + 0.0001));
        const ring = Math.exp(-Math.pow(dist - radius * 0.65, 2) / (radiusSq * 0.22 + 0.0001));
        surfaceField.velocities[idx] -= speed * 0.18 * gaussian;
        surfaceField.heights[idx] += speed * 0.021 * ring;
        surfaceField.foam[idx] = clamp(surfaceField.foam[idx] + gaussian * 0.72 + ring * 0.25, 0, 1.35);
      }
    }

    state.bulkTiltVX = clamp(state.bulkTiltVX + vx * 0.05, -0.8, 0.8);
    state.bulkTiltVZ = clamp(state.bulkTiltVZ + vz * 0.045, -0.6, 0.6);
  }

  function addImpact(x, z, speed, vx, vz, payload, fromSplash) {
    const boundedX = clamp(x, bounds.left, bounds.right);
    const boundedZ = clamp(z, bounds.front, bounds.back);
    // Splash particles are redistributed liquid that was already counted when it entered the tank.
    const volumeDelta = fromSplash ? 0 : payload;
    state.fillVolume = clamp(state.fillVolume + volumeDelta, 0, capacity);
    addSurfaceImpulse(boundedX, boundedZ, speed, vx, vz);

    if (fromSplash) {
      return;
    }

    const { flow, viscosity } = settings();
    const splashCount = Math.round(3 + speed * (1.3 - viscosity * 0.45));
    for (let i = 0; i < splashCount; i += 1) {
      state.spray.push({
        x: boundedX,
        y: sampleSurface(boundedX, boundedZ) + 0.01,
        z: boundedZ,
        vx: (Math.random() - 0.5) * (0.65 + flow * 1.05),
        vy: 0.9 + Math.random() * (1.6 - viscosity * 0.35),
        vz: (Math.random() - 0.5) * (0.5 + flow * 0.7),
        radius: 0.01 + Math.random() * 0.015,
        life: 0,
        payload: 0.0016,
      });
    }
  }

  function updateDroplets(dt) {
    for (let i = state.droplets.length - 1; i >= 0; i -= 1) {
      const droplet = state.droplets[i];
      droplet.vy -= 10.8 * dt;
      droplet.vx *= 1 - dt * 0.18;
      droplet.vz *= 1 - dt * 0.2;
      droplet.x += droplet.vx * dt;
      droplet.y += droplet.vy * dt;
      droplet.z += droplet.vz * dt;

      const inside =
        droplet.x >= bounds.left &&
        droplet.x <= bounds.right &&
        droplet.z >= bounds.front &&
        droplet.z <= bounds.back;
      if (inside) {
        const liquidSurface = sampleSurface(droplet.x, droplet.z);
        if (liquidSurface > 0 && droplet.y <= liquidSurface) {
          addImpact(droplet.x, droplet.z, Math.abs(droplet.vy), droplet.vx, droplet.vz, droplet.payload, false);
          state.droplets.splice(i, 1);
          continue;
        }

        if (droplet.y <= 0.02) {
          addImpact(droplet.x, droplet.z, Math.abs(droplet.vy) * 0.78, droplet.vx, droplet.vz, droplet.payload * 0.92, false);
          state.droplets.splice(i, 1);
          continue;
        }
      }

      if (droplet.y < -0.8 || droplet.x > bounds.right + 0.8 || droplet.x < nozzle.x - 0.4 || Math.abs(droplet.z) > container.depth * 1.25) {
        state.droplets.splice(i, 1);
      }
    }
  }

  function updateSpray(dt) {
    for (let i = state.spray.length - 1; i >= 0; i -= 1) {
      const particle = state.spray[i];
      particle.life += dt;
      particle.vy -= 10.8 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;

      if (particle.x <= bounds.left || particle.x >= bounds.right) {
        particle.x = clamp(particle.x, bounds.left, bounds.right);
        particle.vx *= -0.38;
      }
      if (particle.z <= bounds.front || particle.z >= bounds.back) {
        particle.z = clamp(particle.z, bounds.front, bounds.back);
        particle.vz *= -0.34;
      }

      if (particle.y <= sampleSurface(particle.x, particle.z) + 0.02 && particle.vy < 0) {
        addImpact(particle.x, particle.z, Math.abs(particle.vy) * 0.4, particle.vx, particle.vz, particle.payload ?? 0, true);
        state.spray.splice(i, 1);
        continue;
      }

      if (particle.life > 2.2 || particle.y < -0.5) {
        state.spray.splice(i, 1);
      }
    }
  }

  function updateSurfaceField(dt) {
    const { viscosity } = settings();
    const base = fillHeight();
    const waveStrength = lerp(44, 18, viscosity);
    const restoring = lerp(24, 10, viscosity);
    const damping = Math.exp(-dt * lerp(7.2, 16, viscosity));
    const smoothing = 0.045 + viscosity * 0.08;

    for (let iz = 0; iz < surfaceField.rows; iz += 1) {
      for (let ix = 0; ix < surfaceField.cols; ix += 1) {
        const idx = cellIndex(ix, iz);
        const center = surfaceField.heights[idx];
        const left = surfaceField.heights[cellIndex(Math.max(0, ix - 1), iz)];
        const right = surfaceField.heights[cellIndex(Math.min(surfaceField.cols - 1, ix + 1), iz)];
        const front = surfaceField.heights[cellIndex(ix, Math.max(0, iz - 1))];
        const back = surfaceField.heights[cellIndex(ix, Math.min(surfaceField.rows - 1, iz + 1))];
        const edge = ix === 0 || iz === 0 || ix === surfaceField.cols - 1 || iz === surfaceField.rows - 1;
        let velocity = surfaceField.velocities[idx] + (left + right + front + back - center * 4) * waveStrength * dt - center * restoring * dt;
        if (edge) {
          velocity += -center * 14 * dt;
        }
        velocity *= damping;
        let height = center + velocity * dt;
        const neighborAverage = (left + right + front + back) * 0.25;
        height = lerp(height, neighborAverage, smoothing * (edge ? 1.3 : 1));
        if (base <= 0.02) {
          height *= 0.82;
        }
        surfaceField.nextHeights[idx] = clamp(height, -0.18, 0.18);
        surfaceField.nextVelocities[idx] = velocity;
        surfaceField.foam[idx] *= Math.exp(-dt * (1.9 + viscosity * 1.3));
      }
    }

    const oldHeights = surfaceField.heights;
    const oldVelocities = surfaceField.velocities;
    surfaceField.heights = surfaceField.nextHeights;
    surfaceField.velocities = surfaceField.nextVelocities;
    surfaceField.nextHeights = oldHeights;
    surfaceField.nextVelocities = oldVelocities;

    const tiltSpring = 4.8 + viscosity * 5.6;
    const tiltDamping = Math.exp(-dt * (3.8 + viscosity * 6.2));
    state.bulkTiltVX += -state.bulkTiltX * tiltSpring * dt;
    state.bulkTiltVZ += -state.bulkTiltZ * tiltSpring * dt;
    state.bulkTiltVX *= tiltDamping;
    state.bulkTiltVZ *= tiltDamping;
    state.bulkTiltX = clamp(state.bulkTiltX + state.bulkTiltVX * dt, -0.11, 0.11);
    state.bulkTiltZ = clamp(state.bulkTiltZ + state.bulkTiltVZ * dt, -0.085, 0.085);
    if (base <= 0.01) {
      state.bulkTiltX *= 0.78;
      state.bulkTiltZ *= 0.78;
    }
  }

  function updateSimulation(dt) {
    state.time += dt;
    const { flow } = settings();

    if (state.isFilling && state.fillVolume < capacity) {
      state.spawnCarry += dt * lerp(28, 96, flow);
      while (state.spawnCarry >= 1 && state.droplets.length < 540) {
        emitDroplet();
        state.spawnCarry -= 1;
      }
    }

    updateDroplets(dt);
    updateSpray(dt);
    updateSurfaceField(dt);

    if (state.fillVolume >= capacity * 0.995) {
      state.fillVolume = capacity;
      state.isFilling = false;
    }
  }

  function drawPolygon(points, fillStyle, strokeStyle, lineWidth) {
    const projected = [];
    for (let i = 0; i < points.length; i += 1) {
      const point = project(points[i]);
      if (!point) {
        return;
      }
      projected.push(point);
    }

    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    for (let i = 1; i < projected.length; i += 1) {
      ctx.lineTo(projected[i].x, projected[i].y);
    }
    ctx.closePath();
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function drawLine(pointA, pointB, color, width, dash) {
    const a = project(pointA);
    const b = project(pointB);
    if (!a || !b) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash(dash || []);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  function drawBackground() {
    const w = state.stage.width;
    const h = state.stage.height;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0d1720");
    bg.addColorStop(0.55, "#132735");
    bg.addColorStop(1, "#1c2d31");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const glowA = ctx.createRadialGradient(w * 0.18, h * 0.18, 20, w * 0.18, h * 0.18, w * 0.52);
    glowA.addColorStop(0, "rgba(255, 218, 144, 0.2)");
    glowA.addColorStop(1, "rgba(255, 218, 144, 0)");
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, w, h);

    const glowB = ctx.createRadialGradient(w * 0.86, h * 0.12, 24, w * 0.86, h * 0.12, w * 0.38);
    glowB.addColorStop(0, "rgba(123, 227, 224, 0.16)");
    glowB.addColorStop(1, "rgba(123, 227, 224, 0)");
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i += 1) {
      const y = h * (0.14 + i * 0.13);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function drawRoom() {
    drawPolygon(
      [
        { x: -4.8, y: 0, z: -3.8 },
        { x: 4.8, y: 0, z: -3.8 },
        { x: 4.8, y: 0, z: 3.8 },
        { x: -4.8, y: 0, z: 3.8 },
      ],
      "rgba(36, 58, 66, 0.46)",
      "rgba(255, 255, 255, 0.03)",
      1
    );

    drawPolygon(
      [
        { x: -4.2, y: 0, z: 3.6 },
        { x: 4.2, y: 0, z: 3.6 },
        { x: 4.2, y: 5, z: 3.6 },
        { x: -4.2, y: 5, z: 3.6 },
      ],
      "rgba(120, 171, 188, 0.05)",
      null,
      0
    );
  }

  function drawFloorShadow() {
    const points = [];
    const radiusX = container.width * 0.86;
    const radiusZ = container.depth * 1.06;
    for (let i = 0; i < 28; i += 1) {
      const angle = (Math.PI * 2 * i) / 28;
      points.push({
        x: Math.cos(angle) * radiusX,
        y: -0.018,
        z: Math.sin(angle) * radiusZ,
      });
    }
    drawPolygon(points, "rgba(2, 10, 16, 0.28)", null, 0);
  }

  function drawBackGlass() {
    const halfW = container.width * 0.5;
    const halfD = container.depth * 0.5;
    const h = container.height;
    drawPolygon(
      [
        { x: -halfW, y: 0, z: halfD },
        { x: halfW, y: 0, z: halfD },
        { x: halfW, y: h, z: halfD },
        { x: -halfW, y: h, z: halfD },
      ],
      "rgba(204, 233, 241, 0.05)",
      rgba(226, 247, 255, 0.1),
      1
    );
    drawPolygon(
      [
        { x: -halfW, y: 0, z: -halfD },
        { x: -halfW, y: 0, z: halfD },
        { x: -halfW, y: h, z: halfD },
        { x: -halfW, y: h, z: -halfD },
      ],
      "rgba(204, 233, 241, 0.035)",
      rgba(226, 247, 255, 0.08),
      1
    );
  }

  function pushPolygon(renderables, points, fillStyle, strokeStyle, lineWidth) {
    const projected = [];
    let depth = 0;
    for (let i = 0; i < points.length; i += 1) {
      const point = project(points[i]);
      if (!point) {
        return;
      }
      projected.push(point);
      depth += point.depth;
    }
    renderables.push({
      kind: "poly",
      projected,
      depth: depth / points.length,
      fillStyle,
      strokeStyle,
      lineWidth: lineWidth || 1,
    });
  }

  function pushCircle(renderables, particle, fillStyle, alphaScale) {
    const projected = project(particle);
    if (!projected) {
      return;
    }
    renderables.push({
      kind: "circle",
      x: projected.x,
      y: projected.y,
      depth: projected.depth,
      radius: Math.max(1.4, particle.radius * state.stage.scale * 0.18 / projected.depth),
      fillStyle,
      alphaScale: alphaScale || 1,
    });
  }

  function drawRenderable(item) {
    if (item.kind === "poly") {
      ctx.beginPath();
      ctx.moveTo(item.projected[0].x, item.projected[0].y);
      for (let i = 1; i < item.projected.length; i += 1) {
        ctx.lineTo(item.projected[i].x, item.projected[i].y);
      }
      ctx.closePath();
      if (item.fillStyle) {
        ctx.fillStyle = item.fillStyle;
        ctx.fill();
      }
      if (item.strokeStyle) {
        ctx.strokeStyle = item.strokeStyle;
        ctx.lineWidth = item.lineWidth;
        ctx.stroke();
      }
      return;
    }

    ctx.save();
    ctx.globalAlpha = item.alphaScale;
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    ctx.fillStyle = item.fillStyle;
    ctx.fill();
    ctx.restore();
  }

  function buildLiquid(renderables) {
    const surface = fillHeight();
    if (surface <= 0.001) {
      return;
    }

    const fillRatio = clamp(surface / maxFillHeight, 0, 1);

    pushPolygon(
      renderables,
      [
        { x: bounds.left, y: 0, z: bounds.front },
        { x: bounds.right, y: 0, z: bounds.front },
        { x: bounds.right, y: 0, z: bounds.back },
        { x: bounds.left, y: 0, z: bounds.back },
      ],
      rgba(6, 54, 68, 0.2 + fillRatio * 0.08),
      null,
      0
    );

    for (let slice = 0; slice < 14; slice += 1) {
      const t0 = slice / 14;
      const t1 = (slice + 1) / 14;
      const x0 = lerp(bounds.left, bounds.right, t0);
      const x1 = lerp(bounds.left, bounds.right, t1);
      const edgeFoam = (sampleFoam(x0, bounds.front) + sampleFoam(x1, bounds.front)) * 0.5;
      const depthShade = (slice + 0.5) / 14;
      pushPolygon(
        renderables,
        [
          { x: x0, y: 0, z: bounds.front },
          { x: x1, y: 0, z: bounds.front },
          { x: x1, y: sampleSurface(x1, bounds.front), z: bounds.front },
          { x: x0, y: sampleSurface(x0, bounds.front), z: bounds.front },
        ],
        rgba(16 + depthShade * 12 + edgeFoam * 26, 84 + fillRatio * 44 + edgeFoam * 24, 124 + fillRatio * 64 + edgeFoam * 12, 0.18 + fillRatio * 0.18),
        rgba(220, 247, 252, 0.03),
        0.6
      );
    }

    for (let slice = 0; slice < 10; slice += 1) {
      const t0 = slice / 10;
      const t1 = (slice + 1) / 10;
      const z0 = lerp(bounds.front, bounds.back, t0);
      const z1 = lerp(bounds.front, bounds.back, t1);
      pushPolygon(
        renderables,
        [
          { x: bounds.right, y: 0, z: z0 },
          { x: bounds.right, y: 0, z: z1 },
          { x: bounds.right, y: sampleSurface(bounds.right, z1), z: z1 },
          { x: bounds.right, y: sampleSurface(bounds.right, z0), z: z0 },
        ],
        rgba(11, 74, 103, 0.22 + fillRatio * 0.12),
        null,
        0
      );
    }

    for (let slice = 0; slice < 10; slice += 1) {
      const t0 = slice / 10;
      const t1 = (slice + 1) / 10;
      const z0 = lerp(bounds.front, bounds.back, t0);
      const z1 = lerp(bounds.front, bounds.back, t1);
      pushPolygon(
        renderables,
        [
          { x: bounds.left, y: 0, z: z0 },
          { x: bounds.left, y: 0, z: z1 },
          { x: bounds.left, y: sampleSurface(bounds.left, z1), z: z1 },
          { x: bounds.left, y: sampleSurface(bounds.left, z0), z: z0 },
        ],
        rgba(9, 64, 88, 0.15 + fillRatio * 0.08),
        null,
        0
      );
    }

    for (let ix = 0; ix < surfaceField.cols - 1; ix += 1) {
      for (let iz = 0; iz < surfaceField.rows - 1; iz += 1) {
        const p00 = cellWorld(ix, iz);
        const p10 = cellWorld(ix + 1, iz);
        const p11 = cellWorld(ix + 1, iz + 1);
        const p01 = cellWorld(ix, iz + 1);
        const cx = (p00.x + p11.x) * 0.5;
        const cz = (p00.z + p11.z) * 0.5;
        const normal = sampleSurfaceNormal(cx, cz);
        const foam = sampleFoam(cx, cz);
        const diffuse = clamp(dot(normal, lightDir), 0, 1);
        const specular = Math.pow(clamp(dot(normal, halfVector), 0, 1), 18);
        const fresnel = Math.pow(1 - clamp(normal.y, 0, 1), 1.7);
        pushPolygon(
          renderables,
          [
            { x: p00.x, y: sampleSurface(p00.x, p00.z), z: p00.z },
            { x: p10.x, y: sampleSurface(p10.x, p10.z), z: p10.z },
            { x: p11.x, y: sampleSurface(p11.x, p11.z), z: p11.z },
            { x: p01.x, y: sampleSurface(p01.x, p01.z), z: p01.z },
          ],
          rgba(34 + diffuse * 26 + specular * 92 + fresnel * 18 + foam * 55, 130 + diffuse * 48 + specular * 80 + fresnel * 20 + foam * 40, 176 + diffuse * 52 + specular * 72 + fresnel * 26 + foam * 24, 0.42 + fillRatio * 0.14 + foam * 0.08),
          rgba(225, 248, 252, 0.045 + foam * 0.06),
          0.65
        );

        if (foam > 0.14 && (ix + iz) % 2 === 0) {
          pushCircle(
            renderables,
            {
              x: cx,
              y: sampleSurface(cx, cz) + 0.012,
              z: cz,
              radius: 0.026 + foam * 0.02,
            },
            rgba(239, 252, 255, 0.78),
            0.14 + foam * 0.22
          );
        }
      }
    }
  }

  function drawStream() {
    if (!state.isFilling) {
      return;
    }

    const target = getPourTarget();
    const { flow, viscosity } = settings();
    const wobble = (1 - viscosity * 0.45) * (0.65 + flow * 0.35);
    const points = [];

    for (let i = 0; i <= 22; i += 1) {
      const t = i / 22;
      const bend = t * t;
      points.push({
        x: lerp(nozzle.x, target.x, t) + Math.sin(state.time * 5.5 + t * 10) * 0.018 * wobble * (1 - t),
        y: lerp(nozzle.y, target.y, bend) - Math.sin(t * Math.PI) * 0.16 * (0.4 + flow * 0.5),
        z: lerp(nozzle.z, target.z, t),
      });
    }

    const projected = [];
    for (let i = 0; i < points.length; i += 1) {
      const point = project(points[i]);
      if (!point) {
        return;
      }
      projected.push(point);
    }

    ctx.save();
    const leftEdge = [];
    const rightEdge = [];
    for (let i = 0; i < projected.length; i += 1) {
      const prev = projected[Math.max(0, i - 1)];
      const next = projected[Math.min(projected.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length;
      const ny = dx / length;
      const width = (7.4 - (i / projected.length) * 3.8) * (0.76 + flow * 0.28);
      leftEdge.push({ x: projected[i].x + nx * width, y: projected[i].y + ny * width });
      rightEdge.push({ x: projected[i].x - nx * width, y: projected[i].y - ny * width });
    }

    const gradient = ctx.createLinearGradient(projected[0].x, projected[0].y, projected[projected.length - 1].x, projected[projected.length - 1].y);
    gradient.addColorStop(0, "rgba(208, 253, 251, 0.72)");
    gradient.addColorStop(0.38, "rgba(124, 224, 221, 0.64)");
    gradient.addColorStop(1, "rgba(197, 255, 252, 0.24)");

    ctx.beginPath();
    ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
    for (let i = 1; i < leftEdge.length; i += 1) {
      ctx.lineTo(leftEdge[i].x, leftEdge[i].y);
    }
    for (let i = rightEdge.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    for (let i = 1; i < projected.length; i += 1) {
      ctx.lineTo(projected[i].x, projected[i].y);
    }
    ctx.strokeStyle = "rgba(243, 255, 255, 0.82)";
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.restore();
  }

  function drawNozzle() {
    drawLine(
      { x: nozzle.x - 0.15, y: nozzle.y + 0.06, z: nozzle.z },
      { x: nozzle.x + 0.22, y: nozzle.y + 0.02, z: nozzle.z },
      "rgba(241, 248, 250, 0.85)",
      5
    );
    drawLine(
      { x: nozzle.x + 0.22, y: nozzle.y + 0.02, z: nozzle.z },
      { x: nozzle.x + 0.34, y: nozzle.y - 0.06, z: nozzle.z },
      "rgba(170, 208, 219, 0.7)",
      5
    );
  }

  function drawFrontGlass() {
    const halfW = container.width * 0.5;
    const halfD = container.depth * 0.5;
    const h = container.height;
    drawPolygon(
      [
        { x: -halfW, y: 0, z: -halfD },
        { x: halfW, y: 0, z: -halfD },
        { x: halfW, y: h, z: -halfD },
        { x: -halfW, y: h, z: -halfD },
      ],
      "rgba(244, 252, 255, 0.035)",
      rgba(243, 252, 255, 0.45),
      1.3
    );
    drawPolygon(
      [
        { x: halfW, y: 0, z: -halfD },
        { x: halfW, y: 0, z: halfD },
        { x: halfW, y: h, z: halfD },
        { x: halfW, y: h, z: -halfD },
      ],
      "rgba(244, 252, 255, 0.03)",
      rgba(243, 252, 255, 0.26),
      1.1
    );

    drawLine({ x: -halfW, y: h, z: -halfD }, { x: halfW, y: h, z: -halfD }, "rgba(255, 255, 255, 0.88)", 2);
    drawLine({ x: halfW, y: h, z: -halfD }, { x: halfW, y: h, z: halfD }, "rgba(255, 255, 255, 0.55)", 2);
    drawLine({ x: -halfW, y: 0, z: -halfD }, { x: halfW, y: 0, z: -halfD }, "rgba(255, 255, 255, 0.26)", 1.4);
    drawLine({ x: halfW, y: 0, z: -halfD }, { x: halfW, y: h, z: -halfD }, "rgba(255, 255, 255, 0.42)", 1.5);
    drawLine({ x: -halfW, y: 0, z: -halfD }, { x: -halfW, y: h, z: -halfD }, "rgba(255, 255, 255, 0.22)", 1.2);
    drawLine({ x: -halfW, y: 0, z: halfD }, { x: halfW, y: 0, z: halfD }, "rgba(255, 255, 255, 0.12)", 1, [5, 7]);
    drawLine({ x: -halfW, y: h, z: halfD }, { x: halfW, y: h, z: halfD }, "rgba(255, 255, 255, 0.12)", 1, [5, 7]);
    drawLine({ x: -halfW * 0.36, y: 0.16, z: -halfD }, { x: -halfW * 0.28, y: h - 0.08, z: -halfD }, "rgba(255, 255, 255, 0.13)", 5);
    drawLine({ x: halfW * 0.52, y: 0.22, z: -halfD }, { x: halfW * 0.58, y: h - 0.14, z: -halfD }, "rgba(255, 255, 255, 0.08)", 3);
  }

  function drawScene() {
    ctx.clearRect(0, 0, state.stage.width, state.stage.height);
    drawBackground();
    drawRoom();
    drawFloorShadow();
    drawBackGlass();

    const renderables = [];
    buildLiquid(renderables);

    for (let i = 0; i < state.droplets.length; i += 1) {
      pushCircle(renderables, state.droplets[i], "rgba(196, 251, 248, 0.94)", 0.95);
    }
    for (let i = 0; i < state.spray.length; i += 1) {
      const lifeFade = clamp(1 - state.spray[i].life / 2.2, 0, 1);
      pushCircle(renderables, state.spray[i], "rgba(235, 255, 254, 0.96)", lifeFade);
    }

    renderables.sort(function (a, b) {
      return b.depth - a.depth;
    });

    drawStream();
    drawNozzle();
    for (let i = 0; i < renderables.length; i += 1) {
      drawRenderable(renderables[i]);
    }
    drawFrontGlass();
  }

  function syncUi() {
    const { flow, viscosity, orbitSweep } = settings();
    const fillRatio = clamp(state.fillVolume / capacity, 0, 1);
    const surface = fillHeight();

    flowValue.textContent = `${Math.round(flow * 100)}%`;
    viscosityValue.textContent = `${Math.round(viscosity * 100)}%`;
    orbitValue.textContent = `${Math.round(orbitSweep * 100)}%`;
    fillStat.textContent = `${Math.round(fillRatio * 100)}%`;
    heightStat.textContent = `${surface.toFixed(2)} m`;
    particleStat.textContent = String(state.droplets.length + state.spray.length);
    progressBar.style.width = `${fillRatio * 100}%`;

    if (state.isPaused) {
      statusLine.textContent = "Simulation paused. Resume to continue the fill.";
    } else if (fillRatio >= 0.995) {
      statusLine.textContent = "Tank is full. Reset to run the fill cycle again.";
    } else if (state.isFilling) {
      statusLine.textContent = "Archived prototype stream is live. Drag inside the stage to adjust the camera.";
    } else {
      statusLine.textContent = "Archived prototype fill is stopped. Resume the stream or reset the tank.";
    }

    pauseBtn.textContent = state.isPaused ? "Resume" : "Pause";
    fillToggle.textContent = state.isFilling ? "Stop Fill" : "Start Fill";
    fillToggle.disabled = fillRatio >= 0.995;
  }

  function resetSimulation() {
    const fresh = createState();
    state.lastFrame = performance.now();
    state.time = fresh.time;
    state.fillVolume = fresh.fillVolume;
    state.isPaused = false;
    state.isFilling = true;
    state.orbitOffset = fresh.orbitOffset;
    state.pitch = fresh.pitch;
    state.spawnCarry = 0;
    state.droplets = [];
    state.spray = [];
    state.bulkTiltX = 0;
    state.bulkTiltZ = 0;
    state.bulkTiltVX = 0;
    state.bulkTiltVZ = 0;
    state.drag = fresh.drag;
    surfaceField.heights.fill(0);
    surfaceField.velocities.fill(0);
    surfaceField.nextHeights.fill(0);
    surfaceField.nextVelocities.fill(0);
    surfaceField.foam.fill(0);
  }

  function animate(now) {
    const dt = Math.min(0.033, Math.max(0.001, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    if (!state.isPaused) {
      updateSimulation(dt);
    }
    drawScene();
    syncUi();
    requestAnimationFrame(animate);
  }

  fillToggle.addEventListener("click", function () {
    if (state.fillVolume >= capacity * 0.995) {
      return;
    }
    state.isFilling = !state.isFilling;
  });

  pauseBtn.addEventListener("click", function () {
    state.isPaused = !state.isPaused;
  });

  resetBtn.addEventListener("click", resetSimulation);

  canvas.addEventListener("pointerdown", function (event) {
    state.drag.active = true;
    state.drag.id = event.pointerId;
    state.drag.x = event.clientX;
    state.drag.y = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", function (event) {
    if (!state.drag.active || state.drag.id !== event.pointerId) {
      return;
    }

    const dx = event.clientX - state.drag.x;
    const dy = event.clientY - state.drag.y;
    state.drag.x = event.clientX;
    state.drag.y = event.clientY;
    state.orbitOffset = clamp(state.orbitOffset + dx * 0.0065, -0.55, 0.32);
    state.pitch = clamp(state.pitch - dy * 0.0035, -0.9, -0.24);
  });

  function releaseDrag(event) {
    if (state.drag.id !== event.pointerId) {
      return;
    }
    state.drag.active = false;
    state.drag.id = null;
  }

  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);

  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  syncUi();
  requestAnimationFrame(animate);
})();
