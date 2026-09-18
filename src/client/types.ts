export type PaginatedResponse<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type Keyword = { id: number; name: string; description?: string | null };
export type Unit = { id: number; name: string; plural_name?: string | null; description?: string | null };
export type Food = { id: number; name: string; plural_name?: string | null; description?: string | null; food_onhand: boolean };
export type MealType = { id: number; name: string; order: number; color?: string; icon?: string | null };

/** The shape a keyword takes nested inside a recipe *list* result
 *  (`/api/recipe/`) — confirmed against a real instance to carry only
 *  `id`/`label`, not the full `Keyword` shape `/api/recipe/{id}/` embeds. */
export type KeywordRef = { id: number; label: string };

export type RecipeSummary = {
    id: number;
    name: string;
    description?: string | null;
    rating?: number | null;
    servings?: number | null;
    keywords: KeywordRef[];
};

export type StepIngredient = {
    id: number;
    food: Food;
    unit: Unit | null;
    amount: number;
    note?: string | null;
    is_header: boolean;
    no_amount: boolean;
};

export type Step = { id: number; name: string; instruction: string; ingredients: StepIngredient[]; order: number };

export type Recipe = Omit<RecipeSummary, 'keywords'> & {
    keywords: Keyword[];
    steps: Step[];
    working_time?: number | null;
    waiting_time?: number | null;
    created_at?: string;
    updated_at?: string;
};

export type MealPlan = {
    id: number;
    title?: string | null;
    recipe: RecipeSummary | null;
    servings: number;
    note?: string | null;
    from_date: string;
    meal_type: MealType;
};

export type ShoppingListEntry = {
    id: number;
    food: Food;
    unit: Unit | null;
    amount: number;
    checked: boolean;
    created?: string;
};

export type CookLog = {
    id: number;
    recipe: RecipeSummary;
    servings: number;
    rating?: number | null;
    comment?: string | null;
    created: string;
};

export type CreateStepIngredientRequest = {
    food: { id: number; name: string };
    unit: { id: number; name: string } | null;
    amount: string;
    note?: string;
    order: number;
    is_header: boolean;
    no_amount: boolean;
};
export type CreateStepRequest = { name?: string; instruction: string; order: number; ingredients: CreateStepIngredientRequest[] };
export type CreateRecipeRequest = {
    name: string;
    description?: string;
    servings?: number;
    working_time: number;
    waiting_time: number;
    keywords: { name: string }[];
    steps: CreateStepRequest[];
};

export type CreateMealPlanRequest = { recipe: number | null; title?: string; servings: number; from_date: string; meal_type: number; note?: string };
