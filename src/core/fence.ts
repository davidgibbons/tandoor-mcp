/**
 * Everything Tandoor returns as free text is untrusted data, never
 * instruction. A recipe description or shopping-list note can contain
 * anything its author wrote, including text aimed at whatever reads it next.
 */

export const FENCE_MAX_LENGTH = 2000;

const OPEN = '<<untrusted:';
const CLOSE = '<</untrusted>>';

const DANGEROUS_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x00, 0x08],
    [0x0b, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0xfeff, 0xfeff],
    [0x202a, 0x202e],
    [0x2066, 0x2069]
];

const isDangerous = (codePoint: number): boolean => DANGEROUS_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);

export function stripDangerous(value: string): string {
    if (typeof value !== 'string') return '';
    let out = '';
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && !isDangerous(codePoint)) out += character;
    }
    return out;
}

/**
 * Wraps free text in a labelled boundary naming the field it came from. The
 * value's own angle brackets are escaped first so it cannot close the fence
 * and continue outside it.
 */
export function fenceText(value: string, field: string): string {
    if (typeof value !== 'string' || value === '') return '';

    let clean = stripDangerous(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
    if (clean.length > FENCE_MAX_LENGTH) {
        clean = `${clean.slice(0, FENCE_MAX_LENGTH)}…[truncated]`;
    }

    return `${OPEN}tandoor.${field}>>${clean}${CLOSE}`;
}
