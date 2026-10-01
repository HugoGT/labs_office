/**
 * Pure rules of art contributions and their review (#122): limits, state
 * transitions, who reviews and who may see a file. No adapter here: both
 * `memoryDecor` and `pgDecor` call these, so they refuse exactly the same.
 */

import { describe, expect, it } from 'vitest';
import {
  ART_AUDIT_ACTIONS,
  CONTRIBUTION_KINDS,
  ContributionLimitError,
  InvalidArtTransitionError,
  InvalidReviewNoteError,
  MAX_CONTRIBUTIONS_PER_HOUR,
  MAX_PENDING_CONTRIBUTIONS,
  MAX_REVIEW_NOTE_LENGTH,
  assertContributionQuota,
  canReviewArt,
  canSeeArtFile,
  isContributionKind,
  isPublicArtFile,
  normalizeReviewNote,
  reviewTransition,
  retireTransition,
} from './artReviewRules.ts';

describe('contribution limits', () => {
  it('are 5 pending pieces and 10 uploads per hour', () => {
    expect(MAX_PENDING_CONTRIBUTIONS).toBe(5);
    expect(MAX_CONTRIBUTIONS_PER_HOUR).toBe(10);
  });

  it('accept the fifth pending piece and the tenth upload of the hour', () => {
    expect(() => assertContributionQuota({ pending: 4, lastHour: 9 })).not.toThrow();
  });

  it('refuse a sixth pending piece', () => {
    const error = (() => {
      try {
        assertContributionQuota({ pending: 5, lastHour: 0 });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ContributionLimitError);
    expect((error as ContributionLimitError).code).toBe('too-many-pending');
  });

  it('refuse an eleventh upload within the hour, whatever happened to the other ten', () => {
    expect(() => assertContributionQuota({ pending: 0, lastHour: 10 })).toThrow(
      expect.objectContaining({ code: 'hourly-limit' }),
    );
  });

  it('report the pending cap first when both are reached', () => {
    expect(() => assertContributionQuota({ pending: 5, lastHour: 10 })).toThrow(
      expect.objectContaining({ code: 'too-many-pending' }),
    );
  });
});

describe('contribution kinds', () => {
  it('are characters and decor plants; desks and floors stay admin-only', () => {
    expect(CONTRIBUTION_KINDS).toEqual(['character', 'plant']);
    expect(isContributionKind('character')).toBe(true);
    expect(isContributionKind('plant')).toBe(true);
    expect(isContributionKind('desk')).toBe(false);
    expect(isContributionKind('floor')).toBe(false);
    expect(isContributionKind(undefined)).toBe(false);
  });
});

describe('reviewTransition', () => {
  it('moves a pending piece to approved or rejected', () => {
    expect(reviewTransition('pending', 'approve')).toBe('approved');
    expect(reviewTransition('pending', 'reject')).toBe('rejected');
  });

  it.each([
    ['approved', 'approve'],
    ['approved', 'reject'],
    ['rejected', 'approve'],
    ['rejected', 'reject'],
  ] as const)('refuses %s -> %s: a decision is final', (from, decision) => {
    expect(() => reviewTransition(from, decision)).toThrow(InvalidArtTransitionError);
  });
});

describe('retireTransition', () => {
  it('retires an active approved piece', () => {
    expect(retireTransition({ status: 'approved', retiredAt: null })).toBe('retire');
  });

  it('is a no-op on a piece already retired, so a retry converges', () => {
    expect(retireTransition({ status: 'approved', retiredAt: new Date() })).toBe('already-retired');
  });

  it.each(['pending', 'rejected'] as const)('refuses a %s piece: only what was offered can stop being offered', (status) => {
    expect(() => retireTransition({ status, retiredAt: null })).toThrow(InvalidArtTransitionError);
  });
});

describe('canReviewArt', () => {
  it('is the admin rank criterion: admin and superadmin review, nobody else', () => {
    expect(canReviewArt('superadmin')).toBe(true);
    expect(canReviewArt('admin')).toBe(true);
    expect(canReviewArt('employee')).toBe(false);
    expect(canReviewArt('guest')).toBe(false);
  });
});

describe('normalizeReviewNote', () => {
  it('trims the reason', () => {
    expect(normalizeReviewNote('  tiene fondo  ')).toBe('tiene fondo');
  });

  it.each([undefined, null, '', '   ', 42, 'x'.repeat(MAX_REVIEW_NOTE_LENGTH + 1)])('refuses %j: a rejection needs a readable reason', (raw) => {
    expect(() => normalizeReviewNote(raw)).toThrow(InvalidReviewNoteError);
  });
});

describe('file visibility', () => {
  const ana = { id: 'id-ana', role: 'employee' as const };
  const beto = { id: 'id-beto', role: 'employee' as const };
  const admin = { id: 'id-admin', role: 'admin' as const };
  const pendingOfAna = { status: 'pending' as const, uploadedBy: 'id-ana' };
  const rejectedOfAna = { status: 'rejected' as const, uploadedBy: 'id-ana' };
  const approved = { status: 'approved' as const, uploadedBy: 'id-beto' };

  it('a file is public only when an approved piece carries it', () => {
    expect(isPublicArtFile([approved])).toBe(true);
    expect(isPublicArtFile([pendingOfAna])).toBe(false);
    expect(isPublicArtFile([rejectedOfAna])).toBe(false);
    expect(isPublicArtFile([])).toBe(false);
    // The same pixels already approved under another piece are public anyway.
    expect(isPublicArtFile([pendingOfAna, approved])).toBe(true);
  });

  it('a pending file is seen by its uploader and by reviewers, nobody else', () => {
    expect(canSeeArtFile(ana, [pendingOfAna])).toBe(true);
    expect(canSeeArtFile(admin, [pendingOfAna])).toBe(true);
    expect(canSeeArtFile(beto, [pendingOfAna])).toBe(false);
  });

  it('the uploader keeps seeing a rejected piece, to understand the reason', () => {
    expect(canSeeArtFile(ana, [rejectedOfAna])).toBe(true);
    expect(canSeeArtFile(beto, [rejectedOfAna])).toBe(false);
  });

  it('nothing is seen of a hash no piece carries, not even by a reviewer', () => {
    expect(canSeeArtFile(admin, [])).toBe(false);
  });
});

describe('ART_AUDIT_ACTIONS', () => {
  it('names every transition, the Admin upload included', () => {
    expect(ART_AUDIT_ACTIONS).toEqual(['upload-art', 'submit-art', 'approve-art', 'reject-art', 'retire-art']);
  });
});
