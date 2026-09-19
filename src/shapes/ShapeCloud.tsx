import { BaseShape } from './BaseShape'
import type { ShapeProps } from './Shape'

// Loose cloud silhouette (4 bumps). Used for external / unknown nodes.
const cloudPath =
  'M -0.95 0.18 ' +
  'C -1.05 -0.05, -0.85 -0.32, -0.55 -0.30 ' +
  'C -0.5 -0.55, -0.15 -0.65, 0.08 -0.45 ' +
  'C 0.32 -0.65, 0.7 -0.5, 0.7 -0.18 ' +
  'C 1.05 -0.12, 1.05 0.34, 0.65 0.40 ' +
  'C 0.55 0.62, 0.05 0.65, -0.10 0.45 ' +
  'C -0.35 0.65, -0.85 0.55, -0.85 0.25 ' +
  'C -1.02 0.22, -1.02 0.20, -0.95 0.18 Z'

export function ShapeCloud(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <path d={cloudPath} {...attrs} />}
    />
  )
}
