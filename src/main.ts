import './style.css'
import { Body, Box, Chain, Circle, Vec2, WheelJoint, World } from 'planck'

const GRID_WIDTH = 180
const GRID_HEIGHT = 110
const CELL_SIZE = 5
const MAX_PARTICLES = GRID_WIDTH * GRID_HEIGHT
const EMPTY = 0
const LOOSE_DIRT = 1
const PACKED_DIRT = 2
const MAX_SPEED = 8
const GRAVITY = 1
const DEFAULT_TICKS_PER_SECOND = 28
const DEFAULT_DAMPING = 0
const PACK_AFTER_REST_TICKS = 5
const DEFAULT_PACKED_STRENGTH = 400
const STRESS_LINE_LOAD_MULTIPLIER = 0.8
const STRESS_LINE_CARRIED_LOAD_FACTOR = 0.08
const STRESS_LINE_DISTANCE_MULTIPLIER = 0.28
const STRESS_LINE_DISTANCE_EXPONENT = 1.2
const STRESS_LINE_SUPPORT_BIAS = 0.65
const STRESS_LINE_MAX_PATH_STEPS = GRID_WIDTH + GRID_HEIGHT
const MAX_STRESS_FRACTURE_REPASSES = 3
const UNSUPPORTED_DISTANCE = 65535
const STRESS_INTERVAL_TICKS = 4
const POLYGON_REBUILD_INTERVAL_TICKS = 6
const CONTOUR_REBUILD_INTERVAL_TICKS = 6
const CONTOUR_SIMPLIFY_EPSILON = 0.65
const CONTOUR_SMOOTHING_PASSES = 2
const CONTOUR_NOISE_NEIGHBOR_THRESHOLD = 3
const PHYSICS_STEP_SECONDS = 1 / 60
const VEHICLE_START_COL = 64
const VEHICLE_START_ROW = 70
const VEHICLE_MOTOR_SPEED = 18
const VEHICLE_MOTOR_TORQUE = 850

type Tool = 'loose' | 'packed' | 'erase'
type Point = { x: number; y: number }
type PackedPolygon = Point[]
type PackedContour = Point[]
type ContourSegment = { start: Point; end: Point }

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root element')
}

app.innerHTML = `
  <main class="shell">
    <section class="sim-area" aria-label="Falling dirt simulation">
      <canvas id="world" width="${GRID_WIDTH * CELL_SIZE}" height="${GRID_HEIGHT * CELL_SIZE}"></canvas>
    </section>

    <aside class="panel" aria-label="Simulation controls">
      <div class="panel-header">
        <h1>Dirt Lab</h1>
        <div class="status">
          <span id="fps">0 fps</span>
          <span id="count">0 grains</span>
        </div>
      </div>

      <div class="control-group" aria-label="Brush tools">
        <label>Tool</label>
        <div class="segmented">
          <button class="tool-button active" data-tool="loose" type="button" title="Loose dirt">Loose</button>
          <button class="tool-button" data-tool="packed" type="button" title="Packed dirt">Packed</button>
          <button class="tool-button" data-tool="erase" type="button" title="Erase">Erase</button>
        </div>
      </div>

      <div class="control-group">
        <label for="brush">Brush</label>
        <input id="brush" type="range" min="1" max="12" value="5" />
      </div>

      <div class="control-group">
        <div class="label-row">
          <label for="speed">Speed</label>
          <span id="speed-value">28 ticks/s</span>
        </div>
        <input id="speed" type="range" min="1" max="120" value="${DEFAULT_TICKS_PER_SECOND}" />
      </div>

      <div class="control-group">
        <div class="label-row">
          <label for="damping">Damping</label>
          <span id="damping-value">0%</span>
        </div>
        <input id="damping" type="range" min="0" max="60" value="${DEFAULT_DAMPING}" />
      </div>

      <div class="control-group">
        <div class="label-row">
          <label for="strength">Strength</label>
          <span id="strength-value">${DEFAULT_PACKED_STRENGTH}</span>
        </div>
        <input id="strength" type="range" min="20" max="500" step="10" value="${DEFAULT_PACKED_STRENGTH}" />
      </div>

      <div class="button-row">
        <button id="pause" type="button" title="Pause or resume">Pause</button>
        <button id="step" type="button" title="Run one tick">Step</button>
        <button id="clear" type="button" title="Clear all particles">Clear</button>
      </div>

      <label class="toggle-row" for="debug-inspector">
        <span>Inspector</span>
        <input id="debug-inspector" type="checkbox" />
      </label>

      <label class="toggle-row" for="stress-fractures">
        <span>Stress fractures</span>
        <input id="stress-fractures" type="checkbox" checked />
      </label>

      <label class="toggle-row" for="packed-polygons">
        <span>Packed polygons</span>
        <input id="packed-polygons" type="checkbox" />
      </label>

      <label class="toggle-row" for="packed-contours">
        <span>Packed contours</span>
        <input id="packed-contours" type="checkbox" />
      </label>

      <pre id="inspector" class="inspector" aria-live="polite">Inspector off</pre>

      <div class="legend" aria-label="Materials">
        <div><span class="swatch loose"></span>Loose dirt</div>
        <div><span class="swatch packed"></span>Packed dirt</div>
      </div>
    </aside>
  </main>
`

const canvas = document.querySelector<HTMLCanvasElement>('#world')!
const ctx = canvas.getContext('2d', { alpha: false })!
const fpsEl = document.querySelector<HTMLSpanElement>('#fps')!
const countEl = document.querySelector<HTMLSpanElement>('#count')!
const brushInput = document.querySelector<HTMLInputElement>('#brush')!
const speedInput = document.querySelector<HTMLInputElement>('#speed')!
const dampingInput = document.querySelector<HTMLInputElement>('#damping')!
const strengthInput = document.querySelector<HTMLInputElement>('#strength')!
const speedValueEl = document.querySelector<HTMLSpanElement>('#speed-value')!
const dampingValueEl = document.querySelector<HTMLSpanElement>('#damping-value')!
const strengthValueEl = document.querySelector<HTMLSpanElement>('#strength-value')!
const debugInput = document.querySelector<HTMLInputElement>('#debug-inspector')!
const stressInput = document.querySelector<HTMLInputElement>('#stress-fractures')!
const polygonInput = document.querySelector<HTMLInputElement>('#packed-polygons')!
const contourInput = document.querySelector<HTMLInputElement>('#packed-contours')!
const inspectorEl = document.querySelector<HTMLPreElement>('#inspector')!
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!
const stepButton = document.querySelector<HTMLButtonElement>('#step')!
const clearButton = document.querySelector<HTMLButtonElement>('#clear')!
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tool-button'))

