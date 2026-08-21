/**
 * Stroke geometry, expanded into the filled paths the house style is drawn in.
 *
 * Every glyph the harness ships renders as one `fill="currentColor"` path with
 * the stroke already expanded — no `stroke` attribute, no `stroke-width`, no
 * caps or joins for a renderer to interpret. Its own source says so where it
 * describes the session-tree connector as "stroke geometry pre-expanded", and
 * 69 of its 70 glyphs are drawn that way.
 *
 * Authoring the glyphs that set does not carry the same way by hand means
 * writing rotated quadrilaterals for every diagonal, which is the kind of
 * arithmetic that looks right and is off by a hundredth. So the glyphs here are
 * authored as the strokes they are — polylines, rings, rectangles — and this
 * turns them into the same filled outlines, once, mechanically.
 *
 * The expansion is exact rather than approximate: a segment of width `w` is the
 * rectangle its two offset edges bound, and a corner is the point where the two
 * outer edges actually meet. Nothing here rasterises or samples.
 */

/** The stroke every glyph in `drawn.js` is authored at, on a 16-unit grid. */
export const STROKE = 1.3

/** How far a corner may spike before it is cut off, as SVG's miterlimit does. */
const MITER_LIMIT = 4

/** Round to a tenth of a thousandth — past what a 16px grid can show. */
const r = (n) => Math.round(n * 10000) / 10000

/** @returns {[number, number]} `[x, y]` scaled to unit length, or `[0, 0]`. */
const unit = (x, y) => {
  const length = Math.hypot(x, y)
  return length === 0 ? [0, 0] : [x / length, y / length]
}

/**
 * One polyline, as the outline the stroke covers.
 *
 * Walks the two sides in opposite directions — down the left edge and back up
 * the right — so the result is a single closed ring rather than one quad per
 * segment. Overlapping quads would fill identically under `nonzero` and cancel
 * under `evenodd`, and the rings below need `evenodd`; one ring per stroke
 * keeps both rules agreeing about what is inside.
 *
 * @param {number[]} points - flat `x, y, x, y, …`, at least two points.
 * @param {number} width - the stroke width.
 * @param {boolean} closed - whether the last point joins back to the first.
 * @returns {string} the path data.
 */
export const stroke = (points, width, closed = false) => {
  const p = []
  for (let i = 0; i < points.length; i += 2) p.push([points[i], points[i + 1]])
  if (closed && (p[0][0] !== p.at(-1)[0] || p[0][1] !== p.at(-1)[1])) p.push([...p[0]])
  const half = width / 2

  /** The offset of the joint at `i`, on the side `sign` names. */
  const offset = (i, sign) => {
    const before = i === 0 ? (closed ? p.at(-2) : undefined) : p[i - 1]
    const after = i === p.length - 1 ? (closed ? p[1] : undefined) : p[i + 1]
    const [x, y] = p[i]
    // An end: square to the one segment that touches it, which is a butt cap.
    if (before === undefined || after === undefined) {
      const [ax, ay] = before ?? p[i]
      const [bx, by] = after ?? p[i]
      const [dx, dy] = unit(bx - ax, by - ay)
      return [x + sign * -dy * half, y + sign * dx * half]
    }
    // A joint: where the two offset edges meet. The miter runs along the
    // bisector, and its length is what grows without bound as the turn
    // closes — so past the limit it is cut back to the bevel's own corner,
    // which is the offset of the outgoing edge.
    const [ix, iy] = unit(x - before[0], y - before[1])
    const [ox, oy] = unit(after[0] - x, after[1] - y)
    const [mx, my] = unit(-iy + -oy, ix + ox)
    const cosine = mx * -iy + my * ix
    if (Math.abs(cosine) < 1e-6 || 1 / Math.abs(cosine) > MITER_LIMIT) {
      return [x + sign * -oy * half, y + sign * ox * half]
    }
    const length = half / cosine
    return [x + sign * mx * length, y + sign * my * length]
  }

  const left = p.map((_, i) => offset(i, 1))
  const right = p.map((_, i) => offset(i, -1)).reverse()
  const ring = [...left, ...right]
  return ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r(x)} ${r(y)}`).join('') + 'Z'
}

/**
 * A circle as two concentric rings, outer then inner.
 *
 * Wound the same way and read under `evenodd`, which is what leaves the middle
 * open. Four arcs rather than two, because a single arc spanning the full
 * circle has identical endpoints and no defined sweep.
 *
 * @param {number} cx - centre x.
 * @param {number} cy - centre y.
 * @param {number} radius - the centreline radius.
 * @param {number} width - the stroke width.
 * @returns {string} the path data.
 */
export const ring = (cx, cy, radius, width) => {
  const circle = (rad) => `M${r(cx - rad)} ${r(cy)}`
    + `A${r(rad)} ${r(rad)} 0 0 1 ${r(cx + rad)} ${r(cy)}`
    + `A${r(rad)} ${r(rad)} 0 0 1 ${r(cx - rad)} ${r(cy)}Z`
  return circle(radius + width / 2) + circle(radius - width / 2)
}

/**
 * A filled disc, for the places a glyph wants a dot rather than a ring.
 *
 * @param {number} cx - centre x.
 * @param {number} cy - centre y.
 * @param {number} radius - the disc's radius.
 * @returns {string} the path data.
 */
export const dot = (cx, cy, radius) => `M${r(cx - radius)} ${r(cy)}`
  + `A${r(radius)} ${r(radius)} 0 0 1 ${r(cx + radius)} ${r(cy)}`
  + `A${r(radius)} ${r(radius)} 0 0 1 ${r(cx - radius)} ${r(cy)}Z`

/**
 * A rectangle's outline, as two concentric rectangles read under `evenodd`.
 *
 * @param {number} x - left edge of the centreline.
 * @param {number} y - top edge of the centreline.
 * @param {number} w - centreline width.
 * @param {number} h - centreline height.
 * @param {number} width - the stroke width.
 * @returns {string} the path data.
 */
export const box = (x, y, w, h, width) => {
  const half = width / 2
  const at = (l, t, rt, b) => `M${r(l)} ${r(t)}L${r(rt)} ${r(t)}L${r(rt)} ${r(b)}L${r(l)} ${r(b)}Z`
  return at(x - half, y - half, x + w + half, y + h + half)
    + at(x + half, y + half, x + w - half, y + h - half)
}
