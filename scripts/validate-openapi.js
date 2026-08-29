/**
 * OpenAPI ↔ implementation audit.
 *
 * Generates the spec exactly as the running server does, then walks the live Express
 * router and diffs the two. Catches the two failure modes that make an API document
 * actively harmful:
 *   - UNDOCUMENTED: the endpoint exists but no client can discover it.
 *   - GHOST: the document promises an endpoint that does not exist, so an integrator
 *     builds against it and only finds out at runtime.
 *
 * Also validates the structural properties an import tool (API Dog, Postman, Insomnia)
 * requires: parseable JSON, a declared OpenAPI version, resolvable $refs, and declared
 * security schemes.
 *
 * Usage:  node scripts/validate-openapi.js [--json]
 * Exit 0 = clean, 1 = problems found.
 */
import swaggerJsdoc from 'swagger-jsdoc';
import { swaggerDefinition, apis } from '../src/config/swagger.config.js';

const asJson = process.argv.includes('--json');

const buildSpec = () => swaggerJsdoc({ definition: swaggerDefinition, apis });

/** Express path params (`:id`) → OpenAPI template params (`{id}`), and drop the version prefix. */
const normalise = (route) =>
  route
    .replace('/api/v1', '')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/+$/, '') || '/';

/**
 * Collect every METHOD + PATH the app actually serves.
 *
 * Read statically from the route files rather than by walking the live Express router.
 * Express 5 replaced the router internals (`layer.regexp` became `layer.matchers`) and no
 * longer stores a mount path anywhere reachable, so introspection is both broken and
 * version-fragile. The route files are the declaration of record and parse identically
 * across versions.
 */
const collectRoutes = async () => {
  const fs = await import('fs');
  const routesIndex = fs.readFileSync('src/routes/index.js', 'utf8');

  // Mount prefixes: router.use('/auth', authRoutes)
  const mounts = [];
  for (const m of routesIndex.matchAll(/router\.use\(\s*'([^']+)'\s*,\s*(\w+)/g)) {
    mounts.push({ prefix: m[1], varName: m[2] });
  }

  // Which file backs each imported router variable
  const importedFrom = {};
  for (const m of routesIndex.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.routes\.js)'/g)) {
    importedFrom[m[1]] = m[2].replace(/^\.\.\//, 'src/');
  }

  const out = new Set();

  // Endpoints declared directly on the versioned router (e.g. /health)
  for (const m of routesIndex.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    out.add(`${m[1].toUpperCase()} ${m[2]}`);
  }

  for (const { prefix, varName } of mounts) {
    const file = importedFrom[varName];
    if (!file || !fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    // Form 1: router.get('/path', ...). Whitespace class spans newlines, so multi-line
    // declarations match too.
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const sub = m[2] === '/' ? '' : m[2];
      out.add(`${m[1].toUpperCase()} ${prefix}${sub}`);
    }

    // Form 2: router.route('/path').post(...).patch(...) — the chained style. Missing
    // this form previously produced false "ghost" endpoints: the admin block/unblock
    // routes are declared this way and looked absent when they were merely unparsed.
    for (const m of src.matchAll(/router\.route\(\s*'([^']*)'\s*\)([\s\S]*?);/g)) {
      const sub = m[1] === '/' ? '' : m[1];
      for (const v of m[2].matchAll(/\.(get|post|put|patch|delete)\s*\(/g)) {
        out.add(`${v[1].toUpperCase()} ${prefix}${sub}`);
      }
    }
  }

  return out;
};

/** Walk the spec for $ref targets that do not resolve. A broken ref breaks an import. */
const findBrokenRefs = (spec) => {
  const broken = [];
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (ref.startsWith('#/')) {
        const target = ref
          .slice(2)
          .split('/')
          .reduce((acc, key) => (acc ? acc[decodeURIComponent(key)] : undefined), spec);
        if (target === undefined) broken.push(`${path} -> ${ref}`);
      }
    }
    for (const [k, v] of Object.entries(node)) visit(v, `${path}/${k}`);
  };
  visit(spec, '');
  return broken;
};

const main = async () => {
  const spec = buildSpec();

  const documented = new Set();
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(ops)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        documented.add(`${method.toUpperCase()} ${normalise(p)}`);
      }
    }
  }

  const raw = await collectRoutes();
  const actual = new Set(
    [...raw].map((r) => {
      const [m, p] = r.split(' ');
      return `${m} ${normalise(p)}`;
    })
  );

  const undocumented = [...actual].filter((r) => !documented.has(r)).sort();
  const ghosts = [...documented].filter((r) => !actual.has(r)).sort();
  const brokenRefs = findBrokenRefs(spec);
  const securitySchemes = Object.keys(spec.components?.securitySchemes || {});

  // Structural checks an import tool depends on.
  const structural = [];
  if (!spec.openapi) structural.push('missing `openapi` version field');
  if (!spec.info?.title) structural.push('missing `info.title`');
  if (!spec.info?.version) structural.push('missing `info.version`');
  if (!Array.isArray(spec.servers) || spec.servers.length === 0) structural.push('no `servers` entry');
  if (securitySchemes.length === 0) structural.push('no `components.securitySchemes` — auth is undocumented');
  try {
    JSON.parse(JSON.stringify(spec));
  } catch {
    structural.push('spec is not JSON-serialisable');
  }

  const report = {
    openapi: spec.openapi,
    documentedOperations: documented.size,
    actualRoutes: actual.size,
    undocumented,
    ghosts,
    brokenRefs,
    securitySchemes,
    structural,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`OpenAPI          : ${report.openapi}`);
    console.log(`Documented ops   : ${report.documentedOperations}`);
    console.log(`Actual routes    : ${report.actualRoutes}`);
    console.log(`Security schemes : ${securitySchemes.join(', ') || '(NONE)'}`);
    console.log(`\nUNDOCUMENTED (${undocumented.length}):`);
    console.log(undocumented.length ? undocumented.map((r) => `  ${r}`).join('\n') : '  (none)');
    console.log(`\nGHOSTS — documented but absent (${ghosts.length}):`);
    console.log(ghosts.length ? ghosts.map((r) => `  ${r}`).join('\n') : '  (none)');
    console.log(`\nBROKEN $refs (${brokenRefs.length}):`);
    console.log(brokenRefs.length ? brokenRefs.map((r) => `  ${r}`).join('\n') : '  (none)');
    console.log(`\nSTRUCTURAL PROBLEMS (${structural.length}):`);
    console.log(structural.length ? structural.map((r) => `  ${r}`).join('\n') : '  (none)');
  }

  const failed =
    undocumented.length > 0 || ghosts.length > 0 || brokenRefs.length > 0 || structural.length > 0;
  process.exit(failed ? 1 : 0);
};

main().catch((err) => {
  console.error('OpenAPI validation failed to run:', err.message);
  process.exit(1);
});
