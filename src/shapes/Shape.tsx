import { line, curveCardinalClosed } from 'd3-shape'
import { range } from 'lodash-es'

/**
 * Generates a rounded (cardinal-curve-closed) polygon path centered at origin
 * inscribed in the unit circle. n = number of sides.
 * Ported from weaveworks-ui-components/GraphNode/shapes/_Shape.js
 */
export function curvedUnitPolygonPath(n: number): string {
  const curve = curveCardinalClosed.tension(0.65)
  const spline = line<[number, number]>().curve(curve)
  const innerAngle = 2 * (Math.PI / n)
  const points: [number, number][] = range(0, n).map((k) => [
    Math.sin(k * innerAngle),
    -Math.cos(k * innerAngle),
  ])
  return spline(points) ?? ''
}

export type ShapeProps = {
  id: string
  color: string
  highlighted?: boolean
  /**
   * 0 none, 1 a linked node, 2 the selected one.
   *
   * Drawn as an offset copy of the shape rather than with a CSS filter.
   * `drop-shadow` is rasterised on the CPU in Firefox and is re-run on every
   * repaint, so a handful of shadowed nodes next to anything that animates
   * costs a continuous slice of a core. A second path costs one more path.
   */
  elevation?: 0 | 1 | 2
  contrastMode?: boolean
  size?: number
  metricNumericValue?: number | null
  metricColor?: string
  metricFormattedValue?: string
}
