import { BaseShape } from './BaseShape'
import type { ShapeProps } from './Shape'

export function ShapeCircle(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <circle r={1} {...attrs} />}
    />
  )
}
