import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import type { CreateRecipeRequest, CreateStepIngredientRequest } from '../client/types.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

const AMOUNT = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/;
const NOTE = /^(.*?)\s*\(([^)]+)\)\s*$/;

type ParsedIngredient = { amount: string; unit?: string; food: string; note?: string };

/** The parsed-but-unresolved shape carried in `WritePlan.args` between the
 *  preview call and the confirm call. Deliberately holds no Tandoor ids:
 *  `plan()` must stay pure (no network calls) so a preview never creates
 *  anything, and so it returns identical `args` on both calls — the confirm
 *  token is an HMAC over `args`, and re-running `plan()` on the confirm call
 *  must reproduce it exactly. */
type PlannedRequest = {
    name: string;
    description: string;
    servings: number | undefined;
    working_time: number;
    waiting_time: number;
    keywords: { name: string }[];
    instructions_block: string;
    ingredients: ParsedIngredient[];
};

/** Tandoor's `amount` field is a decimal, not free text — it 400s on "1/2".
 *  Converts a parsed amount ("2", "1/2", "1 1/2") to the decimal string Tandoor accepts. */
export function toDecimalAmount(amount: string): string {
    const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(amount);
    if (mixed) return String(Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]));

    const fraction = /^(\d+)\/(\d+)$/.exec(amount);
    if (fraction) return String(Number(fraction[1]) / Number(fraction[2]));

    return amount;
}

/**
 * ponytail: a fixed-shape "[amount] [unit] food [(note)]" parser, not a
 * natural-language ingredient parser. Good enough for straightforward
 * ingredient lists; upgrade to Tandoor's own ingredient-parsing endpoint if
 * one is confirmed to exist (see Task 28) and free-text amounts prove common.
 */
export function parseIngredientLine(line: string): ParsedIngredient {
    const trimmed = line.trim();
    const noteMatch = NOTE.exec(trimmed);
    const withoutNote = noteMatch ? (noteMatch[1] as string).trim() : trimmed;
    const note = noteMatch ? (noteMatch[2] as string).trim() : undefined;

    const amountMatch = AMOUNT.exec(withoutNote);
    if (!amountMatch) return note === undefined ? { amount: '1', food: withoutNote } : { amount: '1', food: withoutNote, note };

    const amount = amountMatch[1] as string;
    const rest = (amountMatch[2] as string).trim();
    const words = rest.split(/\s+/);
    if (words.length >= 2) {
        const result = { amount, unit: words[0] as string, food: words.slice(1).join(' ') };
        return note === undefined ? result : { ...result, note };
    }
    return note === undefined ? { amount, food: rest } : { amount, food: rest, note };
}

export function registerCreateRecipe(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'create_recipe',
        title: 'Create a recipe',
        description:
            'Creates a new Tandoor recipe from a plain ingredients block (one ingredient per line, e.g. "2 cups flour" or "1/2 tsp salt (fine)") and an instructions block. Resolves each ingredient\'s food and unit by searching Tandoor first and creating them only if nothing matches. Previews by default — call again with the returned `confirm` token to actually create it.',
        inputSchema: z.object({
            name: z.string().min(1).describe('Recipe name.'),
            description: z.string().optional().describe('Optional short description.'),
            servings: z.number().positive().optional().describe('Number of servings this recipe produces.'),
            prep_time_minutes: z.number().int().nonnegative().optional().describe('Active prep/cook time in minutes.'),
            cook_time_minutes: z.number().int().nonnegative().optional().describe('Passive waiting time in minutes.'),
            keywords: z.array(z.string()).optional().describe('Keyword/tag names to attach.'),
            ingredients_block: z.string().min(1).describe('One ingredient per line.'),
            instructions_block: z.string().min(1).describe('Free-text cooking instructions, one step.')
        }),
        operation: 'create_recipe',
        tier: 'safe',

        plan({ name, description, servings, prep_time_minutes, cook_time_minutes, keywords, ingredients_block, instructions_block }): Promise<WritePlan> {
            const ingredients = ingredients_block
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0)
                .map(parseIngredientLine);

            const request: PlannedRequest = {
                name,
                description: description ?? '',
                servings,
                working_time: prep_time_minutes ?? 0,
                waiting_time: cook_time_minutes ?? 0,
                keywords: (keywords ?? []).map(k => ({ name: k })),
                instructions_block,
                ingredients
            };

            return Promise.resolve({
                target: name,
                summary: `Create recipe "${name}" with ${ingredients.length} ingredient(s).`,
                effects: [`Resolves or creates ${ingredients.length} food/unit entr${ingredients.length === 1 ? 'y' : 'ies'} in Tandoor.`, `Adds a new recipe named "${name}".`],
                args: { request }
            });
        },

        // Resolution and creation happen here, not in plan(), so a preview
        // never touches Tandoor and each ingredient is resolved exactly once.
        async apply(plan) {
            const { request } = plan.args as { request: PlannedRequest };

            const ingredients: CreateStepIngredientRequest[] = [];
            for (const [index, parsed] of request.ingredients.entries()) {
                const food = await client.resolveFoodId(parsed.food);
                const unit = parsed.unit !== undefined ? await client.resolveUnitId(parsed.unit) : null;
                ingredients.push({
                    food,
                    unit,
                    amount: toDecimalAmount(parsed.amount),
                    ...(parsed.note === undefined ? {} : { note: parsed.note }),
                    order: index,
                    is_header: false,
                    no_amount: false
                });
            }

            const payload: CreateRecipeRequest = {
                name: request.name,
                description: request.description,
                ...(request.servings === undefined ? {} : { servings: request.servings }),
                working_time: request.working_time,
                waiting_time: request.waiting_time,
                keywords: request.keywords,
                steps: [{ instruction: request.instructions_block, order: 1, ingredients }]
            };
            return client.createRecipe(payload);
        }
    });
}
