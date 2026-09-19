import type { FieldNode } from '../types'
import type { ShapeProps } from './Shape'
import { ShapeOctagon } from './ShapeOctagon'
import { ShapeHexagon } from './ShapeHexagon'
import { ShapePentagon } from './ShapePentagon'
import { ShapeHeptagon } from './ShapeHeptagon'
import { ShapeSquare } from './ShapeSquare'
import { ShapeTriangle } from './ShapeTriangle'
import { ShapeCircle } from './ShapeCircle'
import { ShapeCloud } from './ShapeCloud'
import { ShapeCylinder } from './ShapeCylinder'
import { ShapeSheet } from './ShapeSheet'

export {
  ShapeOctagon,
  ShapeHexagon,
  ShapePentagon,
  ShapeHeptagon,
  ShapeSquare,
  ShapeTriangle,
  ShapeCircle,
  ShapeCloud,
  ShapeCylinder,
  ShapeSheet,
}

export type ShapeKind =
  | 'octagon'
  | 'hexagon'
  | 'pentagon'
  | 'heptagon'
  | 'square'
  | 'triangle'
  | 'circle'
  | 'cloud'
  | 'cylinder'
  | 'sheet'

/** Picks the shape for a node. Supply your own to bring a different vocabulary. */
export type ShapeResolver = (node: FieldNode) => ShapeKind

export const SHAPE_KINDS: ShapeKind[] = [
  'circle',
  'hexagon',
  'square',
  'heptagon',
  'cylinder',
  'sheet',
  'octagon',
  'triangle',
  'pentagon',
  'cloud',
]

/**
 * The default resolver knows no vocabulary, and that is the point.
 *
 * It used to carry two: an infrastructure one mapping pod/container/service/
 * host, and a platform one mapping seven agent roles. Both were overridable, so
 * neither ever misbehaved -- but a package whose headline claim is that it does
 * not know what it is drawing cannot ship a switch statement listing the things
 * it knows. Overridable is not the same as absent, and the claim is checkable by
 * opening this file. Those vocabularies are a host concern now; the README shows
 * the four lines that reproduce either.
 *
 * What replaces them still has to be useful, because a resolver that returns one
 * shape for everything makes every node identical. So the shape is chosen by
 * hashing the kind string: distinct kinds get distinct shapes, the same kind
 * always gets the same shape across renders and reloads, and the package still
 * has no idea what any of them mean.
 */
export const defaultShapeResolver: ShapeResolver = (node) => {
  const key = node.role ?? node.kind ?? ''
  if (!key) return 'circle'
  // FNV-1a, for a stable spread that does not depend on string length alone.
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return SHAPE_KINDS[h % SHAPE_KINDS.length]
}

export function NodeShape(props: ShapeProps & { kind: ShapeKind }) {
  const { kind, ...rest } = props
  switch (kind) {
    case 'octagon':
      return <ShapeOctagon {...rest} />
    case 'hexagon':
      return <ShapeHexagon {...rest} />
    case 'pentagon':
      return <ShapePentagon {...rest} />
    case 'heptagon':
      return <ShapeHeptagon {...rest} />
    case 'square':
      return <ShapeSquare {...rest} />
    case 'triangle':
      return <ShapeTriangle {...rest} />
    case 'circle':
      return <ShapeCircle {...rest} />
    case 'cloud':
      return <ShapeCloud {...rest} />
    case 'cylinder':
      return <ShapeCylinder {...rest} />
    case 'sheet':
      return <ShapeSheet {...rest} />
  }
}
