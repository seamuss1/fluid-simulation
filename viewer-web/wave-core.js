/*
 * A small, dependency-free height-field solver for the Ripple Tank scene.
 *
 * The field stores height and vertical velocity per cell. It uses a damped
 * finite-difference form of the 2D wave equation. Solid cells sample their
 * own height at a boundary, producing a no-flux edge: waves reflect rather
 * than passing through an obstacle.
 */
(function attachWaveTank(global) {
  "use strict";

  const MAX_HEIGHT = 8;
  const MAX_VELOCITY = 8;

  class WaveTank {
    constructor({ columns = 180, rows = 112 } = {}) {
      this.resize(columns, rows);
    }

    resize(columns, rows) {
      this.columns = Math.max(3, Math.floor(columns));
      this.rows = Math.max(3, Math.floor(rows));
      const length = this.columns * this.rows;
      this.height = new Float32Array(length);
      this.velocity = new Float32Array(length);
      this.nextHeight = new Float32Array(length);
      this.nextVelocity = new Float32Array(length);
      this.solid = new Uint8Array(length);
    }

    index(x, y) {
      return y * this.columns + x;
    }

    clear() {
      this.height.fill(0);
      this.velocity.fill(0);
      this.nextHeight.fill(0);
      this.nextVelocity.fill(0);
    }

    setSolidMask(mask) {
      if (!mask || mask.length !== this.solid.length) {
        throw new Error("WaveTank solid mask must match the current field size.");
      }
      this.solid.set(mask);
      this.clear();
    }

    rasterizeSolids(isSolid) {
      if (typeof isSolid !== "function") {
        throw new Error("WaveTank.rasterizeSolids expects a predicate function.");
      }
      const aspect = this.columns / this.rows;
      for (let y = 0; y < this.rows; y += 1) {
        for (let x = 0; x < this.columns; x += 1) {
          const index = this.index(x, y);
          this.solid[index] = isSolid((x + 0.5) / this.columns, (y + 0.5) / this.rows, aspect) ? 1 : 0;
        }
      }
      this.clear();
    }

    impact(u, v, amplitude = 1, radius = 0.03) {
      const aspect = this.columns / this.rows;
      const safeRadius = Math.max(0.004, radius);
      const radiusSquared = safeRadius * safeRadius;
      const reach = safeRadius * 3.4;
      const minX = Math.max(0, Math.floor((u - reach / aspect) * this.columns));
      const maxX = Math.min(this.columns - 1, Math.ceil((u + reach / aspect) * this.columns));
      const minY = Math.max(0, Math.floor((v - reach) * this.rows));
      const maxY = Math.min(this.rows - 1, Math.ceil((v + reach) * this.rows));

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const index = this.index(x, y);
          if (this.solid[index]) continue;
          const dx = ((x + 0.5) / this.columns - u) * aspect;
          const dy = (y + 0.5) / this.rows - v;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared > reach * reach) continue;
          const normalizedDistance = distanceSquared / radiusSquared;
          const gaussian = Math.exp(-normalizedDistance / 0.68);
          // A tap displaces a small crest and a surrounding trough. The
          // near-zero integral avoids raising the entire tank's water level
          // while producing a clean, outward-moving ripple.
          const pulse = gaussian * (1 - normalizedDistance / 0.68);
          this.velocity[index] = clamp(this.velocity[index] + amplitude * pulse, -MAX_VELOCITY, MAX_VELOCITY);
        }
      }
    }

    step(propagation = 0.23, damping = 0.994) {
      // The upper bound keeps the explicit solver inside its CFL stability
      // region. A slider changes this value but cannot create an exploding
      // surface on a slower device.
      const safePropagation = clamp(propagation, 0.02, 0.31);
      const safeDamping = clamp(damping, 0.9, 0.9999);

      for (let y = 0; y < this.rows; y += 1) {
        for (let x = 0; x < this.columns; x += 1) {
          const index = this.index(x, y);
          if (this.solid[index]) {
            this.nextVelocity[index] = 0;
            this.nextHeight[index] = 0;
            continue;
          }

          const center = this.height[index];
          const left = this.sampleHeight(x - 1, y, center);
          const right = this.sampleHeight(x + 1, y, center);
          const top = this.sampleHeight(x, y - 1, center);
          const bottom = this.sampleHeight(x, y + 1, center);
          const laplacian = left + right + top + bottom - 4 * center;
          const velocity = clamp(
            (this.velocity[index] + laplacian * safePropagation) * safeDamping,
            -MAX_VELOCITY,
            MAX_VELOCITY,
          );
          this.nextVelocity[index] = velocity;
          this.nextHeight[index] = clamp(center + velocity, -MAX_HEIGHT, MAX_HEIGHT);
        }
      }

      const oldHeight = this.height;
      this.height = this.nextHeight;
      this.nextHeight = oldHeight;
      const oldVelocity = this.velocity;
      this.velocity = this.nextVelocity;
      this.nextVelocity = oldVelocity;
    }

    energy(xStart = 0, xEnd = this.columns, yStart = 0, yEnd = this.rows) {
      let total = 0;
      for (let y = Math.max(0, yStart); y < Math.min(this.rows, yEnd); y += 1) {
        for (let x = Math.max(0, xStart); x < Math.min(this.columns, xEnd); x += 1) {
          const index = this.index(x, y);
          if (this.solid[index]) continue;
          total += Math.abs(this.height[index]) + Math.abs(this.velocity[index]) * 0.3;
        }
      }
      return total;
    }

    sampleHeight(x, y, fallback) {
      if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return fallback;
      const index = this.index(x, y);
      return this.solid[index] ? fallback : this.height[index];
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  const api = { WaveTank, clamp };
  global.WaveTankCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window === "undefined" ? globalThis : window);