const grid = new Int32Array(MAX_PARTICLES)
const kind = new Uint8Array(MAX_PARTICLES + 1)
const x = new Int16Array(MAX_PARTICLES + 1)
const y = new Int16Array(MAX_PARTICLES + 1)
const prevX = new Int16Array(MAX_PARTICLES + 1)
const prevY = new Int16Array(MAX_PARTICLES + 1)
const vx = new Int16Array(MAX_PARTICLES + 1)
const vy = new Int16Array(MAX_PARTICLES + 1)
const mass = new Uint8Array(MAX_PARTICLES + 1)
const stickiness = new Uint8Array(MAX_PARTICLES + 1)
const strength = new Uint16Array(MAX_PARTICLES + 1)
const restTicks = new Uint16Array(MAX_PARTICLES + 1)
const touched = new Uint32Array(MAX_PARTICLES + 1)
const grounded = new Uint8Array(MAX_PARTICLES + 1)
const verticalSupport = new Uint8Array(MAX_PARTICLES + 1)
const supportDistance = new Uint16Array(MAX_PARTICLES + 1)
const stressLineNext = new Int32Array(MAX_PARTICLES + 1)
const carriedLoad = new Float32Array(MAX_PARTICLES + 1)
const stress = new Float32Array(MAX_PARTICLES + 1)
const polygonVisited = new Uint8Array(MAX_PARTICLES)
const activeIds: number[] = []
const freeIds: number[] = []

let nextId = 1
let tick = 1
let selectedTool: Tool = 'loose'
let brushRadius = Number(brushInput.value)
let ticksPerSecond = Number(speedInput.value)
let globalDamping = Number(dampingInput.value) / 100
let packedStrength = Number(strengthInput.value)
let isPainting = false
let isPaused = false
let isInspectorEnabled = false
let isStressEnabled = true
let isPolygonDebugEnabled = false
let isContourDebugEnabled = false
let isDrivingLeft = false
let isDrivingRight = false
let hoverCol = -1
let hoverRow = -1
let lastFrame = performance.now()
let fps = 0
let simAccumulator = 0
let physicsAccumulator = 0
let packedPolygonCacheTick = -POLYGON_REBUILD_INTERVAL_TICKS
let isPackedPolygonCacheDirty = true
let packedPolygons: PackedPolygon[] = []
let packedContourCacheTick = -CONTOUR_REBUILD_INTERVAL_TICKS
let isPackedContourCacheDirty = true
let packedContours: PackedContour[] = []
let physicsTerrainBody: Body | null = null
let physicsChassisBody: Body | null = null
let physicsLeftWheelBody: Body | null = null
let physicsRightWheelBody: Body | null = null
let physicsLeftWheelJoint: WheelJoint | null = null
let physicsRightWheelJoint: WheelJoint | null = null

const physicsWorld = new World({
  gravity: Vec2(0, 32),
})

supportDistance.fill(UNSUPPORTED_DISTANCE)

for (let row = GRID_HEIGHT - 10; row < GRID_HEIGHT; row += 1) {
  for (let col = 0; col < GRID_WIDTH; col += 1) {
    if (Math.random() > 0.04) addParticle(col, row, PACKED_DIRT)
  }
}

for (let row = GRID_HEIGHT - 18; row < GRID_HEIGHT - 10; row += 1) {
  const edge = Math.abs(row - (GRID_HEIGHT - 14))
  for (let col = 35 + edge * 3; col < 92 - edge * 2; col += 1) {
    if (Math.random() > 0.15) addParticle(col, row, PACKED_DIRT)
  }
}

function indexAt(col: number, row: number) {
  return row * GRID_WIDTH + col
}

function inBounds(col: number, row: number) {
  return col >= 0 && col < GRID_WIDTH && row >= 0 && row < GRID_HEIGHT
}

function cellId(col: number, row: number) {
  if (!inBounds(col, row)) return -1
  return grid[indexAt(col, row)]
}

function addParticle(col: number, row: number, particleKind: number) {
  if (!inBounds(col, row) || grid[indexAt(col, row)] !== EMPTY) return 0

  const id = freeIds.pop() ?? nextId++
  kind[id] = particleKind
  x[id] = col
  y[id] = row
  prevX[id] = col
  prevY[id] = row
  vx[id] = 0
  vy[id] = 0
  mass[id] = particleKind === PACKED_DIRT ? 3 : 1
  stickiness[id] = particleKind === PACKED_DIRT ? 2 : 1
  strength[id] = particleKind === PACKED_DIRT ? packedStrength : 0
  restTicks[id] = 0
  touched[id] = 0
  grounded[id] = 0
  verticalSupport[id] = 0
  supportDistance[id] = UNSUPPORTED_DISTANCE
  stressLineNext[id] = 0
  carriedLoad[id] = 0
  stress[id] = 0
  grid[indexAt(col, row)] = id
  activeIds.push(id)
  if (particleKind === PACKED_DIRT) {
    isPackedPolygonCacheDirty = true
    isPackedContourCacheDirty = true
  }
  return id
}

function removeParticle(id: number) {
  if (id <= 0 || kind[id] === EMPTY) return
  grid[indexAt(x[id], y[id])] = EMPTY
  kind[id] = EMPTY
  vx[id] = 0
  vy[id] = 0
  strength[id] = 0
  restTicks[id] = 0
  verticalSupport[id] = 0
  supportDistance[id] = UNSUPPORTED_DISTANCE
  stressLineNext[id] = 0
  carriedLoad[id] = 0
  stress[id] = 0
  isPackedPolygonCacheDirty = true
  isPackedContourCacheDirty = true
  freeIds.push(id)
}

function moveParticle(id: number, col: number, row: number) {
  grid[indexAt(x[id], y[id])] = EMPTY
  prevX[id] = x[id]
  prevY[id] = y[id]
  x[id] = col
  y[id] = row
  grid[indexAt(col, row)] = id
}

function setLoose(id: number) {
  const wasPacked = kind[id] === PACKED_DIRT
  kind[id] = LOOSE_DIRT
  mass[id] = 1
  stickiness[id] = 1
  strength[id] = 0
  restTicks[id] = 0
  verticalSupport[id] = 0
  supportDistance[id] = UNSUPPORTED_DISTANCE
  stressLineNext[id] = 0
  carriedLoad[id] = 0
  stress[id] = 0
  if (wasPacked) {
    isPackedPolygonCacheDirty = true
    isPackedContourCacheDirty = true
  }
}

