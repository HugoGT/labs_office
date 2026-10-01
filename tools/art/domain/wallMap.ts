/**
 * Wall data of the map: each wall is one shared edge of the floor grid, stored once. A horizontal
 * edge runs east from its vertex (col, row) to (col + 1, row); a vertical one runs south to
 * (col, row + 1). Vertices are the corners of the 32x32 office tiles, from (0, 0) to (cols, rows).
 * Joints, shapes and pixels are derived elsewhere; this module only records which edges hold a wall.
 */

export const WALL_MATERIALS = ['brick', 'stone', 'plaster', 'glass'] as const;
export type WallMaterial = (typeof WALL_MATERIALS)[number];

export type WallAxis = 'horizontal' | 'vertical';

export interface GridVertex {
  readonly col: number;
  readonly row: number;
}

export interface GridEdge extends GridVertex {
  readonly axis: WallAxis;
}

export interface Wall {
  readonly edge: GridEdge;
  readonly material: WallMaterial;
}

export const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export type Direction = (typeof DIRECTIONS)[number];

const STEP: Readonly<Record<Direction, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

export function neighborVertex(vertex: GridVertex, direction: Direction): GridVertex {
  const [dc, dr] = STEP[direction];
  return { col: vertex.col + dc, row: vertex.row + dr };
}

/** The edge that leaves `vertex` toward `direction`, in its single stored form. */
export function edgeFrom(vertex: GridVertex, direction: Direction): GridEdge {
  switch (direction) {
    case 'east':
      return { axis: 'horizontal', col: vertex.col, row: vertex.row };
    case 'west':
      return { axis: 'horizontal', col: vertex.col - 1, row: vertex.row };
    case 'south':
      return { axis: 'vertical', col: vertex.col, row: vertex.row };
    case 'north':
      return { axis: 'vertical', col: vertex.col, row: vertex.row - 1 };
  }
}

/** Both ends of an edge: west then east, or north then south. */
export function edgeVertices(edge: GridEdge): readonly [GridVertex, GridVertex] {
  const start = { col: edge.col, row: edge.row };
  return [start, neighborVertex(start, edge.axis === 'horizontal' ? 'east' : 'south')];
}

export function edgeKey(edge: GridEdge): string {
  return `${edge.axis === 'horizontal' ? 'h' : 'v'}:${edge.col},${edge.row}`;
}

export class WallMap {
  readonly cols: number;
  readonly rows: number;
  readonly #walls = new Map<string, Wall>();

  constructor(cols: number, rows: number) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw new Error(`A wall map needs a positive whole number of tiles, got ${cols}x${rows}`);
    }
    this.cols = cols;
    this.rows = rows;
  }

  /** Places or replaces the wall on an edge. The edge must lie on the grid of this map. */
  set(edge: GridEdge, material: WallMaterial): void {
    const [, end] = edgeVertices(edge);
    const inside = (v: GridVertex): boolean => v.col >= 0 && v.row >= 0 && v.col <= this.cols && v.row <= this.rows;
    if (!inside(edge) || !inside(end)) throw new Error(`Edge ${edgeKey(edge)} is outside the ${this.cols}x${this.rows} map`);
    this.#walls.set(edgeKey(edge), { edge: { axis: edge.axis, col: edge.col, row: edge.row }, material });
  }

  get(edge: GridEdge): Wall | undefined {
    return this.#walls.get(edgeKey(edge));
  }

  walls(): Wall[] {
    return [...this.#walls.values()];
  }

  /** Places `length` consecutive walls starting at `from` and heading `direction`. */
  run(from: GridVertex, direction: Direction, length: number, material: WallMaterial): void {
    let vertex = from;
    for (let i = 0; i < length; i += 1) {
      this.set(edgeFrom(vertex, direction), material);
      vertex = neighborVertex(vertex, direction);
    }
  }

  /** Walls around every edge of a `cols` x `rows` block of tiles whose top-left vertex is `origin`. */
  grid(origin: GridVertex, cols: number, rows: number, material: WallMaterial): void {
    for (let r = 0; r <= rows; r += 1) this.run({ col: origin.col, row: origin.row + r }, 'east', cols, material);
    for (let c = 0; c <= cols; c += 1) this.run({ col: origin.col + c, row: origin.row }, 'south', rows, material);
  }
}
