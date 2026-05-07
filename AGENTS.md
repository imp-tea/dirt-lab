# Project Notes

This is a Vite + TypeScript web app for experimenting with a grid-based falling dirt cellular automata simulation. Rendering is Canvas 2D in `src/main.ts`; there is no frontend framework beyond Vite.

## Current Model

The grid is `180 x 110`. Particles are stored in typed arrays, and `grid` stores particle ids. Particle kinds are empty, loose dirt, and packed dirt.

Loose dirt:

- Gravity adds integer vertical velocity.
- Movement is axis-based and path-sampled through the grid.
- Slow downward support contacts absorb vertical velocity.
- Higher-speed collisions use simple mass-aware momentum exchange.
- Resting particles try diagonal fall before packing.
- Loose dirt packs after `PACK_AFTER_REST_TICKS`, or immediately when resting on a stable packed column.

Packed dirt:

- Packed dirt is static until broken loose.
- Packed dirt disconnected from the bottom-grounded packed mass becomes loose.
- Side/top wall contact does not count as grounded.
- Direct packed columns to the bottom are protected from impact-loosening.

## Contact-Force Fracture Model

`master` uses the contact-force fracture model. Stress fractures are toggleable in the UI.

Each stress pass:

1. Reset cached force fields.
2. Give each packed particle downward weight from mass.
3. Iteratively solve 4-neighbor contact forces.
4. Packed neighbors can apply capped cohesive glue forces.
5. Neighbors below, plus simulation boundaries, can apply uncapped normal forces.
6. Boundaries do not apply cohesive glue.
7. Glue relaxation alternates spatial sweep directions to avoid left/right bias.
8. Vertical supports seed a connected support-path crawl through packed particles.
9. Non-vertical-support packed particles add cantilever load along their nearest path to vertical support.
10. Packed particles break loose when unresolved net force or cantilever load exceeds strength-scaled tolerance.

Useful arrays/fields include `strength`, `residualForceX`, `residualForceY`, `glueLoad`, `normalLoad`, `cantileverLoad`, `carriedLoad`, `stress`, `verticalSupport`, `supportDistance`, `stressLineNext`, and `grounded`.

Current tuning values near the top of `src/main.ts`:

- `DEFAULT_PACKED_STRENGTH = 4000`
- `maxStressFractureRepasses = 5`
- `stressIntervalTicks = 1`
- `verticalSupportPackedBelow = 0`
- `contactSolverIterations = 18`
- `contactForceEpsilon = 2.95`
- `CONTACT_GRAVITY_FORCE = 4`
- `CONTACT_GLUE_STRENGTH_SCALE = 1`
- `CONTACT_RESIDUAL_STRENGTH_SCALE = 0.02`
- `CONTACT_CANTILEVER_STRENGTH_SCALE = 0.22`
- `CONTACT_CANTILEVER_LOAD_SCALE = 1.8`
- `CONTACT_BREAK_VELOCITY_SCALE = 0.22`
- `CONTACT_MAX_BREAK_SPEED = 5`

## UI

The app has brush tools, brush size, simulation speed, strength with an Apply button, fracture tuning sliders, pause/step/clear, inspector, stress fracture toggle, and packed contour toggle.

The inspector shows force/debug fields for the hovered particle, including net force, net tolerance, normal load, glue used, cantilever load, contact stress, support state, and grounded state. The inspector panel has fixed height and scrolls internally.

## Development Notes

- Keep changes scoped to `src/main.ts` unless adding UI styling in `src/style.css`.
- Run `npm.cmd run build` before handing off.
- The dev server is usually at `http://127.0.0.1:5173`.
- `dist/` and `node_modules/` are ignored.