function setPacked(id: number) {
  const wasPacked = kind[id] === PACKED_DIRT
  kind[id] = PACKED_DIRT
  mass[id] = 3
  stickiness[id] = 2
  strength[id] = packedStrength
  restTicks[id] = 0
  vx[id] = 0
  vy[id] = 0
  if (!wasPacked) {
    isPackedPolygonCacheDirty = true
    isPackedContourCacheDirty = true
  }
}

function updatePackedStrengths() {
  for (let id = 1; id < nextId; id += 1) {
    if (kind[id] === PACKED_DIRT) strength[id] = packedStrength
  }
}

function clampVelocity(value: number) {
  return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, Math.trunc(value)))
}

function dampVelocity(value: number) {
  if (value === 0 || globalDamping === 0) return value
  const damped = Math.trunc(value * (1 - globalDamping))
  if (damped === value) return value - Math.sign(value)
  return damped
}

function reduceTowardZero(value: number, amount = 1) {
  if (value === 0) return 0
  const next = Math.abs(value) - amount
  return next <= 0 ? 0 : Math.sign(value) * next
}

function quantizeVelocity(value: number) {
  return clampVelocity(Math.trunc(value))
}

function exchangeMomentum(a: number, b: number, axis: 'x' | 'y') {
  if (b <= 0 || kind[b] === EMPTY) return

  const av = axis === 'x' ? vx[a] : vy[a]
  const bv = axis === 'x' ? vx[b] : vy[b]
  const totalMass = mass[a] + mass[b]
  const nextA = ((mass[a] - mass[b]) * av + 2 * mass[b] * bv) / totalMass
  const nextB = ((mass[b] - mass[a]) * bv + 2 * mass[a] * av) / totalMass

  if (axis === 'x') {
    vx[a] = quantizeVelocity(nextA)
    vx[b] = quantizeVelocity(nextB)
  } else {
    vy[a] = quantizeVelocity(nextA)
    vy[b] = quantizeVelocity(nextB)
  }

  if (kind[b] === PACKED_DIRT && Math.abs(av) + Math.abs(bv) > 3 && !hasDirectPackedColumnToGround(b)) {
    setLoose(b)
  }
}

function attemptAxisMove(id: number, axis: 'x' | 'y', allowCollisionSideStep = true) {
  const velocity = axis === 'x' ? vx[id] : vy[id]
  if (velocity === 0) return false

  const steps = Math.abs(velocity)
  const direction = Math.sign(velocity)
  let openCol = x[id]
  let openRow = y[id]

  for (let step = 1; step <= steps; step += 1) {
    const nextCol = axis === 'x' ? x[id] + step * direction : x[id]
    const nextRow = axis === 'y' ? y[id] + step * direction : y[id]

    if (!inBounds(nextCol, nextRow)) {
      if (openCol !== x[id] || openRow !== y[id]) moveParticle(id, openCol, openRow)
      if (axis === 'x') vx[id] = 0
      else vy[id] = 0
      return openCol !== x[id] || openRow !== y[id]
    }

    const occupant = cellId(nextCol, nextRow)
    if (occupant !== EMPTY) {
      const movedToNearestOpen = openCol !== x[id] || openRow !== y[id]
      if (openCol !== x[id] || openRow !== y[id]) moveParticle(id, openCol, openRow)

      if (axis === 'y' && direction > 0 && steps <= 1) {
        vy[id] = 0
        const fellDiagonally = allowCollisionSideStep && tryDiagonalFall(id)
        if (!fellDiagonally && shouldPackAgainstStableColumn(id)) setPacked(id)
        return fellDiagonally || movedToNearestOpen
      }

      exchangeMomentum(id, occupant, axis)

      if (axis === 'y' && direction > 0 && allowCollisionSideStep) {
        vy[id] = 0
        const fellDiagonally = tryDiagonalFall(id)
        if (!fellDiagonally && shouldPackAgainstStableColumn(id)) setPacked(id)
        return fellDiagonally || movedToNearestOpen
      }

      if (axis === 'x') {
        vx[id] = reduceTowardZero(vx[id])
        if (occupant > 0 && kind[occupant] !== EMPTY) {
          vx[occupant] = reduceTowardZero(vx[occupant])
        }
      }

      return movedToNearestOpen
    }

    openCol = nextCol
    openRow = nextRow
  }

  moveParticle(id, openCol, openRow)
  return true
}

function hasSupport(id: number) {
  return y[id] === GRID_HEIGHT - 1 || cellId(x[id], y[id] + 1) > 0
}

function hasEmptyBelow(id: number) {
  return y[id] < GRID_HEIGHT - 1 && cellId(x[id], y[id] + 1) === EMPTY
}

function hasDirectPackedColumnToGround(id: number) {
  if (id <= 0 || kind[id] !== PACKED_DIRT) return false

  for (let row = y[id]; row < GRID_HEIGHT; row += 1) {
    const columnId = cellId(x[id], row)
    if (columnId <= 0 || kind[columnId] !== PACKED_DIRT) return false
  }

  return true
}

function shouldPackAgainstStableColumn(id: number) {
  if (y[id] >= GRID_HEIGHT - 1) return false
  const below = cellId(x[id], y[id] + 1)
  return hasDirectPackedColumnToGround(below)
}

function tryDiagonalFall(id: number) {
  if (y[id] >= GRID_HEIGHT - 1) return false

  const directionFirst = (id + tick) % 2 === 0 ? -1 : 1
  const options = [directionFirst, -directionFirst]

  for (const direction of options) {
    const diagonalCol = x[id] + direction
    const diagonalRow = y[id] + 1
    if (inBounds(diagonalCol, diagonalRow) && cellId(diagonalCol, diagonalRow) === EMPTY) {
      moveParticle(id, diagonalCol, diagonalRow)
      vy[id] = 0
      return true
    }
  }

  return false
}

function tryRestingSlide(id: number) {
  if (vy[id] !== 0 || !hasSupport(id)) return false
  return tryDiagonalFall(id)
}

function applySlidingFriction(id: number) {
  if (vx[id] === 0 || !hasSupport(id)) return
  const below = cellId(x[id], Math.min(GRID_HEIGHT - 1, y[id] + 1))
  const friction = Math.max(1, below > 0 ? stickiness[below] : 1)
  vx[id] = reduceTowardZero(vx[id], friction)
}

