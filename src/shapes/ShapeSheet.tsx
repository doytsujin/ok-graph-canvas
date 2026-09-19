import { BaseShape } from './BaseShape'
import type { ShapeProps } from './Shape'

// Document/sheet glyph for service / controller nodes.
const sheetPath = 'M -0.7 -0.85 L 0.5 -0.85 L 0.7 -0.65 L 0.7 0.85 L -0.7 0.85 Z'

export function ShapeSheet(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <path d={sheetPath} {...attrs} />}
    />
  )
}
