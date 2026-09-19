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
  contrastMode?: boolean
  size?: number
  metricNumericValue?: number | null
  metricColor?: string
  metricFormattedValue?: string
}
