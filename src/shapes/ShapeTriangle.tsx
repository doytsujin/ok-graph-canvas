import { BaseShape } from './BaseShape'
import { curvedUnitPolygonPath, type ShapeProps } from './Shape'

const path = curvedUnitPolygonPath(3)

export function ShapeTriangle(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <path d={path} {...attrs} />}
    />
  )
}
