/* ==========================================================================
   tools/lib/jsonschema.mjs
   A JSON Schema validator covering exactly the subset data/schema/ uses,
   and nothing else.

   Bigu has no dependencies, and the four schema files in data/schema/ went
   unenforced for their whole existence because checking them meant adding
   one. They are careful, detailed documents — every field carries a
   description explaining what the view does with it — and they were being
   read by people and by nothing else. Two hundred lines is a cheaper price
   than a dependency for making them executable.

   Supported: type (including "integer"), required, properties, items,
   enum, $ref to "#/$defs/<name>", minLength, and format: "date". An
   unsupported keyword is *reported*, not ignored — a schema that quietly
   validates less than it says is worse than no validator, because it reads
   like coverage.

   Errors are collected rather than thrown at the first one: an author
   fixing a hand-written catalogue wants the whole list, not a game of
   whack-a-mole one field per run.
   ========================================================================== */

const SUPPORTED = new Set([
  '$schema', '$id', '$defs', '$ref',
  'title', 'description', 'examples', 'default',
  'type', 'required', 'properties', 'items', 'enum', 'format', 'minLength',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

/* JSON Schema's "number" accepts integers; everything else is exact. */
function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

function resolve(schema, root) {
  if (!schema || typeof schema.$ref !== 'string') return schema;

  const match = schema.$ref.match(/^#\/\$defs\/(.+)$/);
  if (!match) throw new Error(`unsupported $ref "${schema.$ref}" — only "#/$defs/<name>" is understood`);

  const target = root.$defs?.[match[1]];
  if (!target) throw new Error(`$ref "${schema.$ref}" points at a definition that does not exist`);
  return target;
}

/* `path` is the reader-facing location, in the dotted/bracketed form an
   author can find in their editor: words[41].example.mn */
function validate(value, schema, { root = schema, path = '', errors = [] } = {}) {
  const resolved = resolve(schema, root);
  const where = path || '(root)';

  for (const keyword of Object.keys(resolved)) {
    if (!SUPPORTED.has(keyword)) {
      errors.push(`${where}: schema uses "${keyword}", which this validator does not implement`);
    }
  }

  if (resolved.type && !matchesType(value, resolved.type)) {
    errors.push(`${where}: expected ${resolved.type}, found ${typeOf(value)}`);
    // No point checking a string's properties when it should have been an
    // object — every child would report the same one mistake again.
    return errors;
  }

  if (resolved.enum && !resolved.enum.includes(value)) {
    errors.push(`${where}: ${JSON.stringify(value)} is not one of ${resolved.enum.join(', ')}`);
  }

  if (resolved.format === 'date' && typeof value === 'string') {
    if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
      errors.push(`${where}: "${value}" is not a YYYY-MM-DD date`);
    }
  }

  if (typeof resolved.minLength === 'number' && typeof value === 'string' && value.length < resolved.minLength) {
    errors.push(`${where}: must be at least ${resolved.minLength} character(s)`);
  }

  if (resolved.type === 'object' || (!resolved.type && typeOf(value) === 'object')) {
    for (const key of resolved.required ?? []) {
      if (!(key in value)) errors.push(`${where}: missing required field "${key}"`);
    }
    for (const [key, child] of Object.entries(resolved.properties ?? {})) {
      if (key in value) {
        validate(value[key], child, { root, path: path ? `${path}.${key}` : key, errors });
      }
    }
  }

  if (resolved.items && Array.isArray(value)) {
    value.forEach((entry, index) => {
      validate(entry, resolved.items, { root, path: `${path}[${index}]`, errors });
    });
  }

  return errors;
}

export { validate };