function updateLooseParticle(id: number) {
  if (kind[id] !== LOOSE_DIRT || touched[id] === tick) return
  touched[id] = tick

  prevX[id] = x[id]
  prevY[id] = y[id]
  const hadVerticalVelocityBeforeGravity = vy[id] !== 0

  if (y[id] === GRID_HEIGHT - 1 && vy[id] > 0) {
    vy[id] = 0
  } else if (y[id] < GRID_HEIGHT - 1) {
    vy[id] = clampVelocity(vy[id] + GRAVITY)
  }

  const movedVertical = attemptAxisMove(id, 'y', hadVerticalVelocityBeforeGravity)
  if (kind[id] !== LOOSE_DIRT) return

  if (!movedVertical && vy[id] === 0) {
    const fellDiagonally = tryRestingSlide(id)
    if (!fellDiagonally && shouldPackAgainstStableColumn(id)) {
      setPacked(id)
      return
    }
  }

  if (vx[id] !== 0) {
    attemptAxisMove(id, 'x')
    applySlidingFriction(id)
  }

  vx[id] = dampVelocity(vx[id])
  vy[id] = dampVelocity(vy[id])

  if (x[id] === prevX[id] && y[id] === prevY[id] && vx[id] === 0 && vy[id] === 0 && hasSupport(id)) {
    restTicks[id] += 1
    if (restTicks[id] >= PACK_AFTER_REST_TICKS) setPacked(id)
  } else {
    restTicks[id] = 0
  }
}

function updatePackedSupport() {
  grounded.fill(0)
  const queue: number[] = []

  for (let col = 0; col < GRID_WIDTH; col += 1) {
    const id = cellId(col, GRID_HEIGHT - 1)
    if (id > 0 && kind[id] === PACKED_DIRT) {
      grounded[id] = 1
      queue.push(id)
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]
    const neighbors = [
      [x[id] + 1, y[id]],
      [x[id] - 1, y[id]],
      [x[id], y[id] + 1],
      [x[id], y[id] - 1],
    ]

    for (const [col, row] of neighbors) {
      const neighbor = cellId(col, row)
      if (neighbor > 0 && kind[neighbor] === PACKED_DIRT && grounded[neighbor] === 0) {
        grounded[neighbor] = 1
        queue.push(neighbor)
      }
    }
  }

  for (let id = 1; id < nextId; id += 1) {
    if (kind[id] === PACKED_DIRT && grounded[id] === 0) {
      setLoose(id)
    }
  }
}

function resetPackedStressFields() {
  verticalSupport.fill(0)
  supportDistance.fill(UNSUPPORTED_DISTANCE)
  stressLineNext.fill(0)
  carriedLoad.fill(0)
  stress.fill(0)
}

function queueStressLineNeighbor(neighbor: number, nextIdTowardSupport: number, nextDistance: number, queue: number[]) {
  if (neighbor <= 0 || kind[neighbor] !== PACKED_DIRT || nextDistance >= supportDistance[neighbor]) return
  supportDistance[neighbor] = nextDistance
  stressLineNext[neighbor] = nextIdTowardSupport
  queue.push(neighbor)
}

function updateStressLinePaths() {
  const queue: number[] = []

  for (let col = 0; col < GRID_WIDTH; col += 1) {
    for (let row = GRID_HEIGHT - 1; row >= 0; row -= 1) {
      const id = cellId(col, row)
      if (id <= 0 || kind[id] !== PACKED_DIRT) continue

      const below = row === GRID_HEIGHT - 1 ? EMPTY : cellId(col, row + 1)
      const hasDirectVerticalSupport =
        row === GRID_HEIGHT - 1 ||
        (below > 0 && kind[below] === PACKED_DIRT && verticalSupport[below] === 1)

      if (hasDirectVerticalSupport) {
        verticalSupport[id] = 1
        supportDistance[id] = 0
        queue.push(id)
      }
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]
    const nextDistance = supportDistance[id] + 1

    queueStressLineNeighbor(cellId(x[id] + 1, y[id]), id, nextDistance, queue)
    queueStressLineNeighbor(cellId(x[id] - 1, y[id]), id, nextDistance, queue)
    queueStressLineNeighbor(cellId(x[id], y[id] + 1), id, nextDistance, queue)
    queueStressLineNeighbor(cellId(x[id], y[id] - 1), id, nextDistance, queue)
  }
}

function updateCarriedLoads() {
  for (let col = 0; col < GRID_WIDTH; col += 1) {
    let columnLoad = 0
    for (let row = 0; row < GRID_HEIGHT; row += 1) {
      const id = cellId(col, row)
      if (id <= 0) {
        columnLoad = 0
        continue
      }

      columnLoad += mass[id]
      if (kind[id] === PACKED_DIRT) {
        carriedLoad[id] += columnLoad
      }
    }
  }
}

function stressLineEffectiveLoadFor(id: number) {
  const carriedMass = Math.max(0, carriedLoad[id] - mass[id])
  return mass[id] + carriedMass * STRESS_LINE_CARRIED_LOAD_FACTOR
}

function stressLineLoadFor(id: number) {
  const distance = supportDistance[id]
  const distanceScale = 1 + Math.pow(distance, STRESS_LINE_DISTANCE_EXPONENT) * STRESS_LINE_DISTANCE_MULTIPLIER
  return stressLineEffectiveLoadFor(id) * STRESS_LINE_LOAD_MULTIPLIER * distanceScale
}

function depositStressLineLoad(source: number, lineLoad: number) {
  const distance = supportDistance[source]
  let current = source
  let pathStep = 0
  const maxSteps = Math.min(distance + 1, STRESS_LINE_MAX_PATH_STEPS)

  while (current > 0 && pathStep < maxSteps) {
    if (kind[current] !== PACKED_DIRT) break

    const supportProgress = distance > 0 ? pathStep / distance : 1
    stress[current] += lineLoad * (1 + supportProgress * STRESS_LINE_SUPPORT_BIAS)

    if (verticalSupport[current] === 1) break
    current = stressLineNext[current]
    pathStep += 1
  }
}

function accumulateStressLines() {
  for (let id = 1; id < nextId; id += 1) {
    if (kind[id] !== PACKED_DIRT) continue
    if (verticalSupport[id] === 1 || supportDistance[id] === UNSUPPORTED_DISTANCE) continue
    depositStressLineLoad(id, stressLineLoadFor(id))
  }
}

function recalculatePackedStress() {
  resetPackedStressFields()
  updateStressLinePaths()
  updateCarriedLoads()
  accumulateStressLines()
}

