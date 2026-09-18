import type { McpServer } from '@modelcontextprotocol/server';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerClearShoppingList } from './clearShoppingList.ts';
import { registerCreateRecipe } from './createRecipe.ts';
import { registerDeleteMealPlan } from './deleteMealPlan.ts';
import { registerGetCookLog } from './getCookLog.ts';
import { registerGetMealPlan } from './getMealPlan.ts';
import { registerGetRecipe } from './getRecipe.ts';
import { registerGetShoppingList } from './getShoppingList.ts';
import { registerListReferenceData } from './listReferenceData.ts';
import { registerLogCookedRecipe } from './logCookedRecipe.ts';
import { registerPlanMeals } from './planMeals.ts';
import { registerSearchRecipes } from './searchRecipes.ts';
import { registerSuggestRecipes } from './suggestRecipes.ts';
import { registerUpdatePantry } from './updatePantry.ts';
import { registerUpdateShoppingList } from './updateShoppingList.ts';
import type { WriteContext } from './write.ts';

export function registerAllTools(server: McpServer, deps: { client: TandoorClient; context: WriteContext }): void {
    const { client, context } = deps;
    registerSearchRecipes(server, client);
    registerGetRecipe(server, client);
    registerListReferenceData(server, client);
    registerGetMealPlan(server, client);
    registerGetShoppingList(server, client);
    registerGetCookLog(server, client);
    registerSuggestRecipes(server, client);
    registerCreateRecipe(server, client, context);
    registerPlanMeals(server, client, context);
    registerUpdateShoppingList(server, client, context);
    registerClearShoppingList(server, client, context);
    registerUpdatePantry(server, client, context);
    registerLogCookedRecipe(server, client, context);
    registerDeleteMealPlan(server, client, context);
}
