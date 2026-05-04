import './style.css'

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
const DEFAULT_PACKED_STRENGTH = 200
const LOCAL_OVERHANG_STRESS_MULTIPLIER = 5.0
const SUPPORT_DISTANCE_STRESS_MULTIPLIER = 0.18
const UNSUPPORTED_DISTANCE = 65535
const STRESS_INTERVAL_TICKS = 4

type Tool = 'loose' | 'packed' | 'erase'

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
const speedValueEl = document.querySelector<HTMLSpanElement>('#speed-value')!
const dampingValueEl = document.querySelector<HTMLSpanElement>('#damping-value')!
const debugInput = document.querySelector<HTMLInputElement>('#debug-inspector')!
const stressInput = document.querySelector<HTMLInputElement>('#stress-fractures')!
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
const supportDistance = new Uint16Array(MAX_PARTICLES + 1)
const carriedLoad = new Float32Array(MAX_PARTICLES + 1)
const stress = new Float32Array(MAX_PARTICLES + 1)
const activeIds: number[] = []
const freeIds: number[] = []

let nextId = 1
let tick = 1
let selectedTool: Tool = 'loose'
let brushRadius = Number(brushInput.value)
let ticksPerSecond = Number(speedInput.value)
let globalDamping = Number(dampingInput.value) / 100
let isPainting = false
let isPaused = false
let isInspectorEnabled = false
let isStressEnabled = true
let hoverCol = -1
let hoverRow = -1
let lastFrame = performance.now()
let fps = 0
let simAccumulator = 0

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
  strength[id] = particleKind === PACKED_DIRT ? DEFAULT_PACKED_STRENGTH : 0
  restTicks[id] = 0
  touched[id] = 0
  grounded[id] = 0
  supportDistance[id] = UNSUPPORTED_DISTANCE
  carriedLoad[id] = 0
  stress[id] = 0
  grid[indexAt(col, row)] = id
  activeIds.push(id)
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
  supportDistance[id] = UNSUPPORTED_DISTANCE
  carriedLoad[id] = 0
  stress[id] = 0
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
  kind[id] = LOOSE_DIRT
  mass[id] = 1
  stickiness[id] = 1
  strength[id] = 0
  restTicks[id] = 0
  supportDistance[id] = UNSUPPORTED_DISTANCE
  carriedLoad[id] = 0
  stress[id] = 0
}

function setPacked(id: number) {
  kind[id] = PACKED_DIRT
  mass[id] = 3
  stickiness[id] = 2
  strength[id] = DEFAULT_PACKED_STRENGTH
  restTicks[id] = 0
  vx[id] = 0
  vy[id] = 0
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

function updatePackedStress() {
  supportDistance.fill(UNSUPPORTED_DISTANCE)
  carriedLoad.fill(0)
  stress.fill(0)

  const queue: number[] = []

  for (let row = GRID_HEIGHT - 1; row >= 0; row -= 1) {
    for (let col = 0; col < GRID_WIDTH; col += 1) {
      const id = cellId(col, row)
      if (id <= 0 || kind[id] !== PACKED_DIRT) continue

      const below = row === GRID_HEIGHT - 1 ? EMPTY : cellId(col, row + 1)
      const hasTrueVerticalSupport =
        row === GRID_HEIGHT - 1 ||
        (below > 0 && kind[below] === PACKED_DIRT && supportDistance[below] === 0)

      if (hasTrueVerticalSupport) {
        supportDistance[id] = 0
        queue.push(id)
      }
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]
    const nextDistance = supportDistance[id] + 1
    const neighbors = [
      [x[id] + 1, y[id]],
      [x[id] - 1, y[id]],
      [x[id], y[id] + 1],
      [x[id], y[id] - 1],
    ]

    for (const [col, row] of neighbors) {
      const neighbor = cellId(col, row)
      if (neighbor > 0 && kind[neighbor] === PACKED_DIRT && nextDistance < supportDistance[neighbor]) {
        supportDistance[neighbor] = nextDistance
        queue.push(neighbor)
      }
    }
  }

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

  for (let id = 1; id < nextId; id += 1) {
    if (kind[id] !== PACKED_DIRT) continue
    if (!hasEmptyBelow(id)) continue

    const neighbors = [cellId(x[id] - 1, y[id]), cellId(x[id] + 1, y[id])].filter(
      (neighbor) => neighbor > 0 && kind[neighbor] === PACKED_DIRT,
    )
    const load = Math.max(mass[id], carriedLoad[id]) * LOCAL_OVERHANG_STRESS_MULTIPLIER

    if (neighbors.length === 0) {
      stress[id] += load
      continue
    }

    const sharedLoad = load / neighbors.length
    for (const neighbor of neighbors) {
      stress[neighbor] += sharedLoad
    }
  }

  for (let id = 1; id < nextId; id += 1) {
    if (kind[id] !== PACKED_DIRT) continue
    if (supportDistance[id] === 0 || supportDistance[id] === UNSUPPORTED_DISTANCE) continue

    const load = Math.max(mass[id], carriedLoad[id])
    stress[id] += load * supportDistance[id] * SUPPORT_DISTANCE_STRESS_MULTIPLIER
  }

  const breaks: number[] = []

  for (let id = 1; id < nextId; id += 1) {
    if (kind[id] === PACKED_DIRT && stress[id] > strength[id]) {
      breaks.push(id)
    }
  }

  for (const id of breaks) {
    if (kind[id] !== PACKED_DIRT) continue
    setLoose(id)
    vy[id] = Math.max(vy[id], 1)
  }

  if (breaks.length > 0) updatePackedSupport()
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
    `load: ${carriedLoad[id].toFixed(1)}`,
    `stress: ${stress[id].toFixed(1)}`,
    `support dist: ${supportDistance[id] === UNSUPPORTED_DISTANCE ? 'none' : supportDistance[id]}`,
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

debugInput.addEventListener('change', () => {
  isInspectorEnabled = debugInput.checked
  updateInspector()
})

stressInput.addEventListener('change', () => {
  isStressEnabled = stressInput.checked
  if (!isStressEnabled) {
    stress.fill(0)
    carriedLoad.fill(0)
    supportDistance.fill(UNSUPPORTED_DISTANCE)
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
  supportDistance.fill(UNSUPPORTED_DISTANCE)
  activeIds.length = 0
  freeIds.length = 0
  nextId = 1
})

requestAnimationFrame(frame)
