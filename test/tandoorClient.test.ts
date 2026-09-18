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

describe('TandoorClient.getCookLog', () => {
    it('hits /api/cook-log/ with recipe and from_date when given', async () => {
        const fetchImpl = serving({
            '/api/cook-log/?recipe=1&from_date=2026-01-01': {
                count: 1, next: null, previous: null,
                results: [{ id: 1, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, rating: 5, comment: 'great', created: '2026-01-02T00:00:00Z' }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getCookLog({ recipeId: 1, fromDate: '2026-01-01' })).resolves.toMatchObject({ count: 1 });
    });

    it('omits filters that were not given', async () => {
        const fetchImpl = serving({ '/api/cook-log/': { count: 0, next: null, previous: null, results: [] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getCookLog({})).resolves.toMatchObject({ count: 0 });
    });
});

describe('TandoorClient food/unit resolution', () => {
    it('resolveFoodId returns an existing food without creating one', async () => {
        const fetchImpl = serving({ '/api/food/?query=egg&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 4, name: 'egg', food_onhand: false }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.resolveFoodId('egg')).resolves.toEqual({ id: 4, name: 'egg' });
    });

    it('resolveFoodId creates a food when none is found', async () => {
        const fetchImpl = serving({
            '/api/food/?query=durian&page_size=1': { count: 0, next: null, previous: null, results: [] },
            '/api/food/': { id: 99, name: 'durian', food_onhand: false }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.resolveFoodId('durian')).resolves.toEqual({ id: 99, name: 'durian' });
    });

    it('resolveUnitId returns an existing unit without creating one', async () => {
        const fetchImpl = serving({ '/api/unit/?query=cup&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'cup' }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.resolveUnitId('cup')).resolves.toEqual({ id: 2, name: 'cup' });
    });
});

describe('TandoorClient.createRecipe', () => {
    it('posts to /api/recipe/ and returns the created recipe', async () => {
        const fetchImpl = serving({ '/api/recipe/': { id: 5, name: 'New Recipe', keywords: [], steps: [] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const recipe = await client.createRecipe({ name: 'New Recipe', description: '', servings: 2, working_time: 0, waiting_time: 0, keywords: [], steps: [] });
        expect(recipe.id).toBe(5);
    });
});

describe('TandoorClient.createMealPlan', () => {
    it('posts to /api/meal-plan/', async () => {
        const fetchImpl = serving({ '/api/meal-plan/': { id: 1, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, from_date: '2026-01-01T12:00:00-07:00', meal_type: { id: 1, name: 'Dinner', order: 1 } } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const plan = await client.createMealPlan({ recipe: 1, servings: 2, from_date: '2026-01-01', meal_type: 1 });
        expect(plan.id).toBe(1);
    });
});

describe('TandoorClient shopping list writes', () => {
    it('addShoppingListEntry posts food/unit/amount', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/': { id: 1, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const entry = await client.addShoppingListEntry({ food: { id: 1, name: 'egg' }, unit: null, amount: 6 });
        expect(entry.id).toBe(1);
    });

    it('updateShoppingListEntry patches checked', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/1/': { id: 1, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: true } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const entry = await client.updateShoppingListEntry(1, { checked: true });
        expect(entry.checked).toBe(true);
    });

    it('deleteShoppingListEntry deletes and returns nothing', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/1/': null });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.deleteShoppingListEntry(1)).resolves.toBeUndefined();
    });
});

describe('TandoorClient.updateFoodOnHand', () => {
    it('patches food_onhand', async () => {
        const fetchImpl = serving({ '/api/food/1/': { id: 1, name: 'egg', food_onhand: true } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const food = await client.updateFoodOnHand(1, true);
        expect(food.food_onhand).toBe(true);
    });
});

describe('TandoorClient.createCookLog', () => {
    it('posts to /api/cook-log/', async () => {
        const fetchImpl = serving({ '/api/cook-log/': { id: 1, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, rating: 5, comment: 'great', created: '2026-01-01T00:00:00Z' } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const log = await client.createCookLog({ recipe: 1, servings: 2, rating: 5, comment: 'great' });
        expect(log.id).toBe(1);
    });
});

describe('TandoorClient meal plan single-item operations', () => {
    it('getMealPlan fetches one entry by id', async () => {
        const fetchImpl = serving({ '/api/meal-plan/5/': { id: 5, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getMealPlan(5)).resolves.toMatchObject({ id: 5 });
    });

    it('deleteMealPlan deletes by id', async () => {
        const fetchImpl = serving({ '/api/meal-plan/5/': null });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.deleteMealPlan(5)).resolves.toBeUndefined();
    });
});
