import { BaseShape } from './BaseShape'
import { curvedUnitPolygonPath, type ShapeProps } from './Shape'

const path = curvedUnitPolygonPath(6)

export function ShapeHexagon(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <path d={path} {...attrs} />}
    />
  )
}
