/**
 * The Cloud SQL password has two readers of one Secret Manager value that
 * cannot share code: Terraform sets it on the `office` user, office-deploy puts
 * it in DATABASE_URL. The first #72 deploy failed with `password authentication
 * failed` because the secret ended in a newline: Terraform kept it, bash `$(...)`
 * dropped it. Both sides now trim surrounding whitespace; this pins them together.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const infra = (path: string) => readFileSync(new URL(`../../../infra/${path}`, import.meta.url), 'utf8');

describe('Cloud SQL password normalization (#72)', () => {
  it('Terraform trims the secret before setting it on the Cloud SQL user', () => {
    expect(infra('gcp/terraform/database.tf')).toMatch(
      /password_wo\s*=\s*trimspace\(ephemeral\.google_secret_manager_secret_version\.db_password\.secret_data\)/,
    );
  });

  it('office-deploy trims the same whitespace before encoding it into DATABASE_URL', () => {
    const block = /DB_PASSWORD_ENC="\$\(([\s\S]*?)\n\)"/.exec(infra('gcp/scripts/office-deploy.sh'))?.[1];
    const script = block && /python3 -c '([^']+)'/.exec(block)?.[1];

    expect(script, 'python snippet that builds DB_PASSWORD_ENC').toBeDefined();
    // What reaches the snippet after `$(...)` has already dropped trailing newlines.
    const encoded = execFileSync('python3', ['-c', script!], { input: ' \ta/b@c#d \r', encoding: 'utf8' });

    expect(encoded).toBe('a%2Fb%40c%23d');
  });
});
