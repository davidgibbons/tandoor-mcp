import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { serving } from './helpers/serve.ts';

describe('TandoorClient.searchRecipes', () => {
    it('builds the query string from query/rating/limit and returns results', async () => {
        const fetchImpl = serving({
            '/api/recipe/?query=pasta&rating=4&page_size=10': {
                count: 1,
                next: null,
                previous: null,
                results: [{ id: 1, name: 'Pasta', description: 'Tasty', rating: 4, servings: 2, keywords: [] }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const result = await client.searchRecipes({ query: 'pasta', rating: 4, limit: 10 });
        expect(result.count).toBe(1);
        expect(result.results[0]?.name).toBe('Pasta');
    });

    it('adds keywords_or and foods_or when keywordId/foodId are given', async () => {
        const fetchImpl = serving({
            '/api/recipe/?keywords_or=3&foods_or=7&page_size=50': { count: 0, next: null, previous: null, results: [] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.searchRecipes({ keywordId: 3, foodId: 7 })).resolves.toMatchObject({ count: 0 });
    });

    it('searchKeywords hits /api/keyword/', async () => {
        const fetchImpl = serving({ '/api/keyword/?query=dinner&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 9, name: 'dinner' }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.searchKeywords('dinner', 1)).resolves.toMatchObject({ count: 1 });
    });

    it('searchFoods hits /api/food/', async () => {
        const fetchImpl = serving({ '/api/food/?query=egg&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 4, name: 'egg', food_onhand: false }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.searchFoods('egg', 1)).resolves.toMatchObject({ count: 1 });
    });
});

describe('TandoorClient.getRecipe', () => {
    it('fetches a single recipe by id', async () => {
        const fetchImpl = serving({
            '/api/recipe/1/': {
                id: 1,
                name: 'Pasta',
                description: 'Tasty',
                rating: 4,
                servings: 2,
                keywords: [],
                steps: [{ id: 1, name: '', instruction: 'Boil water.', order: 1, ingredients: [{ id: 1, food: { id: 1, name: 'pasta', food_onhand: false }, unit: { id: 1, name: 'g' }, amount: 200, is_header: false, no_amount: false }] }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const recipe = await client.getRecipe(1);
        expect(recipe.steps[0]?.ingredients[0]?.amount).toBe(200);
    });
});

describe('TandoorClient.getUnits', () => {
    it('hits /api/unit/', async () => {
        const fetchImpl = serving({ '/api/unit/?page_size=50': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'cup' }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getUnits()).resolves.toMatchObject({ count: 1 });
    });
});

describe('TandoorClient.getMealTypes', () => {
    it('hits /api/meal-type/', async () => {
        const fetchImpl = serving({ '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Dinner', order: 1 }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getMealTypes()).resolves.toMatchObject({ count: 1 });
    });
});

describe('TandoorClient.getMealPlans', () => {
    it('hits /api/meal-plan/ with from_date/to_date', async () => {
        const fetchImpl = serving({
            '/api/meal-plan/?from_date=2026-01-01&to_date=2026-01-07': {
                count: 1, next: null, previous: null,
                results: [{ id: 1, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getMealPlans('2026-01-01', '2026-01-07')).resolves.toMatchObject({ count: 1 });
    });
});

describe('TandoorClient.getShoppingList', () => {
    it('returns results from a standard paginated response', async () => {
        const fetchImpl = serving({
            '/api/shopping-list-entry/': { count: 1, next: null, previous: null, results: [{ id: 1, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false }] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getShoppingList()).resolves.toMatchObject({ count: 1 });
    });

    it('normalizes a bare-array response (seen on some Tandoor versions when the list is empty)', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/': [] });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getShoppingList()).resolves.toEqual({ count: 0, next: null, previous: null, results: [] });
    });
});
