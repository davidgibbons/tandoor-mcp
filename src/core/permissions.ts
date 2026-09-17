import type { Permissions } from '../config/schema.ts';

export const WRITE_TIERS = ['safe', 'destructive'] as const;
export type WriteTier = (typeof WRITE_TIERS)[number];

const TIER_KEY: Record<WriteTier, string> = { safe: 'safe_write', destructive: 'destructive' };

export type PermissionVerdict =
    | { allowed: true; tier: WriteTier }
    | { allowed: false; tier: WriteTier; reason: string; remedy: string };

/**
 * Ordered tiers: `destructive: true` grants `safe` writes too, because a
 * config permitting deletion but refusing a safe re-add describes no policy
 * anyone would choose on purpose. Both default false.
 */
export function checkPermission(permissions: Permissions, tier: WriteTier): PermissionVerdict {
    const granted = tier === 'safe' ? permissions.safe_write || permissions.destructive : permissions.destructive;
    if (granted) return { allowed: true, tier };

    const key = TIER_KEY[tier];
    const envVar = tier === 'safe' ? 'PERMISSIONS_SAFE_WRITE' : 'PERMISSIONS_DESTRUCTIVE';
    return {
        allowed: false,
        tier,
        reason: `${tier} writes are disabled`,
        remedy: `Set \`permissions.${key}: true\` in config.yaml (or ${envVar}=true) and restart tandoor-mcp. This is off by default.`
    };
}
