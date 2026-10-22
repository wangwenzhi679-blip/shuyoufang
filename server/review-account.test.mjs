import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { reviewerCredentials, createReviewer } from './review-account.mjs';
import { accountSchema, passwordSchema } from './request-schemas.mjs';

test('generated credentials meet actual login rules', () => {
  const credentials = reviewerCredentials();
  assert(accountSchema.safeParse(credentials.account).success);
  assert(passwordSchema.safeParse(credentials.password).success);
  assert.notDeepEqual(credentials, reviewerCredentials());
});
test('creates student with password hash and never modifies existing accounts', async () => {
  const credentials = reviewerCredentials();
  let stored;
  const id = await createReviewer(
    {
      execute: async (sql, args) => {
        assert(sql.startsWith('INSERT INTO users'));
        assert(sql.includes("'student','active'"));
        stored = args;
        return [{ insertId: 12 }];
      },
    },
    credentials,
  );
  assert.equal(id, 12);
  assert.equal(stored[0], credentials.account);
  assert.notEqual(stored[1], credentials.password);
  assert(await bcrypt.compare(credentials.password, stored[1]));
});
test('invalid credentials are rejected without touching database', async () => {
  await assert.rejects(
    createReviewer(
      { execute: () => assert.fail('must not query') },
      { account: 'admin', password: 'bad' },
    ),
  );
});
