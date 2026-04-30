# Architecture

## Goal

Reorient the repository around a native 3D tank-fill solver instead of continuing to extend browser-only prototypes.

## Platform Split

- `sim-core/` owns the authoritative simulation state, deterministic stepping, replay data, and mass accounting.
- `viewer-native/` is the first visible benchmark surface and is intended to host the tank-fill rendering path.
- `viewer-web/` is reserved for replay and inspection after the native core is stable.
- `prototypes/` keeps earlier experiments runnable without pretending they are the platform architecture.

## Current Native Milestone

The native scaffold currently lands these baseline capabilities:

- fixed-timestep tank-fill stepping
- deterministic seeded emission
- mass-ledger counters for emitted, active, in-fluid, escaped, and discarded mass
- replay-frame generation with a surface-height field plus spray particles
- benchmark CSV export and test coverage
- standalone offline replay HTML with progressive WebGL2 rendering

The long-term target remains a Vulkan-backed FLIP-style particle-grid solver with particle splats and thickness/normal rendering passes.
