/** The materials a wall is drawn in: one wall sheet each (`wallColumns.ts`). */

export const WALL_MATERIALS = ['brick', 'stone', 'plaster', 'glass'] as const;
export type WallMaterial = (typeof WALL_MATERIALS)[number];