function updatePackedStress() {
  for (let pass = 0; pass <= MAX_STRESS_FRACTURE_REPASSES; pass += 1) {
    recalculatePackedStress()

    const breaks: number[] = []

    for (let id = 1; id < nextId; id += 1) {
      if (kind[id] === PACKED_DIRT && stress[id] > strength[id]) {
        breaks.push(id)
      }
    }

    if (breaks.length === 0) return

    for (const id of breaks) {
      if (kind[id] !== PACKED_DIRT) continue
      setLoose(id)
      vy[id] = Math.max(vy[id], 1)
    }

    updatePackedSupport()
  }

  recalculatePackedStress()
}

function isPackedCell(col: number, row: number) {
  if (!inBounds(col, row)) return false
  const id = grid[indexAt(col, row)]
  return id > 0 && kind[id] === PACKED_DIRT
}

function isUncoveredPackedCell(col: number, row: number) {
  if (!isPackedCell(col, row)) return false
  return polygonVisited[indexAt(col, row)] === 0
}

function rectanglePolygon(col: number, row: number, width: number, height: number): PackedPolygon {
  return [
    { x: col, y: row },
    { x: col + width, y: row },
    { x: col + width, y: row + height },
    { x: col, y: row + height },
  ]
}

function measurePackedRectangleWidth(col: number, row: number) {
  let width = 0
  while (col + width < GRID_WIDTH && isUncoveredPackedCell(col + width, row)) {
    width += 1
  }

  return width
}

function canExtendPackedRectangle(col: number, row: number, width: number) {
  if (row >= GRID_HEIGHT) return false

  for (let offset = 0; offset < width; offset += 1) {
    if (!isUncoveredPackedCell(col + offset, row)) return false
  }

  return true
}

function markPackedRectangleCovered(col: number, row: number, width: number, height: number) {
  for (let fillRow = row; fillRow < row + height; fillRow += 1) {
    for (let fillCol = col; fillCol < col + width; fillCol += 1) {
      polygonVisited[indexAt(fillCol, fillRow)] = 1
    }
  }
}

function rebuildPackedPolygons() {
  packedPolygons = []
  polygonVisited.fill(0)

  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    for (let col = 0; col < GRID_WIDTH; col += 1) {
      if (!isUncoveredPackedCell(col, row)) continue

      const width = measurePackedRectangleWidth(col, row)
      let height = 1
      while (canExtendPackedRectangle(col, row + height, width)) {
        height += 1
      }

      markPackedRectangleCovered(col, row, width, height)
      packedPolygons.push(rectanglePolygon(col, row, width, height))
    }
  }

  packedPolygonCacheTick = tick
  isPackedPolygonCacheDirty = false
}

function updatePackedPolygonCache() {
  if (!isPolygonDebugEnabled) return
  if (!isPackedPolygonCacheDirty && tick - packedPolygonCacheTick < POLYGON_REBUILD_INTERVAL_TICKS) return
  rebuildPackedPolygons()
}

function drawPackedPolygonOverlay() {
  if (!isPolygonDebugEnabled) return

  updatePackedPolygonCache()

  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#3bb9d8'
  ctx.strokeStyle = '#d8fbff'
  ctx.lineWidth = 1

  for (const polygon of packedPolygons) {
    if (polygon.length < 3) continue
    ctx.beginPath()
    ctx.moveTo(polygon[0].x * CELL_SIZE, polygon[0].y * CELL_SIZE)
    for (let i = 1; i < polygon.length; i += 1) {
      ctx.lineTo(polygon[i].x * CELL_SIZE, polygon[i].y * CELL_SIZE)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  ctx.restore()
}

function pointKey(point: Point) {
  return `${point.x},${point.y}`
}

function addContourEdge(segments: ContourSegment[], start: Point, end: Point) {
  segments.push({ start, end })
}

function countRawPackedNeighbors(col: number, row: number) {
  let count = 0
  if (isPackedCell(col + 1, row)) count += 1
  if (isPackedCell(col - 1, row)) count += 1
  if (isPackedCell(col, row + 1)) count += 1
  if (isPackedCell(col, row - 1)) count += 1
  return count
}

function isContourSolidCell(col: number, row: number) {
  if (!inBounds(col, row)) return false

  const packedNeighbors = countRawPackedNeighbors(col, row)
  if (isPackedCell(col, row)) {
    const emptyNeighbors = 4 - packedNeighbors
    return emptyNeighbors < CONTOUR_NOISE_NEIGHBOR_THRESHOLD
  }

  return packedNeighbors >= CONTOUR_NOISE_NEIGHBOR_THRESHOLD
}

function collectPackedContourSegments() {
  const segments: ContourSegment[] = []

  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    for (let col = 0; col < GRID_WIDTH; col += 1) {
      if (!isContourSolidCell(col, row)) continue

      if (!isContourSolidCell(col, row - 1)) {
        addContourEdge(segments, { x: col, y: row }, { x: col + 1, y: row })
      }
      if (!isContourSolidCell(col + 1, row)) {
        addContourEdge(segments, { x: col + 1, y: row }, { x: col + 1, y: row + 1 })
      }
      if (!isContourSolidCell(col, row + 1)) {
        addContourEdge(segments, { x: col + 1, y: row + 1 }, { x: col, y: row + 1 })
      }
      if (!isContourSolidCell(col - 1, row)) {
        addContourEdge(segments, { x: col, y: row + 1 }, { x: col, y: row })
      }
    }
  }

  return segments
}

function stitchContourSegments(segments: ContourSegment[]) {
  const contours: PackedContour[] = []
  const starts = new Map<string, number[]>()
  const used = new Uint8Array(segments.length)

  for (let i = 0; i < segments.length; i += 1) {
    const key = pointKey(segments[i].start)
    const entries = starts.get(key)
    if (entries) entries.push(i)
    else starts.set(key, [i])
  }

  for (let i = 0; i < segments.length; i += 1) {
    if (used[i] === 1) continue

    const contour: PackedContour = [segments[i].start, segments[i].end]
    used[i] = 1

    while (contour.length < segments.length + 1) {
      const first = contour[0]
      const current = contour[contour.length - 1]
      if (current.x === first.x && current.y === first.y) break

      const candidates = starts.get(pointKey(current))
      const next = candidates?.find((candidate) => used[candidate] === 0)
      if (next === undefined) break

      used[next] = 1
      contour.push(segments[next].end)
    }

    if (contour.length >= 4) {
      if (pointKey(contour[0]) === pointKey(contour[contour.length - 1])) contour.pop()
      contours.push(contour)
    }
  }

  return contours
}

function squaredDistanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    const pointDx = point.x - start.x
    const pointDy = point.y - start.y
    return pointDx * pointDx + pointDy * pointDy
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  const projectionX = start.x + t * dx
  const projectionY = start.y + t * dy
  const pointDx = point.x - projectionX
  const pointDy = point.y - projectionY
  return pointDx * pointDx + pointDy * pointDy
}

