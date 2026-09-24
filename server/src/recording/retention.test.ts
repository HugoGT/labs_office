/**
 * The retention lives in two places that cannot import each other: the app
 * (`RECORDING_RETENTION_DAYS`, which drives the 410 and "Disponible hasta")
 * and the bucket lifecycle rule, which actually deletes the object: Terraform
 * for the deployed bucket, a gcloud lifecycle JSON for dev buckets. This pins
 * them together: change one and this goes red.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RECORDING_RETENTION_DAYS } from '../../../src/game/officeProtocol.ts';

const infra = (path: string) => readFileSync(new URL(`../../../infra/${path}`, import.meta.url), 'utf8');
const terraform = (file: string) => infra(`gcp/terraform/${file}`);

describe('recording retention (#5)', () => {
  it('the Terraform default is RECORDING_RETENTION_DAYS', () => {
    const block = /variable "recording_retention_days" \{[\s\S]*?\n\}/.exec(terraform('variables.tf'))?.[0];

    expect(block, 'variable recording_retention_days').toBeDefined();
    expect(/default\s*=\s*(\d+)/.exec(block!)?.[1]).toBe(String(RECORDING_RETENTION_DAYS));
  });

  it('the bucket lifecycle deletes objects at that age', () => {
    const main = terraform('main.tf');

    expect(main).toMatch(/action \{\s*type = "Delete"\s*\}\s*condition \{\s*age = var\.recording_retention_days\s*\}/);
  });

  it('the lifecycle JSON for dev buckets deletes at the same age, and nothing else', () => {
    expect(JSON.parse(infra('gcp/recordings-lifecycle.json'))).toEqual({
      rule: [{ action: { type: 'Delete' }, condition: { age: RECORDING_RETENTION_DAYS } }],
    });
  });
});
