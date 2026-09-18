import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const exists = (path: string): boolean => existsSync(join(ROOT, path));

type Dependency = { path?: string; method?: 'get' | 'post'; fixture: string; fields: string[] };
type ServiceContract = { spec?: string; dependencies: Dependency[] };

function sampleHasField(sample: unknown, dotted: string): boolean {
    if (sample === undefined || sample === null) return false;
    let node: unknown = sample;
    for (const part of dotted.split('.')) {
        const here: unknown = Array.isArray(node) ? (node as unknown[])[0] : node;
        if (here === null || typeof here !== 'object' || !(part in here)) return false;
        node = (here as Record<string, unknown>)[part];
    }
    return true;
}

export function fixtureHasField(fixture: unknown, dotted: string): boolean {
    const samples = Array.isArray(fixture) ? fixture : [fixture];
    return samples.some(sample => sampleHasField(sample, dotted));
}

const deref = (spec: Record<string, unknown>, node: unknown): unknown => {
    let current = node;
    for (let hops = 0; hops < 10; hops += 1) {
        const ref = (current as Record<string, unknown> | undefined)?.['$ref'];
        if (typeof ref !== 'string' || !ref.startsWith('#/')) return current;
        current = ref
            .slice(2)
            .split('/')
            .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], spec);
    }
    return current;
};

export function resolveResponseSchema(spec: unknown, path: string, method: string): unknown {
    const doc = spec as Record<string, never>;
    const operation = (doc.paths as Record<string, never> | undefined)?.[path]?.[method];
    if (operation === undefined) return undefined;
    const responses = (operation as Record<string, never>).responses as Record<string, never> | undefined;
    const ok = responses?.['200'] ?? responses?.default;
    const content = (ok as Record<string, never> | undefined)?.content as Record<string, never> | undefined;
    const media = content?.['application/json'] ?? Object.values(content ?? {})[0];
    return (media as Record<string, never> | undefined)?.schema;
}

function declaredProperties(spec: Record<string, unknown>, node: unknown): Record<string, unknown> | undefined {
    let current = deref(spec, node);
    for (let hops = 0; hops < 10; hops += 1) {
        const here = current as Record<string, unknown> | undefined;
        if (here === undefined || here === null) return undefined;
        if (here.properties !== undefined) return here.properties as Record<string, unknown>;
        if (here.items !== undefined) {
            current = deref(spec, here.items);
            continue;
        }
        const branches = (here.allOf ?? here.oneOf ?? here.anyOf) as unknown[] | undefined;
        if (branches === undefined) return undefined;
        if (branches.length === 1) {
            current = deref(spec, branches[0]);
            continue;
        }
        const merged: Record<string, unknown> = {};
        for (const branch of branches) Object.assign(merged, declaredProperties(spec, branch) ?? {});
        return merged;
    }
    return undefined;
}

export function specDeclaresField(spec: unknown, schema: unknown, dotted: string): boolean {
    const doc = spec as Record<string, unknown>;
    let node = schema;
    for (const part of dotted.split('.')) {
        const properties = declaredProperties(doc, node);
        if (properties === undefined || !(part in properties)) return false;
        node = properties[part];
    }
    return true;
}

/**
 * What each tool actually reads off a given endpoint's response, checked
 * against both the captured fixture and (where a spec was fetched, see Task
 * 27) the vendored OpenAPI schema. Update this whenever a tool starts
 * reading a new field.
 */
const CONTRACTS: Record<string, ServiceContract> = {
    tandoor: {
        spec: 'specs/tandoor.json',
        dependencies: [
            { path: '/api/recipe/', method: 'get', fixture: 'test/fixtures/recipe-search.json', fields: ['results.id', 'results.name', 'results.description', 'results.rating', 'results.servings', 'results.keywords'] },
            {
                path: '/api/recipe/{id}/',
                method: 'get',
                fixture: 'test/fixtures/recipe-detail.json',
                fields: ['id', 'name', 'servings', 'steps.instruction', 'steps.ingredients.food.name', 'steps.ingredients.unit.name', 'steps.ingredients.amount', 'steps.ingredients.is_header', 'steps.ingredients.no_amount']
            },
            { path: '/api/keyword/', method: 'get', fixture: 'test/fixtures/keywords.json', fields: ['results.id', 'results.name'] },
            { path: '/api/unit/', method: 'get', fixture: 'test/fixtures/units.json', fields: ['results.id', 'results.name'] },
            { path: '/api/food/', method: 'get', fixture: 'test/fixtures/foods.json', fields: ['results.id', 'results.name', 'results.food_onhand'] },
            { path: '/api/meal-type/', method: 'get', fixture: 'test/fixtures/meal-types.json', fields: ['results.id', 'results.name', 'results.order'] },
            {
                path: '/api/meal-plan/',
                method: 'get',
                fixture: 'test/fixtures/meal-plan.json',
                fields: ['results.id', 'results.date', 'results.meal_type.name', 'results.recipe.id', 'results.recipe.name', 'results.servings']
            },
            { path: '/api/shopping-list-entry/', method: 'get', fixture: 'test/fixtures/shopping-list.json', fields: ['results.id', 'results.food.name', 'results.amount', 'results.checked'] },
            { path: '/api/cook-log/', method: 'get', fixture: 'test/fixtures/cook-log.json', fields: ['results.id', 'results.recipe.name', 'results.servings', 'results.created'] }
        ]
    }
};

// No live Tandoor instance was available while this project was built, so no
// fixtures were captured (see scripts/capture-fixtures.ts) and no spec was
// vendored (see scripts/fetch-specs.sh). These tests skip rather than fail
// until a maintainer runs both against a real instance — see CONTRIBUTING.md.
describe('adapter contracts', () => {
    for (const [service, contract] of Object.entries(CONTRACTS)) {
        describe(service, () => {
            for (const dep of contract.dependencies) {
                const label = dep.path ?? dep.fixture.split('/').pop();
                const fixtureTest = exists(dep.fixture) ? it : it.skip;

                fixtureTest(`${label} still returns the fields tools read`, () => {
                    const fixture = read(dep.fixture);
                    const missing = dep.fields.filter(f => !fixtureHasField(fixture, f));
                    expect(missing, 'missing from the recorded response').toEqual([]);
                });

                const spec = contract.spec;
                const path = dep.path;
                const method = dep.method ?? 'get';

                if (spec !== undefined && path !== undefined) {
                    const specTest = exists(spec) ? it : it.skip;

                    specTest(`${label} still declares those fields in the vendored spec`, () => {
                        const doc = read(spec);
                        const schema = resolveResponseSchema(doc, path, method);
                        expect(schema, `no ${method} ${path} in ${spec}`).toBeDefined();
                        const missing = dep.fields.filter(f => !specDeclaresField(doc, schema, f));
                        expect(missing, 'upstream renamed or removed a field we read').toEqual([]);
                    });
                }
            }
        });
    }
});