function simplifyOpenContour(points: PackedContour, epsilon: number): PackedContour {
  if (points.length <= 2) return points.slice()

  let farthestIndex = -1
  let farthestDistance = 0
  const start = points[0]
  const end = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = squaredDistanceToSegment(points[i], start, end)
    if (distance > farthestDistance) {
      farthestDistance = distance
      farthestIndex = i
    }
  }

  if (farthestDistance <= epsilon * epsilon || farthestIndex === -1) return [start, end]

  const left = simplifyOpenContour(points.slice(0, farthestIndex + 1), epsilon)
  const right = simplifyOpenContour(points.slice(farthestIndex), epsilon)
  return left.slice(0, -1).concat(right)
}

function simplifyClosedContour(contour: PackedContour, epsilon: number) {
  if (contour.length <= 4) return contour.slice()

  let splitIndex = 0
  for (let i = 1; i < contour.length; i += 1) {
    if (contour[i].x < contour[splitIndex].x || (contour[i].x === contour[splitIndex].x && contour[i].y < contour[splitIndex].y)) {
      splitIndex = i
    }
  }

  const rotated = contour.slice(splitIndex).concat(contour.slice(0, splitIndex), [contour[splitIndex]])
  const simplified = simplifyOpenContour(rotated, epsilon)
  if (pointKey(simplified[0]) === pointKey(simplified[simplified.length - 1])) simplified.pop()
  return simplified.length >= 3 ? simplified : contour.slice()
}

function smoothClosedContour(contour: PackedContour, passes: number) {
  let smoothed = contour.slice()

  for (let pass = 0; pass < passes; pass += 1) {
    if (smoothed.length < 3) break

    const next: PackedContour = []
    for (let i = 0; i < smoothed.length; i += 1) {
      const a = smoothed[i]
      const b = smoothed[(i + 1) % smoothed.length]
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
      })
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
      })
    }

    smoothed = next
  }

  return smoothed
}

function rebuildPackedContours() {
  const segments = collectPackedContourSegments()
  const contours = stitchContourSegments(segments)
  packedContours = contours.map((contour) => smoothClosedContour(simplifyClosedContour(contour, CONTOUR_SIMPLIFY_EPSILON), CONTOUR_SMOOTHING_PASSES))
  packedContourCacheTick = tick
  isPackedContourCacheDirty = false
}

function updatePackedContourCache() {
  if (!isContourDebugEnabled) return
  if (!isPackedContourCacheDirty && tick - packedContourCacheTick < CONTOUR_REBUILD_INTERVAL_TICKS) return
  rebuildPackedContours()
}

function drawPackedContourOverlay() {
  if (!isContourDebugEnabled) return

  updatePackedContourCache()

  ctx.save()
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = '#66f2a5'
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (const contour of packedContours) {
    if (contour.length < 3) continue
    ctx.beginPath()
    ctx.moveTo(contour[0].x * CELL_SIZE, contour[0].y * CELL_SIZE)
    for (let i = 1; i < contour.length; i += 1) {
      ctx.lineTo(contour[i].x * CELL_SIZE, contour[i].y * CELL_SIZE)
    }
    ctx.closePath()
    ctx.stroke()
  }

  ctx.restore()
}

function rebuildPhysicsTerrain() {
  if (!isPackedContourCacheDirty && tick - packedContourCacheTick < CONTOUR_REBUILD_INTERVAL_TICKS) return

  rebuildPackedContours()

  if (physicsTerrainBody) physicsWorld.destroyBody(physicsTerrainBody)
  physicsTerrainBody = physicsWorld.createBody()

  for (const contour of packedContours) {
    if (contour.length < 3) continue

    const vertices = contour.map((point) => Vec2(point.x, point.y))
    physicsTerrainBody.createFixture({
      shape: Chain(vertices, true),
      friction: 1.4,
      restitution: 0,
    })
  }
}

function destroyVehicleBody(body: Body | null) {
  if (body) physicsWorld.destroyBody(body)
}

function resetPhysicsVehicle() {
  destroyVehicleBody(physicsChassisBody)
  destroyVehicleBody(physicsLeftWheelBody)
  destroyVehicleBody(physicsRightWheelBody)

  physicsChassisBody = physicsWorld.createDynamicBody({
    position: Vec2(VEHICLE_START_COL, VEHICLE_START_ROW),
    angularDamping: 1.2,
    linearDamping: 0.08,
  })
  physicsChassisBody.createFixture({
    shape: Box(5.8, 1.15),
    density: 0.65,
    friction: 0.6,
    restitution: 0.05,
  })

  physicsLeftWheelBody = physicsWorld.createDynamicBody({
    position: Vec2(VEHICLE_START_COL - 4.2, VEHICLE_START_ROW + 2.2),
    angularDamping: 0.15,
  })
  physicsLeftWheelBody.createFixture({
    shape: Circle(1.75),
    density: 1.35,
    friction: 2.8,
    restitution: 0.02,
  })

  physicsRightWheelBody = physicsWorld.createDynamicBody({
    position: Vec2(VEHICLE_START_COL + 4.2, VEHICLE_START_ROW + 2.2),
    angularDamping: 0.15,
  })
  physicsRightWheelBody.createFixture({
    shape: Circle(1.75),
    density: 1.35,
    friction: 2.8,
    restitution: 0.02,
  })

  const jointOptions = {
    enableMotor: true,
    maxMotorTorque: VEHICLE_MOTOR_TORQUE,
    motorSpeed: 0,
    frequencyHz: 4,
    dampingRatio: 0.75,
  }

  physicsLeftWheelJoint = physicsWorld.createJoint(WheelJoint(
    jointOptions,
    physicsChassisBody,
    physicsLeftWheelBody,
    physicsLeftWheelBody.getPosition(),
    Vec2(0, 1),
  ))
  physicsRightWheelJoint = physicsWorld.createJoint(WheelJoint(
    jointOptions,
    physicsChassisBody,
    physicsRightWheelBody,
    physicsRightWheelBody.getPosition(),
    Vec2(0, 1),
  ))
}

