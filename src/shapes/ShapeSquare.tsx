import { BaseShape } from './BaseShape'
import { curvedUnitPolygonPath, type ShapeProps } from './Shape'

const path = curvedUnitPolygonPath(4)

export function ShapeSquare(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <path d={path} {...attrs} />}
    />
  )
}
