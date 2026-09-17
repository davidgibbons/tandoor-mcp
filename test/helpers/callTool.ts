import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';

/**
 * `@modelcontextprotocol/server` v2 ships no `Client` class, and `McpServer.server.request`
 * only sends outbound (server-to-client) requests such as sampling — it cannot simulate an
 * inbound `tools/call`. `InMemoryTransport` is the SDK's own documented pairing for driving
 * a server in-process, so this plays the client's side of the wire by hand: connect the
 * server to one end, send a raw `tools/call` JSON-RPC request on the other, and read back the
 * response. Verified against the SDK source that `tools/call` dispatches before any
 * `initialize` handshake (the wire codec defaults to the legacy era until one negotiates).
 */
export async function callTool(
    server: McpServer,
    name: string,
    args: Record<string, unknown>
): Promise<{ structuredContent?: Record<string, unknown>; isError?: boolean; content: { type: string; text: string }[] }> {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await clientTransport.start();
    const response = await new Promise<{ result?: unknown; error?: { message: string } }>(resolve => {
        clientTransport.onmessage = message => resolve(message as { result?: unknown; error?: { message: string } });
        void clientTransport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    });
    if (response.error) throw new Error(response.error.message);
    return response.result as { structuredContent?: Record<string, unknown>; isError?: boolean; content: { type: string; text: string }[] };
}
