import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Config, MIN_TOKEN_LENGTH, resolveToken, TOKEN_ENV } from '../lib/index.js';

const VALID = 'MfDIwHr7iXvV0fQm2s7lwJp8Yb9dCkT4uN6zRa5e1gA';

describe('Config', () => {
  const validate = (value) => Config['~standard'].validate(value);

  it('accepts a missing config, which leaves the token to the environment', () => {
    assert.deepEqual(validate(undefined).value, {});
    assert.deepEqual(validate(null).value, {});
    assert.deepEqual(validate({}).value, {});
  });

  it('accepts a string token and keeps it unparsed for resolveToken', () => {
    assert.deepEqual(validate({ token: '  spaced  ' }).value, { token: '  spaced  ' });
  });

  it('rejects a non-string token before the plugin starts', () => {
    const result = validate({ token: 42 });
    assert.deepEqual(result.issues?.map((issue) => issue.path), [['token']]);
    assert.match(result.issues[0].message, /token expected string/u);
  });

  it('is the native schema the Loader and the config dump read', () => {
    assert.equal(Reflect.get(Config, Symbol.for('schemastery')), true);
    assert.equal(typeof Config.type, 'string');
  });
});

describe('resolveToken', () => {
  it('prefers config.token over the environment', () => {
    assert.equal(resolveToken({ token: VALID }, { [TOKEN_ENV]: 'ENVIRONMENTTOKEN0000' }), VALID);
  });

  it('falls back to the environment variable', () => {
    assert.equal(resolveToken({}, { [TOKEN_ENV]: VALID }), VALID);
    assert.equal(resolveToken(undefined, { [TOKEN_ENV]: VALID }), VALID);
  });

  it('trims surrounding whitespace from either source', () => {
    assert.equal(resolveToken({ token: `  ${VALID}  ` }, {}), VALID);
    assert.equal(resolveToken({}, { [TOKEN_ENV]: `\n${VALID}\t` }), VALID);
  });

  it('treats a blank config token as absent and falls through to the environment', () => {
    assert.equal(resolveToken({ token: '   ' }, { [TOKEN_ENV]: VALID }), VALID);
  });

  it('refuses to start without a token instead of leaving the random one in place', () => {
    assert.throws(() => resolveToken({}, {}), {
      name: 'TypeError',
      message: /no launch token configured.*config\.token or DSH_PAIRING_TOKEN/u,
    });
    assert.throws(() => resolveToken(undefined, { [TOKEN_ENV]: '   ' }), TypeError);
  });

  it('rejects tokens shorter than the minimum, naming the source', () => {
    assert.throws(() => resolveToken({ token: 'x'.repeat(MIN_TOKEN_LENGTH - 1) }, {}), {
      message: new RegExp(`config\\.token is ${String(MIN_TOKEN_LENGTH - 1)} characters`, 'u'),
    });
    assert.throws(() => resolveToken({}, { [TOKEN_ENV]: 'short' }), {
      message: /DSH_PAIRING_TOKEN is 5 characters/u,
    });
  });

  it('accepts exactly the minimum length', () => {
    assert.equal(resolveToken({ token: 'a'.repeat(MIN_TOKEN_LENGTH) }, {}), 'a'.repeat(MIN_TOKEN_LENGTH));
  });

  it('rejects characters a printed URL would re-encode', () => {
    for (const token of ['has spaces in the token value', 'percent%20encoded%20token', 'plus+sign+in+the+token', 'slash/slash/slash/slash', 'question?mark?question']) {
      assert.throws(() => resolveToken({ token }, {}), {
        message: /must use only A-Z, a-z, 0-9/u,
      });
    }
  });

  it('accepts base64url and other URL-safe tokens', () => {
    const base64url = 'A1b2C3d4E5f6G7h8I9j0K-l_M';
    assert.equal(resolveToken({ token: base64url }, {}), base64url);
  });
});
