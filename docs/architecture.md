# Architecture

## Product direction

The browser is the primary runtime and rendering surface. Physics stepping and rendering run on the client. The interface supports mouse, pen, and touch input.

## Browser-first platform split

- `viewer-web/` owns the live product: interaction, simulation stepping, WebGL2 compute passes, and rendering.
- `sim-core/` is the native reference model for deterministic tank-fill behavior, replay serialization, and mass-accounting tests.
- `tests/` and `benchmarks/` provide validation paths without dictating the user experience.
- `viewer-native/` is an optional engineering surface rather than the product front door.
- `prototypes/` preserves earlier studies and reference captures.

## Web simulation pipeline

Each visual frame adds elapsed time to a small accumulator. The solver advances at a fixed 1/60 second timestep and limits catch-up work to three steps, preventing background tabs or dropped frames from creating unstable jumps.

Each solver step runs entirely on the GPU:

1. Advect velocity.
2. Apply gravity and material relaxation where appropriate.
3. Apply boundary containment.
4. Compute curl and add vorticity confinement.
5. Compute divergence.
6. Solve pressure with Jacobi iterations.
7. Subtract the pressure gradient to restore an approximately divergence-free velocity field.
8. Advect and relax the visible dye field.

Pointer input injects momentum and dye into the same field textures. Rendering then shades the dye using local density, gradients, and velocity without transferring the simulation state back to the CPU.

Input is tracked per Pointer Events `pointerId`, allowing simultaneous mouse, pen, and multi-touch contacts. Each active contact owns its position and motion history; cancellation, capture loss, tab hiding, and window blur clean up only the affected or inactive contacts.

Mode switches and viewport resizes preserve the current field; only the Clear control rebuilds it.

## Particle liquid scenario

`viewer-web/liquid.html` uses a separate position-based particle engine. It integrates gravity, resolves particle density constraints through a spatial hash, applies viscosity, and projects contained particles against an open elliptical bowl. Pointer clicks emit a gently spaced pour at the cursor. Particles pushed above the rim leave the container state, cross the viewport freely, and are retired only after falling below the screen. Each emitted particle represents liquid volume, so filling and spilling emerge from particle motion rather than a dye mask or rendered height estimate.

## Accuracy boundary

The live viewer is a stable, incompressible 2D flow approximation designed for interaction. It does not claim to be a dimensioned engineering CFD package. The native core remains the place for deterministic mass-ledger experiments and replay validation. Keeping that boundary explicit lets the browser product be playful without making false precision claims.
