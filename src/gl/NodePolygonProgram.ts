/**
 * A sigma node program that draws this package's shape vocabulary in WebGL.
 *
 * Ported from `dk-semantic-gateway-v2`, where the same problem — thousands of
 * typed nodes an SVG renderer cannot draw at speed — was already solved. The
 * shader is that one, with the shape lookup pointed at this package's
 * `ShapeResolver` instead of the gateway's entity kinds.
 *
 * The shape is a signed-distance polygon computed in the fragment shader, not
 * an image sprite. That matters for more than speed: sprites load
 * asynchronously, so a sprite-based renderer shows a field of plain circles
 * that turn into shapes a moment later, and the picture changes under the
 * reader.
 */
import { NodeProgram } from 'sigma/rendering'
import { floatColor } from 'sigma/utils'
import type { ShapeKind } from '../shapes'

/** Regular-polygon side count per shape. 0 draws a circle. */
export function sidesForShape(kind: ShapeKind): number {
  switch (kind) {
    case 'triangle': return 3
    case 'square': return 4
    case 'pentagon': return 5
    case 'hexagon': return 6
    case 'heptagon': return 7
    case 'octagon': return 8
    // Cloud, cylinder and sheet have no regular-polygon equivalent and draw as
    // circles. That is a real loss of information, and it is why this renderer
    // sits beside the SVG one rather than replacing it.
    default: return 0
  }
}

/**
 * Proportions relative to the disc radius, so they hold at any size. Chosen to
 * match what `BaseShape` draws: a light disc, a faint ring at its edge, and
 * the typed shape as a coloured outline inside it.
 */
const PR = (0.62).toFixed(4)
const SW = (0.16 / 2).toFixed(4)
const RW = (0.07 / 2).toFixed(4)
const RO = (0.35).toFixed(3)

const VERTEX_SHADER = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;
attribute float a_sides;
uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_sides;
const float bias = 255.0 / 254.0;
void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4((u_matrix * vec3(position, 1)).xy, 0, 1);
  v_diffVector = diffVector;
  v_radius = size / 2.0;
  v_sides = a_sides;
  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}
`

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_sides;
uniform float u_correctionRatio;
const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

// Signed distance to a regular polygon of circumradius r with n sides, one
// vertex pointing up. Fewer than three sides means a circle.
float polyDist(vec2 p, float r, float n) {
  float d = length(p);
  if (n < 2.5) return d - r;
  float seg = 6.283185307179586 / n;
  float a = atan(p.y, p.x) + 1.570796326794897;
  float a2 = mod(a, seg) - seg * 0.5;
  float edge = r * cos(seg * 0.5) / max(cos(a2), 0.001);
  return d - edge;
}

void main(void) {
  float aa = u_correctionRatio * 2.0;
  float r = v_radius;
  float discD = length(v_diffVector) - r;
  #ifdef PICKING_MODE
  if (discD > aa) gl_FragColor = transparent;
  else gl_FragColor = v_color;
  #else
  if (discD > aa) {
    gl_FragColor = transparent;
  } else {
    vec4 col = vec4(v_color.rgb, v_color.a);
    vec4 out_c = vec4(1.0, 1.0, 1.0, v_color.a);
    float ringW = max(r * ${RW}, aa);
    float ringA = (1.0 - smoothstep(ringW, ringW + aa, abs(discD))) * ${RO};
    out_c = mix(out_c, col, ringA);
    float pr = r * ${PR};
    float pd = polyDist(v_diffVector, pr, v_sides);
    float sw = max(r * ${SW}, aa);
    float strokeA = 1.0 - smoothstep(sw, sw + aa, abs(pd));
    out_c = mix(out_c, col, strokeA);
    float discAA = clamp((discD + aa) / aa, 0.0, 1.0);
    gl_FragColor = mix(out_c, transparent, discAA);
  }
  #endif
}
`

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext
const ANGLE_1 = 0
const ANGLE_2 = (2 * Math.PI) / 3
const ANGLE_3 = (4 * Math.PI) / 3

export class NodePolygonProgram extends NodeProgram<
  'u_sizeRatio' | 'u_correctionRatio' | 'u_matrix'
> {
  getDefinition() {
    return {
      VERTICES: 3,
      VERTEX_SHADER_SOURCE: VERTEX_SHADER,
      FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
      METHOD: WebGLRenderingContext.TRIANGLES,
      UNIFORMS: ['u_sizeRatio', 'u_correctionRatio', 'u_matrix'] as const,
      ATTRIBUTES: [
        { name: 'a_position', size: 2, type: FLOAT },
        { name: 'a_size', size: 1, type: FLOAT },
        { name: 'a_color', size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: 'a_id', size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: 'a_sides', size: 1, type: FLOAT },
      ],
      CONSTANT_ATTRIBUTES: [{ name: 'a_angle', size: 1, type: FLOAT }],
      CONSTANT_DATA: [[ANGLE_1], [ANGLE_2], [ANGLE_3]],
    }
  }

  processVisibleItem(nodeIndex: number, startIndex: number, data: any) {
    const array = this.array
    array[startIndex++] = data.x
    array[startIndex++] = data.y
    array[startIndex++] = data.size
    array[startIndex++] = floatColor(data.color)
    array[startIndex++] = nodeIndex
    array[startIndex++] = typeof data.sides === 'number' ? data.sides : 0
  }

  setUniforms(params: any, { gl, uniformLocations }: any) {
    const { u_sizeRatio, u_correctionRatio, u_matrix } = uniformLocations
    gl.uniform1f(u_sizeRatio, params.sizeRatio)
    gl.uniform1f(u_correctionRatio, params.correctionRatio)
    gl.uniformMatrix3fv(u_matrix, false, params.matrix)
  }
}
