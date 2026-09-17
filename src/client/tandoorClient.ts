import { TandoorHttp } from '../core/http.ts';
import type { Food, Keyword, PaginatedResponse, Recipe, RecipeSummary } from './types.ts';

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
}
