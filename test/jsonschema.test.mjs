/* ==========================================================================
   test/jsonschema.test.mjs
   tools/lib/jsonschema.mjs — the subset validator the content check runs on.

   A validator nobody validates is the worst thing in a repository: it reads
   like coverage and provides none. The case that matters most here is the
   unsupported-keyword report — if a schema grows a keyword this file does
   not implement, silently ignoring it would mean the schema says more than
   is being enforced, and nobody would find out.
   ========================================================================== */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validate } from '../tools/lib/jsonschema.mjs';

const ok = (value, schema) => assert.deepEqual(validate(value, schema), []);
const fails = (value, schema, pattern) => {
  const errors = validate(value, schema);
  assert.ok(errors.length > 0, 'expected at least one error');
  if (pattern) assert.match(errors.join('\n'), pattern);
  return errors;
};

describe('types', () => {
  test('each primitive is distinguished', () => {
    ok('x', { type: 'string' });
    ok(1.5, { type: 'number' });
    ok(3, { type: 'integer' });
    ok(true, { type: 'boolean' });
    ok([], { type: 'array' });
    ok({}, { type: 'object' });
    ok(null, { type: 'null' });
  });

  test('an array is not an object and null is not an object', () => {
    fails([], { type: 'object' }, /expected object, found array/);
    fails(null, { type: 'object' }, /expected object, found null/);
  });

  test('integer is stricter than number, and number accepts an integer', () => {
    ok(3, { type: 'number' });
    fails(3.5, { type: 'integer' }, /expected integer/);
  });

  test('a type mismatch stops the descent instead of reporting every child again', () => {
    const schema = { type: 'object', required: ['a', 'b', 'c'], properties: { a: { type: 'string' } } };
    assert.equal(validate('a string', schema).length, 1);
  });
});

describe('objects', () => {
  const schema = {
    type: 'object',
    required: ['id', 'kana'],
    properties: { id: { type: 'string' }, kana: { type: 'string' }, level: { type: 'string' } },
  };

  test('required fields are checked by presence, not truthiness', () => {
    ok({ id: '', kana: '' }, schema);
    fails({ id: 'a' }, schema, /missing required field "kana"/);
  });

  test('optional fields are checked only when present', () => {
    ok({ id: 'a', kana: 'あ' }, schema);
    fails({ id: 'a', kana: 'あ', level: 5 }, schema, /level: expected string/);
  });

  test('unlisted fields are allowed through — the schemas do not close their objects', () => {
    ok({ id: 'a', kana: 'あ', somethingNew: true }, schema);
  });
});

describe('arrays and $ref', () => {
  const schema = {
    type: 'object',
    properties: { words: { type: 'array', items: { $ref: '#/$defs/word' } } },
    $defs: { word: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  };

  test('every element is checked and reported by index', () => {
    fails({ words: [{ id: 'a' }, { id: 'b' }, {}] }, schema, /words\[2\]: missing required field "id"/);
  });

  test('a $ref that points nowhere is an error in the schema, not a pass', () => {
    assert.throws(() => validate({ a: 1 }, { properties: { a: { $ref: '#/$defs/missing' } } }), /does not exist/);
  });

  test('a $ref form the validator does not understand is refused loudly', () => {
    assert.throws(() => validate({}, { $ref: 'other.json#/thing' }), /unsupported \$ref/);
  });
});

describe('enum, format and minLength', () => {
  test('enum names the permitted values in the message', () => {
    fails('N6', { enum: ['N5', 'N4'] }, /"N6" is not one of N5, N4/);
    ok('N5', { enum: ['N5', 'N4'] });
  });

  test('format: date requires YYYY-MM-DD and a real date', () => {
    ok('2026-08-06', { type: 'string', format: 'date' });
    fails('06/08/2026', { type: 'string', format: 'date' }, /not a YYYY-MM-DD date/);
    fails('2026-13-45', { type: 'string', format: 'date' }, /not a YYYY-MM-DD date/);
  });

  test('minLength rejects the empty string', () => {
    fails('', { type: 'string', minLength: 1 }, /at least 1 character/);
    ok('a', { type: 'string', minLength: 1 });
  });
});

describe('unsupported keywords', () => {
  /* The whole safety property of a subset validator. A schema keyword this
     file does not implement must be reported, never ignored — otherwise the
     schema documents a rule that is not being enforced and reads as if it
     were. */
  test('are reported rather than silently ignored', () => {
    fails({ a: 1 }, { type: 'object', additionalProperties: false }, /does not implement/);
    fails([1, 2, 3], { type: 'array', maxItems: 2 }, /does not implement/);
    fails('x', { type: 'string', pattern: '^y$' }, /does not implement/);
  });

  test('documentation keywords are not mistaken for rules', () => {
    ok('x', { type: 'string', title: 'A thing', description: 'prose', examples: ['x'], default: 'x' });
  });
});

describe('reporting', () => {
  test('collects every problem rather than stopping at the first', () => {
    const schema = {
      type: 'object',
      required: ['a', 'b'],
      properties: { c: { type: 'string' }, d: { type: 'integer' } },
    };
    assert.equal(validate({ c: 1, d: 'x' }, schema).length, 4);
  });

  test('paths read the way an author would search for them', () => {
    const schema = {
      type: 'object',
      properties: {
        words: {
          type: 'array',
          items: { type: 'object', properties: { example: { type: 'object', properties: { mn: { type: 'string' } } } } },
        },
      },
    };
    fails({ words: [{}, { example: { mn: 42 } }] }, schema, /^words\[1\]\.example\.mn:/m);
  });

  test('the root is named rather than left blank', () => {
    fails('x', { type: 'object' }, /^\(root\):/);
  });
});
