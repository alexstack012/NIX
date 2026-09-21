import assert from 'node:assert/strict';
import test from 'node:test';

import { profileFields, renderProfileFields } from '../src/profile.js';

test('defines the expected profile fields', () => {
  assert.deepEqual(
    profileFields.map(({ label }) => label),
    ['Email', 'Phone'],
  );
});

test('renders accessible contact links', () => {
  const markup = renderProfileFields(profileFields);

  assert.match(markup, /mailto:avery@example\.test/u);
  assert.match(markup, /tel:\+13125550142/u);
  assert.equal((markup.match(/<dt>/gu) ?? []).length, profileFields.length);
  assert.equal((markup.match(/<dd>/gu) ?? []).length, profileFields.length);
});
