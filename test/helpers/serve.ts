export const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake fetch answering a path[+query]->body map, 404 for anything else. */
export const serving = (routes: Record<string, unknown>): typeof fetch =>
    (input: string | URL | Request) => {
        const raw = input instanceof Request ? input.url : String(input);
        const url = new URL(raw);
        const withQuery = `${url.pathname}${url.search}`;
        const key = withQuery in routes ? withQuery : url.pathname;
        if (!(key in routes)) return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
        return Promise.resolve(jsonResponse(routes[key]));
    };
