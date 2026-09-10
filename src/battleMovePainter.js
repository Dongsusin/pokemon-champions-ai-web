// Small, deterministic vector compositions rendered on a low-resolution canvas.
// EBDX sprites supply texture; these shapes supply each move's readable silhouette.
const TAU = Math.PI * 2
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value))
const mix = (a, b, t) => a + (b - a) * t
const ease = (t) => 1 - (1 - clamp(t)) ** 3
const interval = (p, a, b) => clamp((p - a) / Math.max(0.001, b - a))
const noise = (seed, index) => {
  let value = Math.imul((seed + index * 374761393) | 0, 668265263)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

function line(ctx, points, color, width = 1, alpha = 1) {
  if (points.length < 2 || alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= clamp(alpha)
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(0.5, width)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.stroke()
  ctx.restore()
}

function polygon(ctx, points, color, alpha = 1) {
  ctx.save()
  ctx.globalAlpha *= clamp(alpha)
  ctx.fillStyle = color
  ctx.beginPath()
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function ring(ctx, x, y, radius, color, width = 1, alpha = 1, squash = 1, rotation = 0) {
  if (radius <= 0 || alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= clamp(alpha)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.ellipse(x, y, radius, radius * squash, rotation, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

function disc(ctx, x, y, radius, color, alpha = 1) {
  if (radius <= 0 || alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= clamp(alpha)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, TAU)
  ctx.fill()
  ctx.restore()
}

function glow(ctx, x, y, radius, color, alpha = 1) {
  if (radius <= 0) return
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, `${color}00`)
  disc(ctx, x, y, radius, gradient, alpha)
}

function shard(ctx, x, y, radius, color, rotation = 0, alpha = 1, narrow = 0.45) {
  const cos = Math.cos(rotation), sin = Math.sin(rotation)
  polygon(ctx, [[0, -radius], [radius * narrow, 0], [0, radius], [-radius * narrow, 0]]
    .map(([px, py]) => [x + px * cos - py * sin, y + px * sin + py * cos]), color, alpha)
}

function spark(ctx, x, y, radius, color, alpha = 1) {
  polygon(ctx, [[x, y - radius], [x + radius * .22, y - radius * .22], [x + radius, y],
    [x + radius * .22, y + radius * .22], [x, y + radius], [x - radius * .22, y + radius * .22],
    [x - radius, y], [x - radius * .22, y - radius * .22]], color, alpha)
}

function motes(ctx, point, size, count, p, palette, seed, inward = false) {
  for (let i = 0; i < count; i++) {
    const angle = noise(seed, i) * TAU
    const travel = inward ? 1 - p : p
    const radius = size * (0.5 + noise(seed, i + 80) * 2.2) * travel
    const x = point.x + Math.cos(angle) * radius
    const y = point.y + Math.sin(angle) * radius * .7 - p * size * .35
    const alpha = Math.sin(clamp(p) * Math.PI) * .85
    if (i % 3 === 0) spark(ctx, x, y, size * .14, palette[2], alpha)
    else shard(ctx, x, y, size * (.08 + noise(seed, i + 40) * .13), palette[i % 2], angle, alpha)
  }
}

function blade(ctx, x, y, size, angle, palette, alpha) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  polygon(ctx, [[-size, size * .22], [-size * .1, -size * .12], [size, -size * .38],
    [size * .22, size * .04], [-size * .5, size * .28]], palette[0], alpha)
  line(ctx, [[-size * .85, size * .2], [size * .04, -size * .06], [size, -size * .38]], palette[2], 2, alpha)
  ctx.restore()
}

function aura(ctx, point, size, progress, palette, signature, seed, supportive) {
  const alpha = Math.sin(clamp(progress) * Math.PI)
  glow(ctx, point.x, point.y, size * 2.5, palette[0], alpha * .18)
  ring(ctx, point.x, point.y + size * .9, size * (1 + progress), palette[0], 2, alpha, .3)
  if (signature === 'sword-orbit') {
    for (let i = 0; i < 3; i++) {
      const angle = i * TAU / 3 + progress * 2.2
      const x = point.x + Math.cos(angle) * size * 1.4
      const y = point.y + Math.sin(angle) * size * .42 - size * .2
      shard(ctx, x, y, size, palette[2], .12 * Math.sin(angle), alpha, .15)
      line(ctx, [[x - size * .24, y + size * .5], [x + size * .24, y + size * .5]], palette[0], 3, alpha)
    }
  } else if (signature === 'shell-break') {
    motes(ctx, point, size * 1.6, 10, progress, palette, seed)
  } else {
    for (let i = 0; i < 10; i++) {
      const f = (progress + i / 10) % 1
      const angle = i * 2.4 + progress * 2
      const x = point.x + Math.cos(angle) * size * (1 + .35 * f)
      const y = point.y + size - f * size * 2.7
      if (supportive) spark(ctx, x, y, size * .16, palette[i % 3], alpha * Math.sin(f * Math.PI))
      else shard(ctx, x, y, size * .2, palette[i % 3], 0, alpha * Math.sin(f * Math.PI))
    }
  }
  if (signature === 'moon-heal') {
    disc(ctx, point.x, point.y - size * 2, size * .65, palette[2], alpha)
    disc(ctx, point.x + size * .22, point.y - size * 2.12, size * .55, palette[1], alpha)
  }
}

function shield(ctx, point, size, p, palette, wall = false) {
  const alpha = Math.sin(clamp(p) * Math.PI) * .8
  const radius = size * (1.3 + .3 * ease(p))
  if (wall) {
    polygon(ctx, [[point.x - radius, point.y - radius], [point.x + radius, point.y - radius * .8],
      [point.x + radius, point.y + radius], [point.x - radius, point.y + radius * .8]], palette[0], alpha * .12)
    line(ctx, [[point.x - radius, point.y + radius * .8], [point.x - radius, point.y - radius],
      [point.x + radius, point.y - radius * .8], [point.x + radius, point.y + radius]], palette[2], 2, alpha)
  } else {
    glow(ctx, point.x, point.y, radius, palette[0], alpha * .18)
    ring(ctx, point.x, point.y, radius, palette[0], 3, alpha, 1.1)
    ring(ctx, point.x, point.y, radius * .93, palette[2], 1, alpha * .8, 1.1)
    for (let i = -1; i <= 1; i++) ring(ctx, point.x, point.y + i * radius * .45,
      radius * (i ? .83 : .97), palette[2], .7, alpha * .45, .22)
  }
}

function impact(ctx, recipe, cue, target, size, p, seed) {
  const palette = recipe.palette
  if (['miss', 'failed', 'immune', 'reflected'].includes(cue.result) || cue.effectiveness === 0) return
  if (cue.result === 'blocked') {
    shield(ctx, target, size, p, ['#8adfff', '#518bc9', '#e0ffff'])
    return
  }
  if (recipe.supportive) {
    aura(ctx, target, size, p, palette, recipe.signature, seed, true)
    return
  }
  if (recipe.impact.style === 'none' || recipe.impact.strength <= 0 || cue.damage === 0) return
  const strength = recipe.impact.strength * (cue.critical ? 1.18 : 1)
  const alpha = (1 - ease(interval(p, .08, .95))) * strength
  const radius = size * (1 + ease(p) * 1.8)
  glow(ctx, target.x, target.y, radius * 1.6, palette[0], alpha * .3)
  if (recipe.impact.style === 'slash') {
    blade(ctx, target.x, target.y, radius, -.65, palette, alpha)
    if (recipe.signature === 'cross-cut') blade(ctx, target.x, target.y, radius, .65, palette, alpha)
  } else {
    ring(ctx, target.x, target.y, radius, palette[0], 3 * (1 - p) + 1, alpha, recipe.impact.style === 'splash' ? .55 : 1)
    ring(ctx, target.x, target.y, radius * .76, palette[2], 1, alpha * .85)
    spark(ctx, target.x, target.y, size * (1 - p) * 1.2, palette[2], alpha)
  }
  motes(ctx, target, size * 1.5, Math.min(24, recipe.density), ease(p), palette, seed)
}

/** Draw one frame. Coordinates and canvas dimensions use the same logical pixels. */
export function paintBattleMove(ctx, { width, height, source, target, progress, phase = 'attack', recipe, cue = {}, seed = 1, reducedMotion = false }) {
  ctx.clearRect(0, 0, width, height)
  if (!recipe || width <= 0 || height <= 0) return
  const p = clamp(progress)
  if (p >= 1 || p <= 0) return
  const size = clamp(Math.min(width, height) * .105, 16, 40) * recipe.scale
  const palette = recipe.palette
  const signature = recipe.signature
  const family = recipe.family
  const count = Math.min(32, recipe.density)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  if (reducedMotion) {
    if (cue.result === 'blocked') shield(ctx, target, size, .45, palette)
    else if (!['miss', 'failed', 'immune', 'reflected'].includes(cue.result) && cue.effectiveness !== 0
      && (phase !== 'impact' || recipe.supportive || (recipe.impact.strength > 0 && cue.damage !== 0))) {
      ring(ctx, target.x, target.y, size * 1.4, palette[0], 2, .42, .7)
      spark(ctx, target.x, target.y - size * .8, size * .28, palette[2], .65)
    }
    ctx.restore()
    return
  }
  if (phase === 'impact') {
    impact(ctx, recipe, cue, target, size, p, seed)
    ctx.restore()
    return
  }
  const { anticipation, release, arrival, settle } = recipe.timing
  const travel = interval(p, release, arrival)
  const tail = 1 - interval(p, arrival, settle)
  const active = Math.min(1, interval(p, anticipation, release) * 1.5) * Math.min(1, tail * 3)
  const angle = Math.atan2(target.y - source.y, target.x - source.x)
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) }
  const at = (t, offset = 0) => ({ x: mix(source.x, target.x, t) + normal.x * offset, y: mix(source.y, target.y, t) + normal.y * offset })
  const spell = !['dash', 'melee', 'slash', 'heal', 'boost', 'barrier', 'field', 'status'].includes(family)
  if (spell && p < release + .15) {
    const charge = interval(p, 0, release + .15)
    const alpha = Math.sin(charge * Math.PI)
    const radius = size * (.28 + charge * .75)
    glow(ctx, source.x, source.y, radius * 2.2, palette[0], alpha * .3)
    ring(ctx, source.x, source.y, radius * 1.3, palette[0], 2, alpha, .8, angle)
    ring(ctx, source.x, source.y, radius * .85, palette[2], 1, alpha)
    motes(ctx, source, size * 1.1, 8, charge, palette, seed, true)
  }
  if (active <= 0) { ctx.restore(); return }
  ctx.globalAlpha = active

  if (family === 'beam') {
    const endpoint = at(ease(travel))
    const beamWidth = size * (.22 + .32 * Math.sin(travel * Math.PI))
    line(ctx, [[source.x, source.y], [endpoint.x, endpoint.y]], palette[1], beamWidth * 2.5, .22)
    line(ctx, [[source.x, source.y], [endpoint.x, endpoint.y]], palette[0], beamWidth, .92)
    line(ctx, [[source.x, source.y], [endpoint.x, endpoint.y]], palette[2], beamWidth * .32, .96)
    for (let i = 0; i < 7; i++) {
      const f = (travel * 1.8 + i / 7) % 1
      if (f > ease(travel)) continue
      const a = at(f), b = at(Math.max(0, f - .08))
      line(ctx, [[a.x, a.y], [b.x, b.y]], palette[2], 1, .75)
      if (signature === 'ice-crystal') shard(ctx, a.x, a.y, size * .28, palette[2], angle + .5, .8)
    }
    if (signature === 'solar-charge') ring(ctx, source.x, source.y, size * 1.3, palette[2], 2, tail, .5, angle + Math.PI / 2)
  } else if (family === 'stream' || family === 'drain') {
    const reverse = family === 'drain'
    if (signature === 'water-jet' && travel > 0) {
      const points = Array.from({ length: 20 }, (_, i) => {
        const f = i / 19 * ease(travel)
        const point = at(f, Math.sin(i * .8 - p * 16) * size * .08 * f)
        return [point.x, point.y]
      })
      line(ctx, points, palette[1], size * .64, .65)
      line(ctx, points, palette[0], size * .43, .95)
      line(ctx, points, palette[2], size * .13, .9)
    }
    for (let i = 0; i < Math.min(count, 22); i++) {
      const local = interval(p, release + i * .012, Math.min(.96, arrival + i * .006))
      if (local <= 0 || local >= 1) continue
      const lane = Math.sin(i * 2.4 + local * 6) * size * .36 * Math.sin(local * Math.PI)
      const point = at(reverse ? 1 - ease(local) : ease(local), lane)
      const r = size * (.13 + noise(seed, i) * .24) * Math.sin(local * Math.PI)
      if (signature === 'flame-jet' || signature === 'ghost-flame') {
        shard(ctx, point.x, point.y, r * 1.5, palette[i % 2], angle - Math.PI / 2, .9, .65)
        disc(ctx, point.x, point.y, r * .42, palette[2], .9)
      } else if (signature === 'heart') {
        disc(ctx, point.x - r * .3, point.y, r * .5, palette[0])
        disc(ctx, point.x + r * .3, point.y, r * .5, palette[0])
        polygon(ctx, [[point.x - r * .7, point.y], [point.x + r * .7, point.y], [point.x, point.y + r]], palette[0])
      } else if (signature === 'water-jet') {
        line(ctx, [[point.x - Math.cos(angle) * r * 2, point.y - Math.sin(angle) * r * 2],
          [point.x, point.y]], palette[i % 3], Math.max(1, r * .4), .75)
      } else {
        disc(ctx, point.x, point.y, r, palette[1], .8)
        ring(ctx, point.x, point.y, r, palette[0], 1.5, .95)
        disc(ctx, point.x - r * .25, point.y - r * .3, r * .25, palette[2], .9)
      }
    }
    if (signature === 'seed-vine') {
      const points = Array.from({ length: 24 }, (_, i) => {
        const point = at(i / 23, Math.sin(i * .65 + p * 5) * size * .3)
        return [point.x, point.y]
      })
      line(ctx, points, palette[0], 2, .55 * Math.sin(travel * Math.PI))
    }
  } else if (family === 'bolt') {
    const start = signature === 'sky-bolt' ? { x: target.x - size * .3, y: -size } : source
    const endpoint = { x: mix(start.x, target.x, ease(travel)), y: mix(start.y, target.y, ease(travel)) }
    const points = Array.from({ length: 13 }, (_, i) => {
      const spread = i === 0 || i === 12 ? 0 : (noise(seed + Math.floor(p * 6), i) - .5) * size * 1.4
      return [mix(start.x, endpoint.x, i / 12) + normal.x * spread, mix(start.y, endpoint.y, i / 12) + normal.y * spread]
    })
    line(ctx, points, palette[1], 9, .24)
    line(ctx, points, palette[0], 4, .95)
    line(ctx, points, palette[2], 1.5, 1)
    for (let i = 3; i < 11; i += 3) {
      const [x, y] = points[i]
      const sign = i % 2 ? 1 : -1
      line(ctx, [[x, y], [x + normal.x * size * sign, y + normal.y * size * sign],
        [x + normal.x * size * sign * 1.3 + size * .3, y + normal.y * size * sign * 1.3]], palette[0], 1, .65)
    }
  } else if (family === 'orb') {
    const point = at(ease(travel), -Math.sin(travel * Math.PI) * size * .45)
    const radius = size * (.6 + Math.sin(travel * Math.PI) * .17)
    for (let i = 1; i < 6; i++) {
      const trail = at(Math.max(0, ease(travel) - i * .035))
      disc(ctx, trail.x, trail.y, radius * (1 - i / 7), palette[0], .16 * (1 - i / 6))
    }
    glow(ctx, point.x, point.y, radius * 2.5, palette[0], .32)
    disc(ctx, point.x, point.y, radius, palette[1])
    ring(ctx, point.x, point.y, radius, palette[0], 2)
    if (signature === 'moon') {
      disc(ctx, point.x, point.y, radius * .85, palette[2])
      disc(ctx, point.x + radius * .4, point.y - radius * .2, radius * .72, palette[1])
    } else {
      disc(ctx, point.x - radius * .18, point.y - radius * .18, radius * .55, signature === 'shadow' ? palette[1] : palette[0])
      if (signature !== 'shadow') disc(ctx, point.x - radius * .27, point.y - radius * .32, radius * .18, palette[2])
    }
    for (let i = 0; i < 3; i++) ring(ctx, point.x, point.y, radius * (1.15 + i * .16),
      palette[i % 3], 1, .65, .42 + i * .1, p * 4 + i * 1.6)
    if (signature === 'hex-web') {
      line(ctx, [[point.x - radius * .6, point.y - radius * .15], [point.x - radius * .12, point.y]], palette[2], 2, .9)
      line(ctx, [[point.x + radius * .6, point.y - radius * .15], [point.x + radius * .12, point.y]], palette[2], 2, .9)
    }
    if (signature === 'prism') for (let i = 0; i < 3; i++) {
      const orbit = p * 5 + i * TAU / 3
      disc(ctx, point.x + Math.cos(orbit) * radius, point.y + Math.sin(orbit) * radius * .5,
        radius * .43, ['#ffd76b', '#76d8ff', '#ff807e'][i], .9)
    }
    if (signature === 'leaf-core' || signature === 'pollen') motes(ctx, point, size * .7, 7, .45 + travel * .35, palette, seed)
  } else if (family === 'slash' || family === 'melee' || family === 'dash') {
    const center = at(ease(travel))
    if (family === 'dash') {
      for (let i = 0; i < 7; i++) {
        const offset = (i - 3) * size * .25
        const a = at(Math.max(0, travel - .23 - noise(seed, i) * .15), offset)
        const b = at(travel, offset)
        line(ctx, [[a.x, a.y], [b.x, b.y]], palette[i % 3], i % 3 ? 1 : 3, .7)
      }
      if (signature === 'comet') spark(ctx, center.x, center.y, size * .8, palette[2], .85)
    } else if (family === 'slash') {
      const slices = signature === 'cross-cut' ? 2 : signature === 'shadow-claw' ? 3 : 1
      for (let i = 0; i < slices; i++) {
        const beat = interval(p, release + i * .09, arrival + i * .04)
        blade(ctx, target.x + (i - (slices - 1) / 2) * size * .35, target.y,
          size * (1.15 + beat), signature === 'cross-cut' ? (i ? .7 : -.7) : -.6,
          palette, Math.sin(beat * Math.PI))
      }
    } else if (signature === 'fangs') {
      const close = Math.sin(travel * Math.PI)
      for (let i = -1; i <= 1; i++) {
        shard(ctx, target.x + i * size * .6, target.y - size * (1.25 - close * .7), size * .55, palette[2], 0, close)
        shard(ctx, target.x + i * size * .6, target.y + size * (1.25 - close * .7), size * .55, palette[0], 0, close)
      }
    } else {
      const beats = signature === 'fist-barrage' ? [0, .13, .31, .4, .58] : [0, .26, .5]
      beats.forEach((beat, i) => {
        const t = interval(travel, beat, beat + .28)
        const x = target.x + (noise(seed, i) - .5) * size * 1.9
        const y = target.y + (noise(seed, i + 10) - .5) * size * 1.4
        spark(ctx, x, y, size * (.4 + t * .6), palette[i % 3], Math.sin(t * Math.PI))
      })
    }
  } else if (family === 'heal' || family === 'boost') {
    aura(ctx, target, size, interval(p, anticipation, settle), palette, signature, seed, recipe.supportive)
  } else if (family === 'barrier') {
    shield(ctx, target, size * 1.1, interval(p, anticipation, settle), palette, signature === 'light-wall')
  } else if (family === 'wave' || family === 'vortex') {
    if (signature === 'sound-ring') {
      for (let i = 0; i < 5; i++) {
        const t = interval(travel, i * .12, .55 + i * .1)
        const point = at(t)
        ring(ctx, point.x, point.y, size * (.5 + t * 1.5), palette[i % 3], 2, Math.sin(t * Math.PI), .42, angle + Math.PI / 2)
      }
    } else if (family === 'wave' && signature !== 'petal') {
      const center = at(ease(travel))
      for (let row = 0; row < 3; row++) {
        const points = Array.from({ length: 26 }, (_, i) => {
          const x = center.x + (i / 25 - .5) * size * 5
          return [x, center.y + Math.sin(i * .48 - p * 10 + row) * size * .28 + row * size * .3]
        })
        line(ctx, points, palette[row === 0 ? 2 : 0], row === 0 ? 2 : 5, .75 - row * .14)
      }
    } else {
      for (let i = 0; i < 24; i++) {
        const h = i / 24
        const theta = h * TAU * 2.4 - p * 8
        const radius = size * (.4 + h * 1.6)
        const x = target.x + Math.cos(theta) * radius
        const y = target.y + size - h * size * 3 + Math.sin(theta) * size * .25
        if (signature === 'leaf-spiral' || signature === 'petal') shard(ctx, x, y, size * .25, palette[i % 3], theta, .75)
        else line(ctx, [[x, y], [x - Math.sin(theta) * size * .4, y + Math.cos(theta) * size * .12]], palette[i % 3], 2, .6)
      }
    }
  } else if (family === 'meteor' || family === 'eruption' || family === 'burst') {
    if (signature === 'fire-cross') {
      const s = size * (1 + travel * 1.4)
      const arms = [[[-.7, -.35], [.7, -.35]], [[0, -.8], [-.15, .1], [-.8, .8]], [[-.02, -.05], [.8, .8]]]
      arms.forEach((arm) => {
        const points = arm.map(([x, y]) => [target.x + x * s, target.y + y * s])
        line(ctx, points, palette[1], size * .34, .35)
        line(ctx, points, palette[0], size * .22, .95)
        line(ctx, points, palette[2], size * .07, .95)
        for (let j = 0; j < arm.length - 1; j++) for (let i = 0; i < 6; i++) {
          const t = i / 5
          const x = mix(points[j][0], points[j + 1][0], t)
          const y = mix(points[j][1], points[j + 1][1], t)
          const height = size * (.12 + noise(seed + Math.floor(p * 10), i + j * 10) * .18)
          shard(ctx, x, y - height * .4, height, palette[i % 2], .1, .85, .6)
        }
      })
    } else if (signature === 'ground-fissure') {
      for (let i = 0; i < 5; i++) {
        const points = Array.from({ length: 7 }, (_, j) => [target.x + (j - 3) * size * .7,
          target.y + size * .6 + (noise(seed + i, j) - .5) * size * .6 + i * 5])
        line(ctx, points, palette[1], 5, .8)
        line(ctx, points, palette[0], 1.5, .8)
      }
    } else if (family === 'meteor') {
      for (let i = 0; i < 7; i++) {
        const t = interval(p, release + i * .025, Math.min(.98, arrival + i * .02))
        if (t <= 0 || t >= 1) continue
        const x = target.x + (noise(seed, i) - .5) * size * 3 + (1 - t) * size * 1.8
        const y = mix(-size, target.y + (noise(seed, i + 10) - .5) * size, t)
        line(ctx, [[x + size * .7, y - size * 2], [x, y]], palette[0], 4, .3)
        if (signature === 'star-fall') spark(ctx, x, y, size * .45, palette[2], .9)
        else shard(ctx, x, y, size * .55, palette[i % 2], .5, .9, .85)
        if (signature === 'dragon-meteor') {
          glow(ctx, x, y, size, palette[0], .35)
          disc(ctx, x, y, size * .18, palette[2], .9)
        }
      }
    } else {
      for (let i = 0; i < 5; i++) {
        const t = interval(travel, i * .08, .6 + i * .08)
        const x = target.x + (noise(seed, i) - .5) * size * 2
        const y = target.y - (family === 'eruption' ? ease(t) * size * 2 : 0)
        glow(ctx, x, y, size * (1 + t), palette[0], Math.sin(t * Math.PI) * .35)
        ring(ctx, x, y, size * (.4 + t * 1.8), palette[i % 3], 3, Math.sin(t * Math.PI) * .8)
      }
      motes(ctx, target, size * 1.5, count, travel, palette, seed)
      if (signature === 'prism') for (let i = 0; i < 7; i++) {
        const theta = i * TAU / 7 + p * .4
        const colors = ['#ff8ba5', '#ffd886', '#f5ffae', '#7dedc1', '#7bdcff', '#ada3ff', '#f7afff']
        const radius = size * (1 + ease(travel) * 2)
        line(ctx, [[target.x + Math.cos(theta) * size * .3, target.y + Math.sin(theta) * size * .3],
          [target.x + Math.cos(theta) * radius, target.y + Math.sin(theta) * radius]], colors[i], 3, .7)
      }
    }
  } else if (family === 'status') {
    const envelope = Math.sin(interval(p, anticipation, settle) * Math.PI)
    if (signature === 'seed-vine') {
      for (let i = 0; i < 3; i++) {
        const points = Array.from({ length: 18 }, (_, j) => {
          const f = j / 17
          return [target.x + Math.sin(f * TAU + i * 2 + p) * size * (.8 - f * .3), target.y + size - f * size * 2]
        })
        line(ctx, points, palette[1], 3, envelope)
        line(ctx, points, palette[0], 1, envelope)
        const [x, y] = points[12]
        shard(ctx, x, y, size * .3, palette[0], i * .8, envelope, .7)
      }
    } else if (signature === 'hex-web') {
      for (let i = 0; i < 8; i++) {
        const theta = i * TAU / 8
        line(ctx, [[target.x, target.y], [target.x + Math.cos(theta) * size * 1.7,
          target.y + Math.sin(theta) * size * 1.2]], palette[0], 1, envelope * .7)
      }
      for (let i = 1; i <= 3; i++) ring(ctx, target.x, target.y, size * i * .55, palette[2], 1, envelope * .7, .7)
    } else {
      for (let i = 0; i < 8; i++) {
        const theta = i * 2.4 + p * 2
        const x = target.x + Math.cos(theta) * size * 1.3
        const y = target.y + Math.sin(theta) * size * .5 - travel * size * 1.2
        if (signature === 'sleep-mote') {
          ctx.fillStyle = palette[i % 3]
          ctx.globalAlpha = active * envelope * .85
          ctx.font = `bold ${Math.round(size * (.35 + i % 3 * .08))}px monospace`
          ctx.fillText('Z', Math.round(x), Math.round(y))
        } else if (signature === 'ghost-flame') shard(ctx, x, y, size * .4, palette[i % 2], p * .2, envelope, .7)
        else disc(ctx, x, y, size * (.12 + i % 3 * .06), palette[i % 3], envelope * .8)
      }
    }
  } else if (family === 'field') {
    const fieldSize = Math.min(width * .38, size * 6)
    ring(ctx, target.x, target.y, fieldSize * (.65 + travel * .35), palette[0], 2, .6, .28)
    if (signature === 'hex-web') {
      for (let i = 0; i < 12; i++) {
        const theta = i * TAU / 12
        line(ctx, [[target.x, target.y], [target.x + Math.cos(theta) * fieldSize,
          target.y + Math.sin(theta) * fieldSize * .3]], palette[2], 1, .55)
      }
      for (let i = 1; i < 4; i++) ring(ctx, target.x, target.y, fieldSize * i / 4, palette[2], 1, .5, .3)
    }
    if (signature === 'terrain') {
      for (let i = -3; i <= 3; i++) line(ctx, [[target.x - fieldSize, target.y + i * size * .22],
        [target.x + fieldSize, target.y + i * size * .22]], palette[0], 1, .2)
    }
    for (let i = 0; i < Math.min(count, 24); i++) {
      const x = target.x + (noise(seed, i) - .5) * fieldSize * 2
      const y = target.y + (noise(seed, i + 32) - .5) * size * 2 - travel * size * .6
      if (signature === 'hazard') shard(ctx, x, y, size * .35, palette[i % 3], 0, .8, .7)
      else if (cue.moveType === '물') line(ctx, [[x + 3, y - size * .5], [x, y]], palette[2], 1, .65)
      else spark(ctx, x, y, size * .12, palette[i % 3], .55)
    }
  }
  ctx.restore()
}
