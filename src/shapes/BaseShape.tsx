import React from 'react'
import type { ShapeProps } from './Shape'

type RenderTemplate = (
  attrs: React.SVGAttributes<SVGGeometryElement>,
) => React.ReactElement

type Props = ShapeProps & {
  renderTemplate: RenderTemplate
}

/**
 * Layered SVG composition for a graph node:
 *   highlight border → background → metric fill (clipped) → shadow → border → anchor.
 * Ported from weaveworks-ui-components/GraphNode/shapes/_BaseShape.js, simplified
 * (no styled-components, no Immutable).
 */
export function BaseShape(props: Props): React.ReactElement {
  const {
    renderTemplate,
    id,
    color,
    highlighted = false,
    elevation = 0,
    contrastMode = false,
    size = 1,
    metricNumericValue = null,
    metricColor,
    metricFormattedValue,
  } = props

  const hasMetric =
    metricFormattedValue != null &&
    metricFormattedValue !== '' &&
    typeof metricNumericValue === 'number'

  const clipId = `metric-clip-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`
  const anchorFill = contrastMode ? '#000' : '#5b21b6'
  const shadowColor = 'rgba(15, 23, 42, 0.18)'

  return (
    <g transform={`scale(${size})`}>
      {highlighted && (
        <g>
          {renderTemplate({
            fill: 'none',
            stroke: contrastMode ? '#000' : '#7c1e42',
            strokeWidth: 0.22,
            strokeOpacity: 0.35,
          })}
          {renderTemplate({
            fill: 'none',
            stroke: contrastMode ? '#000' : '#7c1e42',
            strokeWidth: 0.12,
            strokeOpacity: 0.6,
          })}
        </g>
      )}

      {/* Elevation: an offset silhouette under the shape. No filter. */}
      {elevation > 0 &&
        renderTemplate({
          fill: elevation === 2 ? 'rgba(15, 23, 42, 0.28)' : 'rgba(15, 23, 42, 0.16)',
          stroke: 'none',
          transform: `translate(0, ${elevation === 2 ? 0.1 : 0.05})`,
        })}

      {/* background fill */}
      {renderTemplate({
        fill: '#ffffff',
        stroke: 'none',
      })}

      {hasMetric && (
        <>
          <defs>
            <clipPath id={clipId} transform="scale(0.96)">
              <rect
                width={2}
                height={2}
                x={-1}
                y={1 - 2 * (metricNumericValue as number)}
              />
            </clipPath>
          </defs>
          {renderTemplate({
            fill: metricColor ?? color,
            opacity: 0.85,
            clipPath: `url(#${clipId})`,
          })}
        </>
      )}

      {/* drop shadow (thin offset line) */}
      {renderTemplate({
        fill: 'none',
        stroke: shadowColor,
        strokeWidth: 0.04,
        transform: 'translate(0, 0.04)',
      })}

      {/* primary border */}
      {renderTemplate({
        fill: 'none',
        stroke: color,
        strokeWidth: 0.075,
      })}

      {/* anchor dot in the center */}
      <circle r={0.1} strokeWidth={0.005} fill={anchorFill} stroke="#fff" />

      {hasMetric && highlighted && (
        <text
          dominantBaseline="middle"
          textAnchor="middle"
          transform="scale(0.015)"
          fill={anchorFill}
        >
          {metricFormattedValue}
        </text>
      )}
    </g>
  )
}
