import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Permissions } from '../config/schema.ts';
import type { WriteAudit } from '../core/audit.ts';
import type { ConfirmTokens, WriteIntent } from '../core/confirm.ts';
import { ServiceError } from '../core/errors.ts';
import { checkPermission, type WriteTier } from '../core/permissions.ts';
import { toolInput } from '../core/shape.ts';

export type WritePlan = {
    target: string;
    summary: string;
    effects: string[];
    args?: Record<string, unknown>;
    noop?: boolean;
};

export type WriteToolSpec<Schema extends z.ZodObject> = {
    name: string;
    title: string;
    description: string;
    inputSchema: Schema;
    operation: string;
    tier: WriteTier;
    plan(args: z.infer<Schema>): Promise<WritePlan>;
    apply(plan: WritePlan, args: z.infer<Schema>): Promise<unknown>;
    applied?(outcome: unknown, plan: WritePlan): string | undefined;
};

export type WriteContext = {
    permissions: Permissions;
    confirm: ConfirmTokens;
    audit: WriteAudit;
};

const DryRunSchema = z
    .boolean()
    .default(false)
    .describe('Preview only: resolve the target and describe what would happen, then stop. Never mutates and never returns a confirmation token.');

const ConfirmSchema = z
    .string()
    .optional()
    .describe("The confirmation token from this same tool's preview of this same operation. Omit it to get a preview and a token; pass the token back verbatim to apply the change.");

const WriteOutputSchema = z.looseObject({
    applied: z.boolean(),
    dry_run: z.boolean(),
    tool: z.string(),
    operation: z.string(),
    tier: z.enum(['safe', 'destructive']),
    target: z.string(),
    summary: z.string(),
    effects: z.array(z.string()),
    noop: z.boolean(),
    permission: z.looseObject({ allowed: z.boolean(), reason: z.string().optional(), remedy: z.string().optional() }),
    confirm_token: z.string().optional(),
    confirm_error: z.string().optional(),
    result: z.unknown().optional(),
    audit_id: z.number().optional()
});

export type WriteToolResult = {
    applied: boolean;
    dry_run: boolean;
    tool: string;
    operation: string;
    tier: WriteTier;
    target: string;
    summary: string;
    effects: string[];
    noop: boolean;
    permission: { allowed: boolean; reason?: string; remedy?: string };
    confirm_token?: string;
    confirm_error?: string;
    result?: unknown;
    audit_id?: number;
};

/**
 * Turns a plan/apply pair into an MCP tool with permission tier, dry_run, the
 * audit record, and per-call confirmation handled once. A tool physically
 * cannot mutate during preview, because preview only calls `plan`.
 */
export function registerWriteTool<Schema extends z.ZodObject>(server: McpServer, context: WriteContext, spec: WriteToolSpec<Schema>): void {
    const { permissions, confirm, audit } = context;

    server.registerTool(
        spec.name,
        {
            title: spec.title,
            annotations: { readOnlyHint: false, destructiveHint: spec.tier === 'destructive' },
            description: spec.description,
            inputSchema: toolInput({ ...spec.inputSchema.shape, dry_run: DryRunSchema, confirm: ConfirmSchema }),
            outputSchema: WriteOutputSchema
        },
        async (raw: Record<string, unknown>) => {
            const { dry_run: dryRun, confirm: presented, ...rest } = raw as { dry_run: boolean; confirm?: string };
            const args = rest as z.infer<Schema>;

            const plan = await spec.plan(args);
            const verdict = checkPermission(permissions, spec.tier);
            const permission: WriteToolResult['permission'] = verdict.allowed
                ? { allowed: true }
                : { allowed: false, reason: verdict.reason, remedy: verdict.remedy };

            const record = { tool: spec.name, operation: spec.operation, tier: spec.tier, target: plan.target, args: plan.args ?? {} };

            const preview = (extra: Partial<WriteToolResult>): WriteToolResult => ({
                applied: false,
                dry_run: dryRun,
                tool: spec.name,
                operation: spec.operation,
                tier: spec.tier,
                target: plan.target,
                summary: plan.summary,
                effects: plan.effects,
                noop: plan.noop === true,
                permission,
                ...extra
            });

            const respond = (result: WriteToolResult, text: string) => ({
                content: [{ type: 'text' as const, text }],
                structuredContent: result
            });

            if (plan.noop === true) {
                const id = audit.begin(record);
                audit.settle(id, 'dry_run', 'no-op: already in the requested state');
                return respond(preview({ audit_id: id }), `Nothing to do — ${plan.summary} No change was made and no confirmation is needed.`);
            }

            if (dryRun) {
                const id = audit.begin(record);
                audit.settle(id, 'dry_run', verdict.allowed ? undefined : verdict.reason);
                return respond(
                    preview({ audit_id: id }),
                    `Dry run — nothing was changed. ${plan.summary}` +
                        (verdict.allowed ? ' Omit `dry_run` to preview it for real and receive a confirmation token.' : ` Note that this write would currently be refused: ${verdict.reason}. ${verdict.remedy}`)
                );
            }

            if (!verdict.allowed) {
                const id = audit.begin(record);
                audit.settle(id, 'denied', verdict.reason);
                throw new ServiceError('PermissionDenied', verdict.reason, { remedy: verdict.remedy });
            }

            const intent: WriteIntent = {
                tool: spec.name,
                tier: spec.tier,
                operation: spec.operation,
                target: plan.target,
                ...(plan.args === undefined ? {} : { args: plan.args })
            };

            if (presented !== undefined) {
                const check = confirm.verifyAndConsume(presented, intent);
                if (!check.ok) {
                    if (check.failure === 'used') {
                        const id = audit.begin(record);
                        audit.settle(id, 'denied', 'confirmation token already used');
                        throw new ServiceError('PermissionDenied', 'confirmation token already used', { remedy: check.remedy });
                    }
                    const id = audit.begin(record);
                    audit.settle(id, 'unconfirmed', `confirmation ${check.failure}`);
                    const fresh = confirm.issue(intent);
                    return respond(
                        preview({ audit_id: id, confirm_error: check.remedy, confirm_token: fresh }),
                        `Not applied — the confirmation token was rejected (${check.failure}). Do not resend the rejected one. To apply this, call ${spec.name} again with the same arguments plus \`confirm\` set to \`${fresh}\`.`
                    );
                }
            } else {
                const id = audit.begin(record);
                audit.settle(id, 'unconfirmed');
                const token = confirm.issue(intent);
                return respond(
                    preview({ audit_id: id, confirm_token: token }),
                    `Not applied yet. ${plan.summary}\n\n${plan.effects.map(e => `- ${e}`).join('\n')}\n\nTo apply this, call ${spec.name} again with the same arguments plus \`confirm\` set to \`${token}\`.`
                );
            }

            const id = audit.begin(record);
            let outcome: unknown;
            try {
                outcome = await spec.apply(plan, args);
            } catch (err) {
                audit.settle(id, 'failed', err instanceof Error ? err.message : String(err));
                throw err;
            }

            audit.settle(id, 'applied');
            return respond(
                { ...preview({ audit_id: id }), applied: true, ...(outcome === undefined ? {} : { result: outcome }) },
                spec.applied?.(outcome, plan) ?? `Applied. ${plan.summary}`
            );
        }
    );
}
