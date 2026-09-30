/**
 * Wall geometry derived from the wall map, in floor pixels. The numbers come from the art contract
 * (src/game/artContract.ts): walls sit on the office's 32px grid, not on the 96px floor-motif grid
 * the art was first drawn for. A wall is WALL_THICKNESS thick and
 * centered on its grid line. Every vertex with at least one wall gets a JOINT_SIZE square joint
 * centered on it, shaped by which of its four sides connect to a wall; between two vertices the
 * visible body covers the BODY_LENGTH left over, so joints and bodies tile each wall exactly once.
 * These rectangles are the wall's footprint: later collision code should use them, not sprite pixels.
 */
import { WALL } from '../../../src/game/artContract.ts';
import {
  DIRECTIONS,
  edgeFrom,
  edgeVertices,
  type Direction,
  type GridEdge,
  type GridVertex,
  type WallMap,
  type WallMaterial,
} from './wallMap.ts';

export const WALL_THICKNESS = WALL.thickness;
export const HALF_THICKNESS = WALL_THICKNESS / 2;
export const JOINT_SIZE = WALL.jointSize;
/** Distance between two vertices: the logical length of one wall. */
export const SEGMENT_LENGTH = WALL.segmentLength;
export const BODY_LENGTH = SEGMENT_LENGTH - JOINT_SIZE;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Bit per connected side: north 1, east 2, south 4, west 8. */
export type ConnectionMask = number;

export const DIRECTION_BIT: Readonly<Record<Direction, number>> = { north: 1, east: 2, south: 4, west: 8 };

export function connects(mask: ConnectionMask, direction: Direction): boolean {
  return (mask & DIRECTION_BIT[direction]) !== 0;
}

export function maskOf(directions: readonly Direction[]): ConnectionMask {
  return directions.reduce((mask, direction) => mask | DIRECTION_BIT[direction], 0);
}

export const JOINT_SHAPES = ['end', 'straight', 'corner', 'tee', 'cross'] as const;
export type JointShape = (typeof JOINT_SHAPES)[number];

/**
 * Each shape in its reference orientation (end ╵, straight │, corner └, tee ├, cross ┼); a joint
 * is its reference shape turned `rotation` quarter turns clockwise.
 */
const REFERENCE_MASK: Readonly<Record<JointShape, ConnectionMask>> = {
  end: maskOf(['north']),
  straight: maskOf(['north', 'south']),
  corner: maskOf(['north', 'east']),
  tee: maskOf(['north', 'east', 'south']),
  cross: maskOf(['north', 'east', 'south', 'west']),
};

export type Rotation = 0 | 1 | 2 | 3;

/** One quarter turn clockwise: north goes east, east goes south, and so on. */
export function rotateMask(mask: ConnectionMask, turns: number): ConnectionMask {
  let out = mask;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) out = ((out << 1) | (out >> 3)) & 0b1111;
  return out;
}

export interface JointKind {
  readonly shape: JointShape;
  readonly rotation: Rotation;
}

/** Shape of a vertex from its connections; undefined when nothing connects and no joint is drawn. */
export function classifyJoint(mask: ConnectionMask): JointKind | undefined {
  if (!Number.isInteger(mask) || mask < 0 || mask > 0b1111) throw new Error(`Invalid connection mask ${mask}`);
  for (const shape of JOINT_SHAPES) {
    for (const rotation of [0, 1, 2, 3] as const) if (rotateMask(REFERENCE_MASK[shape], rotation) === mask) return { shape, rotation };
  }
  return undefined;
}

export interface WallJoint extends JointKind {
  readonly vertex: GridVertex;
  readonly mask: ConnectionMask;
  readonly material: WallMaterial;
  readonly rect: Rect;
}

export interface WallBody {
  readonly edge: GridEdge;
  readonly material: WallMaterial;
  readonly rect: Rect;
}

export interface WallGeometry {
  readonly joints: readonly WallJoint[];
  readonly bodies: readonly WallBody[];
}

export class WallMaterialConflictError extends Error {
  readonly vertex: GridVertex;

  constructor(vertex: GridVertex, materials: readonly WallMaterial[]) {
    super(`Walls meeting at vertex (${vertex.col}, ${vertex.row}) mix materials: ${materials.join(', ')}`);
    this.name = 'WallMaterialConflictError';
    this.vertex = vertex;
  }
}

