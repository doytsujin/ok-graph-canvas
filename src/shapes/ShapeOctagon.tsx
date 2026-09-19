import { BaseShape } from './BaseShape'
import { curvedUnitPolygonPath, type ShapeProps } from './Shape'

const path = curvedUnitPolygonPath(8)

export function ShapeOctagon(props: ShapeProps) {
  return (
    <BaseShape
      {...props}
      renderTemplate={(attrs) => <path d={path} {...attrs} />}
    />
  )
}
