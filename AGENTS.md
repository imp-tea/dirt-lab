# Project Notes

This project is a Vite + TypeScript web app for experimenting with a grid-based falling dirt cellular automata simulation. Rendering is done with Canvas 2D in `src/main.ts`; there is no framework beyond Vite.

## Commands

- Install dependencies: `npm.cmd install`
- Start dev server: `npm.cmd run dev -- --host 127.0.0.1 --port 5173`
- Build/check: `npm.cmd run build`

Use `npm.cmd` on Windows because PowerShell may block `npm.ps1`.

## Git Branches

- `master`: current main version with the stress-line overhang fracture model.
- `stress-diffusion-experiment`: alternate experiment where packed dirt has diffused `support` and `stress` fields.
- `stress-line-experiment`: experiment branch that introduced the current stress-line model, now fast-forwarded into `master`.

Useful commits:

- `908a55d`: initial falling dirt simulation baseline.
- `9dfa6e5`: tuned local packed dirt stress model on `master`.
- `fc33401`: stress-line overhang fracture model, strength slider, and stable inspector layout.
- `aa29761`: first diffused stress/support experiment.
- `146eddd`: tuned diffused support propagation.

## Current Simulation Model On `master`

The grid is `180 x 110`. Particles are stored in typed arrays, with the grid storing particle ids. Particle data includes:

- `kind`: empty, loose dirt, packed dirt
- `x`, `y`, `prevX`, `prevY`
- `vx`, `vy`
- `mass`, `stickiness`
- packed dirt stress properties: `strength`, `verticalSupport`, `supportDistance`, `stressLineNext`, `carriedLoad`, `stress`

Loose dirt:

- Gravity adds integer vertical velocity.
- Movement is axis-based, path-sampled along the grid.
- Downward support contacts with speed 1 absorb vertical velocity instead of bouncing.
- Higher-speed collisions use simple mass-aware momentum exchange.
- Horizontal collisions reduce both particles' horizontal velocity toward zero.
- Resting particles try diagonal fall into lower-left/lower-right, not flat sideways sliding.
- Loose dirt converts to packed dirt after `PACK_AFTER_REST_TICKS`.
- If loose dirt lands on packed dirt with a direct packed vertical column to the bottom, and cannot fall diagonally, it immediately packs.

Packed dirt:

- Packed dirt is static unless broken loose.
- Packed dirt disconnected from the bottom-grounded packed mass becomes loose.
- Packed dirt in direct vertical columns to the screen bottom is protected from impact-loosening.

## Current Stress Model On `master`

Stress fractures are toggleable in the UI.

Current tuning constants near the top of `src/main.ts`:

- `DEFAULT_PACKED_STRENGTH = 400`
- `STRESS_LINE_LOAD_MULTIPLIER = 0.8`
- `STRESS_LINE_CARRIED_LOAD_FACTOR = 0.08`
- `STRESS_LINE_DISTANCE_MULTIPLIER = 0.28`
- `STRESS_LINE_DISTANCE_EXPONENT = 1.2`
- `STRESS_LINE_SUPPORT_BIAS = 0.65`
- `STRESS_LINE_MAX_PATH_STEPS = GRID_WIDTH + GRID_HEIGHT`
- `MAX_STRESS_FRACTURE_REPASSES = 3`
- `STRESS_INTERVAL_TICKS = 4`

Every stress pass:

1. Reset cached stress fields.
2. Mark `verticalSupport` particles that have a direct vertical packed-dirt column to the screen bottom.
3. Run a multi-source BFS outward from all vertical supports through packed neighbors.
4. Cache each overhang particle's `supportDistance` and `stressLineNext` pointer toward the nearest vertical support.
5. Compute `carriedLoad` from vertical column mass, but only a small fraction of extra carried load contributes to stress through `STRESS_LINE_CARRIED_LOAD_FACTOR`.
6. Each overhang deposits stress along its cached stress line. Longer paths increase total stress, and `STRESS_LINE_SUPPORT_BIAS` weights stress higher near the support end.
7. If `stress > strength`, packed dirt converts to loose dirt. Fractures trigger immediate stress-line recalculation for up to `MAX_STRESS_FRACTURE_REPASSES` follow-up passes.

Inspector shows useful fields for the hovered particle, including velocity, mass, strength, carried load, stress load, stress, stress-line distance, next support step, vertical-support state, empty-below state, and grounded state.

## UI

The app has:

- Brush tools: loose dirt, packed dirt, erase
- Brush size
- Simulation speed
- Global damping
- Global packed-particle strength slider
- Pause, step, clear
- Inspector toggle
- Stress fractures toggle

The inspector output panel has a fixed height and scrolls internally so hovering over particles does not resize the sidebar or shift the canvas.

## Development Notes

- Keep changes scoped to `src/main.ts` unless adding UI styling in `src/style.css`.
- Run `npm.cmd run build` before handing off.
- The dev server is usually at `http://127.0.0.1:5173`.
- `dist/` and `node_modules/` are ignored.
