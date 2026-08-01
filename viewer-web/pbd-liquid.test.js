"use strict";

const assert = require("node:assert/strict");
const PbdLiquid = require("./pbd-liquid.js");

const liquid = new PbdLiquid({ maxParticles: 300, constraintIterations: 3 });
for (let index = 0; index < 180; index += 1) {
  const column = index % 15;
  const row = Math.floor(index / 15);
  liquid.addParticle(
    0.36 + column * 0.02,
    0.59 + row * 0.02,
    0,
    0
  );
}

const initialCount = liquid.particles.length;
for (let step = 0; step < 720; step += 1) {
  liquid.step(1 / 120);
}

assert.equal(liquid.particles.length, initialCount, "Particle volume should be conserved.");
assert.ok(liquid.particles.every((particle) => Number.isFinite(particle.x) && Number.isFinite(particle.y)), "Particle state must remain finite.");
assert.ok(liquid.particles.every((particle) => particle.y >= liquid.rimY), "Particles should settle inside the bowl.");
assert.ok(liquid.particles.every((particle) => {
  const x = (particle.x - liquid.bowlCenterX) / liquid.bowlRadiusX;
  const y = (particle.y - liquid.rimY) / liquid.bowlRadiusY;
  return x * x + y * y <= 1.02;
}), "Settled particles must remain inside the bowl boundary.");

liquid.clear();
assert.equal(liquid.particles.length, 0, "Clear should remove all particles.");

const overflow = new PbdLiquid({ maxParticles: 20 });
overflow.addParticle(0.98, 0.2, 0, 0.1);
let crossedScreenEdge = false;
for (let step = 0; step < 600; step += 1) {
  overflow.step(1 / 120);
  crossedScreenEdge ||= overflow.particles.some((particle) => particle.x > 0.96);
}
assert.ok(crossedScreenEdge, "Particles outside the rim should remain outside the bowl.");
assert.equal(overflow.particles.length, 0, "Overflow should fall below the viewport and be discarded.");

const spill = new PbdLiquid({ maxParticles: 5 });
spill.addParticle(0.08, 0.435);
spill.step(1 / 120);
spill.particles[0].vx = -0.8;
spill.particles[0].vy = -0.8;
let crossedRim = false;
for (let step = 0; step < 600; step += 1) {
  spill.step(1 / 120);
  crossedRim ||= spill.particles.some((particle) => particle.x < 0);
}
assert.ok(crossedRim, "Liquid pushed over the rim should cross the screen edge.");
assert.equal(spill.particles.length, 0, "Spilled liquid should fall off screen.");

const gentlePour = new PbdLiquid({ maxParticles: 20 });
gentlePour.emitStream(12, 0.25, 0.3);
assert.equal(gentlePour.particles.length, 12, "A cursor pour should emit the requested volume.");
assert.ok(gentlePour.particles.every((particle) => particle.vx === 0 && particle.vy <= 0.06), "A pour should start gently.");
for (let step = 0; step < 150; step += 1) {
  gentlePour.step(1 / 75);
}
assert.equal(gentlePour.particles.length, 12, "A gentle pour into the bowl should retain its volume.");
assert.ok(Math.max(...gentlePour.particles.map((particle) => Math.hypot(particle.vx, particle.vy))) < 0.5, "A pour should settle without a pressure explosion.");

console.log("PBD liquid tests passed.");
