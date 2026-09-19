import { BaseShape } from './BaseShape'
import { curvedUnitPolygonPath, type ShapeProps } from './Shape'

const path = curvedUnitPolygonPath(7)

export function ShapeHeptagon(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <path d={path} {...attrs} />}
    />
  )
}
