import type { AgentcellRole, FieldNode } from '../types'
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

/**
 * Infrastructure vocabulary → shape. Mirrors Scope's conventions so a
 * k8s-shaped field still reads the way Scope users expect.
 */
export function shapeForKind(kind: string): ShapeKind {
  switch (kind) {
    case 'pod':
    case 'container':
      return 'hexagon'
    case 'process':
      return 'square'
    case 'service':
      return 'heptagon'
    case 'host':
      return 'cylinder'
    case 'controller':
      return 'sheet'
    case 'external':
      return 'cloud'
    case 'bundle':
      return 'octagon'
    default:
      return 'circle'
  }
}

/**
 * Agentcell vocabulary → shape (STATEMENT §5). Deliberately parallel to
 * `shapeForKind` rather than merged into it: the same canvas has to render
 * both an infrastructure topology and a Semantic Control Field, and collapsing
 * the two vocabularies into one switch is how the k8s shape of things leaks
 * into the semantic view.
 */
export function shapeForAgentcellRole(role: AgentcellRole): ShapeKind {
  switch (role) {
    case 'dataset':
      return 'cylinder'
    case 'index':
      return 'sheet'
    case 'semantic-processor':
      return 'hexagon'
    case 'workflow-controller':
      return 'octagon'
    case 'policy-authority':
      return 'pentagon'
    case 'telemetry-producer':
      return 'triangle'
    case 'reasoning':
      return 'heptagon'
    default:
      return 'circle'
  }
}

/** Role wins when present, otherwise fall back to the kind vocabulary. */
export const defaultShapeResolver: ShapeResolver = (node) =>
  node.role ? shapeForAgentcellRole(node.role) : shapeForKind(node.kind)

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