function updateVehicleMotor() {
  const drive = Number(isDrivingRight) - Number(isDrivingLeft)
  const motorSpeed = -drive * VEHICLE_MOTOR_SPEED

  physicsLeftWheelJoint?.setMotorSpeed(motorSpeed)
  physicsRightWheelJoint?.setMotorSpeed(motorSpeed)
}

function stepPhysics(delta: number) {
  rebuildPhysicsTerrain()
  updateVehicleMotor()

  physicsAccumulator += delta / 1000
  let iterations = 0
  while (physicsAccumulator >= PHYSICS_STEP_SECONDS && iterations < 5) {
    physicsWorld.step(PHYSICS_STEP_SECONDS, 8, 3)
    physicsAccumulator -= PHYSICS_STEP_SECONDS
    iterations += 1
  }

  if (physicsChassisBody && physicsChassisBody.getPosition().y > GRID_HEIGHT + 35) {
    resetPhysicsVehicle()
  }
}

function drawPhysicsBox(body: Body, halfWidth: number, halfHeight: number, fillStyle: string, strokeStyle: string) {
  const position = body.getPosition()
  const angle = body.getAngle()
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const corners = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ]

  ctx.beginPath()
  for (let i = 0; i < corners.length; i += 1) {
    const [localX, localY] = corners[i]
    const worldX = position.x + localX * cos - localY * sin
    const worldY = position.y + localX * sin + localY * cos
    const canvasX = worldX * CELL_SIZE
    const canvasY = worldY * CELL_SIZE
    if (i === 0) ctx.moveTo(canvasX, canvasY)
    else ctx.lineTo(canvasX, canvasY)
  }
  ctx.closePath()
  ctx.fillStyle = fillStyle
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = 2
  ctx.fill()
  ctx.stroke()
}

function drawPhysicsWheel(body: Body, radius: number) {
  const position = body.getPosition()
  const angle = body.getAngle()
  const canvasX = position.x * CELL_SIZE
  const canvasY = position.y * CELL_SIZE
  const canvasRadius = radius * CELL_SIZE

  ctx.beginPath()
  ctx.arc(canvasX, canvasY, canvasRadius, 0, Math.PI * 2)
  ctx.fillStyle = '#181c21'
  ctx.strokeStyle = '#f3d173'
  ctx.lineWidth = 2
  ctx.fill()
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(canvasX, canvasY)
  ctx.lineTo(canvasX + Math.cos(angle) * canvasRadius, canvasY + Math.sin(angle) * canvasRadius)
  ctx.strokeStyle = '#f8f1dc'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function drawPhysicsVehicle() {
  if (!physicsChassisBody || !physicsLeftWheelBody || !physicsRightWheelBody) return

  ctx.save()
  drawPhysicsBox(physicsChassisBody, 5.8, 1.15, '#d9563f', '#ffe0a3')
  drawPhysicsWheel(physicsLeftWheelBody, 1.75)
  drawPhysicsWheel(physicsRightWheelBody, 1.75)
  ctx.restore()
}

function compactActiveList() {
  let write = 0
  for (let read = 0; read < activeIds.length; read += 1) {
    const id = activeIds[read]
    if (kind[id] !== EMPTY) activeIds[write++] = id
  }
  activeIds.length = write
}

function simulate() {
  tick += 1
  const reverse = tick % 2 === 0

  if (reverse) {
    for (let i = activeIds.length - 1; i >= 0; i -= 1) updateLooseParticle(activeIds[i])
  } else {
    for (let i = 0; i < activeIds.length; i += 1) updateLooseParticle(activeIds[i])
  }

  if (isStressEnabled && tick % STRESS_INTERVAL_TICKS === 0) updatePackedStress()
  if (tick % 12 === 0) updatePackedSupport()
  if (tick % 60 === 0) compactActiveList()
}

function drawGrid() {
  ctx.fillStyle = '#131517'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    for (let col = 0; col < GRID_WIDTH; col += 1) {
      const id = cellId(col, row)
      if (id <= 0) continue

      if (kind[id] === PACKED_DIRT) {
        const stressRatio = strength[id] > 0 ? stress[id] / strength[id] : 0
        if (isStressEnabled && stressRatio > 0.8) {
          ctx.fillStyle = '#9f5f3f'
        } else if (isStressEnabled && stressRatio > 0.55) {
          ctx.fillStyle = '#72503b'
        } else if (isStressEnabled && verticalSupport[id] === 1) {
          ctx.fillStyle = '#4f392d'
        } else {
          ctx.fillStyle = grounded[id] ? '#5a4031' : '#80614d'
        }
      } else {
        const speed = Math.min(5, Math.abs(vx[id]) + Math.abs(vy[id]))
        ctx.fillStyle = ['#b4804e', '#c28c55', '#d09a5c', '#dda662', '#e7b16a', '#f0bf79'][speed]
      }
      ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    }
  }

  drawPackedPolygonOverlay()
  drawPackedContourOverlay()
  drawPhysicsVehicle()

  if (isInspectorEnabled && inBounds(hoverCol, hoverRow)) {
    ctx.strokeStyle = '#f2d8a4'
    ctx.lineWidth = 1
    ctx.strokeRect(hoverCol * CELL_SIZE + 0.5, hoverRow * CELL_SIZE + 0.5, CELL_SIZE - 1, CELL_SIZE - 1)
  }
}

function materialName(id: number) {
  if (id <= 0) return 'empty'
  if (kind[id] === LOOSE_DIRT) return 'loose dirt'
  if (kind[id] === PACKED_DIRT) return 'packed dirt'
  return 'unknown'
}

function updateHoverCell(clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect()
  hoverCol = Math.floor(((clientX - rect.left) / rect.width) * GRID_WIDTH)
  hoverRow = Math.floor(((clientY - rect.top) / rect.height) * GRID_HEIGHT)
}

