import * as z from 'zod/v4';

export const PermissionsSchema = z
    .object({
        safe_write: z.boolean().default(false),
        destructive: z.boolean().default(false)
    })
    .default({ safe_write: false, destructive: false });
export type Permissions = z.infer<typeof PermissionsSchema>;

const UrlSchema = z.url().refine(u => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'must be an http:// or https:// URL'
});

export const ConfigSchema = z.strictObject({
    tandoor: z.strictObject({
        url: UrlSchema,
        token: z.string().min(1, 'tandoor.token must not be empty'),
        timeout_ms: z.number().int().positive().default(10_000)
    }),
    mcp: z.strictObject({
        bearer_token: z.string().min(32, 'mcp.bearer_token must be at least 32 characters'),
        bind_addr: z.string().default('127.0.0.1:6061'),
        allowed_hosts: z.array(z.string()).default([])
    }),
    permissions: PermissionsSchema
});
export type Config = z.infer<typeof ConfigSchema>;
