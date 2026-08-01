(function (root, factory) {
  const PbdLiquid = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = PbdLiquid;
  }
  root.PbdLiquid = PbdLiquid;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class PbdLiquid {
    constructor(options = {}) {
      this.maxParticles = options.maxParticles || 1800;
      this.particleRadius = options.particleRadius || 0.009;
      this.interactionRadius = options.interactionRadius || 0.038;
      this.gravity = options.gravity || 1.45;
      this.restDensity = options.restDensity || 2.8;
      this.stiffness = options.stiffness || 52;
      this.nearStiffness = options.nearStiffness || 108;
      this.viscosity = options.viscosity || 0.085;
      this.constraintIterations = options.constraintIterations || 1;
      this.viscosityPhase = 0;
      this.rimY = 0.43;
      this.bowlCenterX = 0.5;
      this.bowlRadiusX = 0.46;
      this.bowlRadiusY = 0.5;
      this.particles = [];
      this.grid = new Map();
    }

    clear() {
      this.particles.length = 0;
      this.grid.clear();
    }

    setGravity(value) {
      this.gravity = Math.max(0.2, Math.min(2.8, value));
    }

    setViscosity(value) {
      this.viscosity = Math.max(0, Math.min(0.22, value));
    }

    addParticle(x, y, vx = 0, vy = 0) {
      if (this.particles.length >= this.maxParticles) {
        return false;
      }
      this.particles.push({ x, y, px: x, py: y, vx, vy, contained: false });
      return true;
    }

    emitStream(count = 1, x = 0.5, y = 0.1) {
      let emitted = 0;
      const columns = Math.min(3, count);
      const spacing = this.particleRadius * 2.25;
      for (let index = 0; index < count; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const offsetX = (column - (columns - 1) * 0.5) * spacing;
        const jitter = (Math.random() - 0.5) * this.particleRadius * 0.18;
        if (this.addParticle(x + offsetX + jitter, y - row * spacing, 0, 0.06)) {
          emitted += 1;
        }
      }
      return emitted;
    }

    addImpulse(x, y, dx, dy, radius = 0.1) {
      const radiusSquared = radius * radius;
      for (const particle of this.particles) {
        const offsetX = particle.x - x;
        const offsetY = particle.y - y;
        const distanceSquared = offsetX * offsetX + offsetY * offsetY;
        if (distanceSquared >= radiusSquared) {
          continue;
        }
        const falloff = 1 - Math.sqrt(distanceSquared) / radius;
        particle.vx += dx * falloff;
        particle.vy += dy * falloff;
      }
    }

    step(dt) {
      if (this.particles.length === 0) {
        return;
      }

      for (const particle of this.particles) {
        particle.px = particle.x;
        particle.py = particle.y;
        particle.vy += this.gravity * dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        this.constrainParticle(particle);
      }

      for (let iteration = 0; iteration < this.constraintIterations; iteration += 1) {
        this.rebuildGrid();
        this.relaxDensity(dt);
        for (const particle of this.particles) {
          this.constrainParticle(particle);
        }
      }

      const inverseDt = 1 / Math.max(dt, 1e-6);
      for (const particle of this.particles) {
        particle.vx = (particle.x - particle.px) * inverseDt;
        particle.vy = (particle.y - particle.py) * inverseDt;
      }

      // Viscosity changes slowly relative to pressure. Solving it every other
      // tick preserves the damping while leaving more time for interaction.
      this.viscosityPhase += 1;
      if (this.viscosityPhase % 2 === 0) {
        this.applyViscosity(2);
      }
      this.particles = this.particles.filter((particle) => (
        Number.isFinite(particle.x)
        && Number.isFinite(particle.y)
        && particle.y < 1.2
      ));
    }

    rebuildGrid() {
      this.grid.clear();
      const size = this.interactionRadius;
      for (let index = 0; index < this.particles.length; index += 1) {
        const particle = this.particles[index];
        const cellX = Math.floor(particle.x / size);
        const cellY = Math.floor(particle.y / size);
        const key = `${cellX},${cellY}`;
        const bucket = this.grid.get(key);
        if (bucket) {
          bucket.push(index);
        } else {
          this.grid.set(key, [index]);
        }
      }
    }

    neighborIndices(particle) {
      const result = [];
      const size = this.interactionRadius;
      const cellX = Math.floor(particle.x / size);
      const cellY = Math.floor(particle.y / size);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const bucket = this.grid.get(`${cellX + offsetX},${cellY + offsetY}`);
          if (bucket) {
            result.push(...bucket);
          }
        }
      }
      return result;
    }

    relaxDensity(dt) {
      const radius = this.interactionRadius;
      const radiusSquared = radius * radius;

      for (let index = 0; index < this.particles.length; index += 1) {
        const particle = this.particles[index];
        const neighbors = [];
        let density = 0;
        let nearDensity = 0;

        for (const neighborIndex of this.neighborIndices(particle)) {
          if (neighborIndex === index) {
            continue;
          }
          const neighbor = this.particles[neighborIndex];
          const dx = neighbor.x - particle.x;
          const dy = neighbor.y - particle.y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared <= 1e-12 || distanceSquared >= radiusSquared) {
            continue;
          }
          const distance = Math.sqrt(distanceSquared);
          const q = 1 - distance / radius;
          density += q * q;
          nearDensity += q * q * q;
          neighbors.push({ neighbor, dx, dy, distance, q });
        }

        // Negative pressure makes sparse surface particles pull into beads. A
        // liquid pool should settle and spread instead, so pressure only
        // resists compression while near-pressure keeps particles separated.
        const pressure = this.stiffness * Math.max(0, density - this.restDensity);
        const nearPressure = this.nearStiffness * nearDensity;
        let displacementX = 0;
        let displacementY = 0;

        for (const entry of neighbors) {
          const magnitude = dt * dt * (
            pressure * entry.q
            + nearPressure * entry.q * entry.q
          ) * 0.5;
          const directionX = entry.dx / entry.distance;
          const directionY = entry.dy / entry.distance;
          const moveX = directionX * magnitude;
          const moveY = directionY * magnitude;
          entry.neighbor.x += moveX;
          entry.neighbor.y += moveY;
          displacementX -= moveX;
          displacementY -= moveY;
        }

        particle.x += displacementX;
        particle.y += displacementY;
      }
    }

    applyViscosity(strengthMultiplier = 1) {
      this.rebuildGrid();
      const radius = this.interactionRadius;
      const radiusSquared = radius * radius;
      const deltaX = new Float32Array(this.particles.length);
      const deltaY = new Float32Array(this.particles.length);

      for (let index = 0; index < this.particles.length; index += 1) {
        const particle = this.particles[index];
        for (const neighborIndex of this.neighborIndices(particle)) {
          if (neighborIndex <= index) {
            continue;
          }
          const neighbor = this.particles[neighborIndex];
          const dx = neighbor.x - particle.x;
          const dy = neighbor.y - particle.y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= radiusSquared) {
            continue;
          }
          const q = 1 - Math.sqrt(Math.max(distanceSquared, 0)) / radius;
          const blend = Math.min(0.24, this.viscosity * strengthMultiplier * q * 0.5);
          const velocityX = (neighbor.vx - particle.vx) * blend;
          const velocityY = (neighbor.vy - particle.vy) * blend;
          deltaX[index] += velocityX;
          deltaY[index] += velocityY;
          deltaX[neighborIndex] -= velocityX;
          deltaY[neighborIndex] -= velocityY;
        }
      }

      for (let index = 0; index < this.particles.length; index += 1) {
        this.particles[index].vx += deltaX[index];
        this.particles[index].vy += deltaY[index];
      }
    }

    constrainParticle(particle) {
      const radius = this.particleRadius;
      if (particle.y < this.rimY) {
        // Crossing above the rim releases a particle from the bowl. It can
        // then travel over either side and fall out of the viewport.
        particle.contained = false;
        return;
      }

      const effectiveRadiusX = this.bowlRadiusX - radius;
      const effectiveRadiusY = this.bowlRadiusY - radius;
      const offsetX = particle.x - this.bowlCenterX;
      const offsetY = particle.y - this.rimY;
      const normalized = (
        (offsetX * offsetX) / (effectiveRadiusX * effectiveRadiusX)
        + (offsetY * offsetY) / (effectiveRadiusY * effectiveRadiusY)
      );

      if (normalized <= 1) {
        particle.contained = true;
        return;
      }

      // Particles already outside the bowl should not collide with its inner
      // surface. This is what lets overflow continue downward instead of
      // being pulled back into the container.
      if (!particle.contained) {
        return;
      }

      const scale = 1 / Math.sqrt(normalized);
      const boundaryX = this.bowlCenterX + offsetX * scale;
      const boundaryY = this.rimY + offsetY * scale;
      const normalXRaw = (boundaryX - this.bowlCenterX) / (effectiveRadiusX * effectiveRadiusX);
      const normalYRaw = (boundaryY - this.rimY) / (effectiveRadiusY * effectiveRadiusY);
      const normalLength = Math.hypot(normalXRaw, normalYRaw) || 1;
      particle.x = boundaryX - (normalXRaw / normalLength) * 0.0005;
      particle.y = boundaryY - (normalYRaw / normalLength) * 0.0005;
    }
  }

  return PbdLiquid;
});