export function jointRect(vertex: GridVertex): Rect {
  return {
    x: vertex.col * SEGMENT_LENGTH - HALF_THICKNESS,
    y: vertex.row * SEGMENT_LENGTH - HALF_THICKNESS,
    width: JOINT_SIZE,
    height: JOINT_SIZE,
  };
}

/** The visible body of a wall: from 8px past its first vertex to 8px before the second. */
export function bodyRect(edge: GridEdge): Rect {
  const x = edge.col * SEGMENT_LENGTH;
  const y = edge.row * SEGMENT_LENGTH;
  return edge.axis === 'horizontal'
    ? { x: x + HALF_THICKNESS, y: y - HALF_THICKNESS, width: BODY_LENGTH, height: WALL_THICKNESS }
    : { x: x - HALF_THICKNESS, y: y + HALF_THICKNESS, width: WALL_THICKNESS, height: BODY_LENGTH };
}

function vertexKey(vertex: GridVertex): string {
  return `${vertex.col},${vertex.row}`;
}

/**
 * Resolves joints and bodies from the walls of the map. Walls meeting at one joint must share a
 * material; a mix throws WallMaterialConflictError instead of guessing how to blend them.
 */
export function resolveWallGeometry(map: WallMap): WallGeometry {
  const walls = map.walls();
  const vertices = new Map<string, GridVertex>();
  for (const wall of walls) for (const vertex of edgeVertices(wall.edge)) vertices.set(vertexKey(vertex), vertex);

  const joints: WallJoint[] = [];
  for (const vertex of vertices.values()) {
    const incident = DIRECTIONS.flatMap((direction) => {
      const wall = map.get(edgeFrom(vertex, direction));
      return wall ? [{ direction, material: wall.material }] : [];
    });
    const materials = [...new Set(incident.map((wall) => wall.material))];
    if (materials.length > 1) throw new WallMaterialConflictError(vertex, materials);
    const mask = maskOf(incident.map((wall) => wall.direction));
    const kind = classifyJoint(mask) as JointKind;
    joints.push({ vertex, mask, ...kind, material: materials[0] as WallMaterial, rect: jointRect(vertex) });
  }
  const bodies = walls.map((wall) => ({ edge: wall.edge, material: wall.material, rect: bodyRect(wall.edge) }));
  return { joints, bodies };
}

/** Every rectangle a wall occupies, without overlaps: the shape later collision checks should test. */
export function wallFootprint(geometry: WallGeometry): Rect[] {
  return [...geometry.joints.map((joint) => joint.rect), ...geometry.bodies.map((body) => body.rect)];
}

export interface WallGroup {
  readonly material: WallMaterial;
  readonly joints: readonly WallJoint[];
  readonly bodies: readonly WallBody[];
}

/**
 * Connected pieces of wall: bodies joined through the joints at their ends. A group touches no
 * other group, and all of it shares one material because each joint does.
 */
export function groupWallGeometry(geometry: WallGeometry): WallGroup[] {
  const parent = new Map<string, string>(geometry.joints.map((joint) => [vertexKey(joint.vertex), vertexKey(joint.vertex)]));
  const root = (key: string): string => {
    let current = key;
    while (parent.get(current) !== current) current = parent.get(current) as string;
    parent.set(key, current);
    return current;
  };
  for (const body of geometry.bodies) {
    const [a, b] = edgeVertices(body.edge).map((vertex) => root(vertexKey(vertex))) as [string, string];
    parent.set(a, b);
  }
  const groups = new Map<string, { joints: WallJoint[]; bodies: WallBody[] }>();
  const groupOf = (key: string): { joints: WallJoint[]; bodies: WallBody[] } => {
    const id = root(key);
    const group = groups.get(id) ?? { joints: [], bodies: [] };
    groups.set(id, group);
    return group;
  };
  for (const joint of geometry.joints) groupOf(vertexKey(joint.vertex)).joints.push(joint);
  for (const body of geometry.bodies) groupOf(vertexKey(edgeVertices(body.edge)[0])).bodies.push(body);
  return [...groups.values()].map((group) => ({ material: (group.joints[0] as WallJoint).material, ...group }));
}
