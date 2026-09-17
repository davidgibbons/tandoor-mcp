import { timingSafeEqual } from 'node:crypto';

export function bearerFromHeader(header: string | undefined): string | undefined {
    const [scheme, value] = (header ?? '').split(' ');
    return scheme?.toLowerCase() === 'bearer' ? (value ?? '') : undefined;
}

export function tokenMatches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length === 0 || a.length !== b.length) {
        timingSafeEqual(b, b);
        return false;
    }
    return timingSafeEqual(a, b);
}
