import { BaseShape } from './BaseShape'
import type { ShapeProps } from './Shape'

// Cylinder profile (host-style): tall rectangle with elliptical top + bottom.
// Drawn so the bounding box ~= the unit circle.
const cylinderPath =
  'M -0.7 -0.7 ' +
  'A 0.7 0.18 0 1 1 0.7 -0.7 ' +
  'L 0.7 0.7 ' +
  'A 0.7 0.18 0 1 1 -0.7 0.7 ' +
  'L -0.7 -0.7 Z ' +
  'M -0.7 -0.7 ' +
  'A 0.7 0.18 0 1 0 0.7 -0.7'

export function ShapeCylinder(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <path d={cylinderPath} {...attrs} />}
    />
  )
}
