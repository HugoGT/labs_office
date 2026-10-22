import { describe, expect, it } from 'vitest';
import type { OfficeDesk } from '../game/desksPort';
import type { RosterPeer } from '../game/roster';
import { deskBannerView } from './deskBannerView';

const SELF: RosterPeer = { sessionId: 'yo', name: 'Ana Torres', status: 'g' };

function desk(overrides: Partial<OfficeDesk> = {}): OfficeDesk {
  return { id: 'd1', label: 'Mesa 4', x: 0, y: 0, w: 96, h: 96, occupant: null, mine: false, ...overrides };
}

const LUIS = { id: 'u-luis', displayName: 'Luis Paz' };

describe('deskBannerView', () => {
  it('a free desk offers to claim it while one has no desk', () => {
    expect(deskBannerView(desk(), { self: SELF, peers: [], desks: [desk()] })).toEqual({
      kind: 'free',
      deskId: 'd1',
      label: 'Mesa 4',
      canClaim: true,
    });
  });

  it('a free desk cannot be claimed while one already holds another', () => {
    const mine = desk({ id: 'd2', occupant: { id: 'u-ana', displayName: 'Ana Torres' }, mine: true });

    const view = deskBannerView(desk(), { self: SELF, peers: [], desks: [desk(), mine] });

    expect(view).toMatchObject({ kind: 'free', canClaim: false });
  });

  it('the own desk is shown with the own name, status and session', () => {
    const mine = desk({ occupant: { id: 'u-ana', displayName: 'Ana Torres' }, mine: true });

    expect(deskBannerView(mine, { self: { ...SELF, status: 'y' }, peers: [], desks: [mine] })).toEqual({
      kind: 'mine',
      deskId: 'd1',
      label: 'Mesa 4',
      name: 'Ana Torres',
      status: 'y',
      sessionId: 'yo',
    });
  });

  it('someone else connected can be called, found by their directory name', () => {
    const taken = desk({ occupant: LUIS });
    // The room name and the directory name differ only in case and spacing.
    const peers: RosterPeer[] = [{ sessionId: 's-luis', name: ' luis  PAZ', status: 'g' }];

    expect(deskBannerView(taken, { self: SELF, peers, desks: [taken] })).toEqual({
      kind: 'taken',
      deskId: 'd1',
      label: 'Mesa 4',
      name: 'Luis Paz',
      status: 'g',
      sessionId: 's-luis',
      callable: true,
    });
  });

  it('someone else in No molestar is shown but cannot be called', () => {
    const taken = desk({ occupant: LUIS });
    const peers: RosterPeer[] = [{ sessionId: 's-luis', name: 'Luis Paz', status: 'r' }];

    expect(deskBannerView(taken, { self: SELF, peers, desks: [taken] })).toMatchObject({ status: 'r', callable: false });
  });

  it('someone else offline has no status and cannot be called', () => {
    const taken = desk({ occupant: LUIS });

    expect(deskBannerView(taken, { self: SELF, peers: [], desks: [taken] })).toMatchObject({
      name: 'Luis Paz',
      status: null,
      sessionId: null,
      callable: false,
    });
  });

  it('an occupant without a chosen name is never matched to anyone connected', () => {
    const taken = desk({ occupant: { id: 'u-x', displayName: null } });
    const peers: RosterPeer[] = [{ sessionId: 's-x', name: 'Invitado', status: 'g' }];

    expect(deskBannerView(taken, { self: SELF, peers, desks: [taken] })).toMatchObject({
      name: 'Ocupado',
      status: null,
      callable: false,
    });
  });
});
