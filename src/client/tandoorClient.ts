import { TandoorHttp } from '../core/http.ts';
import type { CookLog, CreateMealPlanRequest, CreateRecipeRequest, Food, Keyword, MealPlan, MealType, PaginatedResponse, Recipe, RecipeSummary, ShoppingListEntry, Unit } from './types.ts';

export class TandoorClient {
    readonly #http: TandoorHttp;

    constructor(baseUrl: string, token: string, timeoutMs: number, fetchImpl?: typeof fetch) {
        this.#http = new TandoorHttp(baseUrl, token, timeoutMs, fetchImpl);
    }

    async searchRecipes(opts: {
        query?: string | undefined;
        keywordId?: number | undefined;
        foodId?: number | undefined;
        rating?: number | undefined;
        limit?: number | undefined;
    }): Promise<PaginatedResponse<RecipeSummary>> {
        const params = new URLSearchParams();
        if (opts.query !== undefined) params.set('query', opts.query);
        if (opts.keywordId !== undefined) params.set('keywords_or', String(opts.keywordId));
        if (opts.foodId !== undefined) params.set('foods_or', String(opts.foodId));
        if (opts.rating !== undefined) params.set('rating', String(opts.rating));
        params.set('page_size', String(opts.limit ?? 50));
        return this.#http.get(`/api/recipe/?${params.toString()}`);
    }

    async searchKeywords(query: string, limit = 50): Promise<PaginatedResponse<Keyword>> {
        const params = new URLSearchParams({ query, page_size: String(limit) });
        return this.#http.get(`/api/keyword/?${params.toString()}`);
    }

    async searchFoods(query: string, limit = 50): Promise<PaginatedResponse<Food>> {
        const params = new URLSearchParams({ query, page_size: String(limit) });
        return this.#http.get(`/api/food/?${params.toString()}`);
    }

    async getRecipe(id: number): Promise<Recipe> {
        return this.#http.get(`/api/recipe/${id}/`);
    }

    async getUnits(query?: string, limit = 50): Promise<PaginatedResponse<Unit>> {
        // Build with `query` first when present, matching searchFoods' param order.
        const params = query !== undefined ? new URLSearchParams({ query, page_size: String(limit) }) : new URLSearchParams({ page_size: String(limit) });
        return this.#http.get(`/api/unit/?${params.toString()}`);
    }

    async getMealTypes(): Promise<PaginatedResponse<MealType>> {
        return this.#http.get('/api/meal-type/');
    }

    async getMealPlans(fromDate: string, toDate: string): Promise<PaginatedResponse<MealPlan>> {
        const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
        return this.#http.get(`/api/meal-plan/?${params.toString()}`);
    }

    async getShoppingList(): Promise<PaginatedResponse<ShoppingListEntry>> {
        const raw = await this.#http.get<PaginatedResponse<ShoppingListEntry> | ShoppingListEntry[]>('/api/shopping-list-entry/');
        if (Array.isArray(raw)) return { count: raw.length, next: null, previous: null, results: raw };
        return raw;
    }

    async getCookLog(opts: { recipeId?: number; fromDate?: string }): Promise<PaginatedResponse<CookLog>> {
        const params = new URLSearchParams();
        if (opts.recipeId !== undefined) params.set('recipe', String(opts.recipeId));
        if (opts.fromDate !== undefined) params.set('from_date', opts.fromDate);
        const query = params.toString();
        return this.#http.get(`/api/cook-log/${query ? `?${query}` : ''}`);
    }

    async createFood(name: string): Promise<Food> {
        return this.#http.post('/api/food/', { name });
    }

    /** Searches by name first; creates the food only when nothing matches. */
    async resolveFoodId(name: string): Promise<{ id: number; name: string }> {
        const found = await this.searchFoods(name, 1);
        const match = found.results[0];
        if (match !== undefined) return { id: match.id, name: match.name };
        const created = await this.createFood(name);
        return { id: created.id, name: created.name };
    }

    async createUnit(name: string): Promise<Unit> {
        return this.#http.post('/api/unit/', { name });
    }

    /** Searches by name first; creates the unit only when nothing matches. */
    async resolveUnitId(name: string): Promise<{ id: number; name: string }> {
        const found = await this.getUnits(name, 1);
        const match = found.results[0];
        if (match !== undefined) return { id: match.id, name: match.name };
        const created = await this.createUnit(name);
        return { id: created.id, name: created.name };
    }

    async createRecipe(payload: CreateRecipeRequest): Promise<Recipe> {
        return this.#http.post('/api/recipe/', payload);
    }

    async createMealPlan(payload: CreateMealPlanRequest): Promise<MealPlan> {
        return this.#http.post('/api/meal-plan/', payload);
    }

    async addShoppingListEntry(payload: { food: { id: number; name: string }; unit: { id: number; name: string } | null; amount: number }): Promise<ShoppingListEntry> {
        return this.#http.post('/api/shopping-list-entry/', payload);
    }

    async updateShoppingListEntry(id: number, payload: { checked?: boolean }): Promise<ShoppingListEntry> {
        return this.#http.patch(`/api/shopping-list-entry/${id}/`, payload);
    }

    async deleteShoppingListEntry(id: number): Promise<void> {
        await this.#http.delete(`/api/shopping-list-entry/${id}/`);
    }

    async updateFoodOnHand(id: number, onHand: boolean): Promise<Food> {
        return this.#http.patch(`/api/food/${id}/`, { food_onhand: onHand });
    }

    async createCookLog(payload: { recipe: number; servings: number; rating?: number; comment?: string }): Promise<CookLog> {
        return this.#http.post('/api/cook-log/', payload);
    }

    /** Inferred from Tandoor's uniform DRF-ViewSet convention, not directly observed —
     *  verify during Task 28's fixture capture. If it 404s, fall back to filtering
     *  getMealPlans over a wide date range and matching `id` client-side. */
    async getMealPlan(id: number): Promise<MealPlan> {
        return this.#http.get(`/api/meal-plan/${id}/`);
    }

    async deleteMealPlan(id: number): Promise<void> {
        await this.#http.delete(`/api/meal-plan/${id}/`);
    }
}
