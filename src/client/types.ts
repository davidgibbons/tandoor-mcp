export type PaginatedResponse<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type Keyword = { id: number; name: string; description?: string | null };
export type Unit = { id: number; name: string; plural_name?: string | null; description?: string | null };
export type Food = { id: number; name: string; plural_name?: string | null; description?: string | null; food_onhand: boolean };
export type MealType = { id: number; name: string; order: number; color?: string; icon?: string | null };

export type RecipeSummary = {
    id: number;
    name: string;
    description?: string | null;
    rating?: number | null;
    servings?: number | null;
    keywords: Keyword[];
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

export type Recipe = RecipeSummary & {
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
    date: string;
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
