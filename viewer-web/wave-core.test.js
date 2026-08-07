"use strict";

const assert = require("node:assert/strict");
const { WaveTank } = require("./wave-core.js");

function advance(tank, count, propagation = 0.23, damping = 0.995) {
  for (let step = 0; step < count; step += 1) tank.step(propagation, damping);
}

// The equation is linear away from the safety clamps: simultaneous impacts
// should equal the sum of the two independently propagated fields. That is the
// physically useful source of constructive and destructive interference.
const leftWave = new WaveTank({ columns: 96, rows: 64 });
const rightWave = new WaveTank({ columns: 96, rows: 64 });
const combinedWave = new WaveTank({ columns: 96, rows: 64 });
leftWave.impact(0.3, 0.45, 0.32, 0.035);
rightWave.impact(0.66, 0.57, -0.27, 0.031);
combinedWave.impact(0.3, 0.45, 0.32, 0.035);
combinedWave.impact(0.66, 0.57, -0.27, 0.031);
advance(leftWave, 55);
advance(rightWave, 55);
advance(combinedWave, 55);
let maximumSuperpositionError = 0;
for (let index = 0; index < combinedWave.height.length; index += 1) {
  maximumSuperpositionError = Math.max(
    maximumSuperpositionError,
    Math.abs(combinedWave.height[index] - leftWave.height[index] - rightWave.height[index]),
  );
}
assert.ok(maximumSuperpositionError < 0.00001, `Wave interference should superpose (error ${maximumSuperpositionError}).`);

// A full-height solid breakwater forms a no-flux boundary. Its far side should
// not receive a travelling wave, while a clear tank with the same impact does.
const barrier = new WaveTank({ columns: 160, rows: 80 });
barrier.rasterizeSolids((u) => u > 0.495 && u < 0.505);
barrier.impact(0.28, 0.5, 0.8, 0.035);
advance(barrier, 180);
const blockedEnergy = barrier.energy(96, barrier.columns);

const openWater = new WaveTank({ columns: 160, rows: 80 });
openWater.impact(0.28, 0.5, 0.8, 0.035);
advance(openWater, 180);
const transmittedEnergy = openWater.energy(96, openWater.columns);
assert.ok(transmittedEnergy > 0.02, "A travelling ripple should reach the far side in open water.");
assert.ok(blockedEnergy < transmittedEnergy * 0.001, "Solid obstacles should block propagation instead of leaking waves through.");

// Damping must settle a surface without producing non-finite values.
const settling = new WaveTank({ columns: 120, rows: 72 });
settling.impact(0.5, 0.5, 1.2, 0.045);
advance(settling, 80, 0.24, 0.991);
const activeEnergy = settling.energy();
advance(settling, 820, 0.24, 0.991);
assert.ok(settling.energy() < activeEnergy * 0.08, "Damped ripples should dissipate over time.");
assert.ok(settling.height.every(Number.isFinite) && settling.velocity.every(Number.isFinite), "Wave state must remain finite.");

console.log("Wave tank tests passed.");