function updateInspector() {
  if (!isInspectorEnabled) {
    inspectorEl.textContent = 'Inspector off'
    return
  }

  if (!inBounds(hoverCol, hoverRow)) {
    inspectorEl.textContent = 'No cell'
    return
  }

  const id = cellId(hoverCol, hoverRow)
  if (id <= 0) {
    inspectorEl.textContent = [
      `cell: ${hoverCol}, ${hoverRow}`,
      'material: empty',
    ].join('\n')
    return
  }

  inspectorEl.textContent = [
    `id: ${id}`,
    `material: ${materialName(id)}`,
    `cell: ${x[id]}, ${y[id]}`,
    `previous: ${prevX[id]}, ${prevY[id]}`,
    `velocity: ${vx[id]}, ${vy[id]}`,
    `mass: ${mass[id]}`,
    `stickiness: ${stickiness[id]}`,
    `strength: ${strength[id]}`,
    `carried load: ${carriedLoad[id].toFixed(1)}`,
    `stress load: ${stressLineEffectiveLoadFor(id).toFixed(1)}`,
    `stress: ${stress[id].toFixed(1)}`,
    `stress line: ${supportDistance[id] === UNSUPPORTED_DISTANCE ? 'none' : `${supportDistance[id]} steps`}`,
    `next support step: ${stressLineNext[id] || 'none'}`,
    `vertical support: ${verticalSupport[id] === 1 ? 'yes' : 'no'}`,
    `empty below: ${hasEmptyBelow(id) ? 'yes' : 'no'}`,
    `rest ticks: ${restTicks[id]}`,
    `grounded: ${grounded[id] === 1 ? 'yes' : 'no'}`,
  ].join('\n')
}

function updateStats(delta: number) {
  fps = fps * 0.9 + (1000 / Math.max(delta, 1)) * 0.1

  if (tick % 8 === 0) {
    let total = 0
    for (let id = 1; id < nextId; id += 1) {
      if (kind[id] !== EMPTY) total += 1
    }
    fpsEl.textContent = `${Math.round(fps)} fps`
    countEl.textContent = `${total.toLocaleString()} grains`
  }
}

function frame(now: number) {
  const delta = Math.min(100, now - lastFrame)
  lastFrame = now

  if (!isPaused) {
    simAccumulator += delta
    const tickInterval = 1000 / ticksPerSecond
    let iterations = 0
    while (simAccumulator >= tickInterval && iterations < 8) {
      simulate()
      simAccumulator -= tickInterval
      iterations += 1
    }
  }
  stepPhysics(delta)
  drawGrid()
  updateInspector()
  updateStats(delta)
  requestAnimationFrame(frame)
}

function paintAt(clientX: number, clientY: number) {
  updateHoverCell(clientX, clientY)
  const centerCol = hoverCol
  const centerRow = hoverRow

  for (let row = centerRow - brushRadius; row <= centerRow + brushRadius; row += 1) {
    for (let col = centerCol - brushRadius; col <= centerCol + brushRadius; col += 1) {
      const distance = Math.hypot(col - centerCol, row - centerRow)
      if (distance > brushRadius || !inBounds(col, row)) continue

      const id = cellId(col, row)
      if (selectedTool === 'erase') {
        if (id > 0) removeParticle(id)
      } else if (id === EMPTY && Math.random() > distance / (brushRadius + 1)) {
        addParticle(col, row, selectedTool === 'packed' ? PACKED_DIRT : LOOSE_DIRT)
      }
    }
  }
}

canvas.addEventListener('pointerdown', (event) => {
  isPainting = true
  canvas.setPointerCapture(event.pointerId)
  paintAt(event.clientX, event.clientY)
})

canvas.addEventListener('pointermove', (event) => {
  updateHoverCell(event.clientX, event.clientY)
  if (isPainting) paintAt(event.clientX, event.clientY)
})

canvas.addEventListener('pointerup', () => {
  isPainting = false
})

canvas.addEventListener('pointercancel', () => {
  isPainting = false
})

canvas.addEventListener('pointerleave', () => {
  isPainting = false
  hoverCol = -1
  hoverRow = -1
})

toolButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectedTool = button.dataset.tool as Tool
    toolButtons.forEach((candidate) => candidate.classList.toggle('active', candidate === button))
  })
})

brushInput.addEventListener('input', () => {
  brushRadius = Number(brushInput.value)
})

speedInput.addEventListener('input', () => {
  ticksPerSecond = Number(speedInput.value)
  speedValueEl.textContent = `${ticksPerSecond} ticks/s`
  simAccumulator = 0
})

dampingInput.addEventListener('input', () => {
  globalDamping = Number(dampingInput.value) / 100
  dampingValueEl.textContent = `${dampingInput.value}%`
})

strengthInput.addEventListener('input', () => {
  packedStrength = Number(strengthInput.value)
  strengthValueEl.textContent = `${packedStrength}`
  updatePackedStrengths()
})

debugInput.addEventListener('change', () => {
  isInspectorEnabled = debugInput.checked
  updateInspector()
})

stressInput.addEventListener('change', () => {
  isStressEnabled = stressInput.checked
  if (!isStressEnabled) {
    stress.fill(0)
    carriedLoad.fill(0)
    verticalSupport.fill(0)
    supportDistance.fill(UNSUPPORTED_DISTANCE)
    stressLineNext.fill(0)
  }
})

polygonInput.addEventListener('change', () => {
  isPolygonDebugEnabled = polygonInput.checked
  isPackedPolygonCacheDirty = true
})

contourInput.addEventListener('change', () => {
  isContourDebugEnabled = contourInput.checked
  isPackedContourCacheDirty = true
})

window.addEventListener('keydown', (event) => {
  if (event.repeat) return
  if (event.code === 'KeyA') {
    isDrivingLeft = true
    event.preventDefault()
  } else if (event.code === 'KeyD') {
    isDrivingRight = true
    event.preventDefault()
  } else if (event.code === 'KeyR') {
    resetPhysicsVehicle()
    event.preventDefault()
  }
})

window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyA') {
    isDrivingLeft = false
    event.preventDefault()
  } else if (event.code === 'KeyD') {
    isDrivingRight = false
    event.preventDefault()
  }
})

pauseButton.addEventListener('click', () => {
  isPaused = !isPaused
  pauseButton.textContent = isPaused ? 'Run' : 'Pause'
  simAccumulator = 0
})

stepButton.addEventListener('click', () => {
  if (!isPaused) {
    isPaused = true
    pauseButton.textContent = 'Run'
  }
  simulate()
  drawGrid()
})

clearButton.addEventListener('click', () => {
  grid.fill(EMPTY)
  kind.fill(EMPTY)
  strength.fill(0)
  stress.fill(0)
  carriedLoad.fill(0)
  verticalSupport.fill(0)
  supportDistance.fill(UNSUPPORTED_DISTANCE)
  stressLineNext.fill(0)
  activeIds.length = 0
  freeIds.length = 0
  nextId = 1
  packedPolygons = []
  packedContours = []
  isPackedPolygonCacheDirty = true
  isPackedContourCacheDirty = true
  rebuildPhysicsTerrain()
  resetPhysicsVehicle()
})

rebuildPhysicsTerrain()
resetPhysicsVehicle()
requestAnimationFrame(frame)
