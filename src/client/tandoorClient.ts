import { TandoorHttp } from '../core/http.ts';
import type { CookLog, Food, Keyword, MealPlan, MealType, PaginatedResponse, Recipe, RecipeSummary, ShoppingListEntry, Unit } from './types.ts';

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
        const params = new URLSearchParams({ page_size: String(limit) });
        if (query !== undefined) params.set('query', query);
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
}
