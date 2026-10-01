import { describe, expect, it } from 'vitest';
import { CHARACTER_SEATED, CHARACTER_WALK, seatedRowForFacing, walkRowForFacing } from './artContract';
import { characterPreviewFrame } from './characterPreview';

const SHEETS = { walkUrl: 'pack/a-walk.png', seatedUrl: 'pack/a-seated.png' };

describe('characterPreviewFrame (art migration, step 5)', () => {
  it('idle is the idle column of the walk sheet, facing the viewer, without steps', () => {
    const frame = characterPreviewFrame(SHEETS, 'idle', 2);

    expect(frame).toEqual({
      url: 'pack/a-walk.png',
      width: CHARACTER_WALK.frame.width * 2,
      height: CHARACTER_WALK.frame.height * 2,
      sheetWidth: 352 * 2,
      sheetHeight: 416 * 2,
      x: -CHARACTER_WALK.idleColumn * CHARACTER_WALK.frame.width * 2,
      y: -walkRowForFacing('down') * CHARACTER_WALK.frame.height * 2,
      steps: 0,
    });
  });

  it('walk starts at the first step column and runs every step of the row', () => {
    const frame = characterPreviewFrame(SHEETS, 'walk', 3);

    expect(frame.url).toBe('pack/a-walk.png');
    expect(frame.x).toBe(-0);
    expect(frame.y).toBe(-walkRowForFacing('down') * CHARACTER_WALK.frame.height * 3);
    expect(frame.steps).toBe(CHARACTER_WALK.stepColumns);
  });

  it('seated is the first seated idle frame of the seated sheet, facing the viewer', () => {
    const frame = characterPreviewFrame(SHEETS, 'seated', 1);

    expect(frame).toMatchObject({
      url: 'pack/a-seated.png',
      width: CHARACTER_SEATED.frame.width,
      height: CHARACTER_SEATED.frame.height,
      sheetWidth: 352,
      sheetHeight: 232,
      x: -CHARACTER_SEATED.idleColumns[0] * CHARACTER_SEATED.frame.width,
      y: -seatedRowForFacing('down') * CHARACTER_SEATED.frame.height,
      steps: 0,
    });
  });
});
