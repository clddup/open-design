import { createHash } from "node:crypto";

export interface McpToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpToolCatalog {
  serverId: string;
  tools: McpToolDescriptor[];
  hash: string;
  discoveredAt: string;
}

export interface McpConnection {
  listTools(cursor?: string): Promise<{
    tools: McpToolDescriptor[];
    nextCursor?: string;
  }>;
  callTool(name: string, input: unknown, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export class McpHost {
  readonly #connections = new Map<string, McpConnection>();
  readonly #catalogs = new Map<string, McpToolCatalog>();

  add(serverId: string, connection: McpConnection): void {
    if (!/^[a-z][a-z0-9-]*$/.test(serverId)) {
      throw new Error(`Invalid MCP server id: ${serverId}`);
    }
    if (this.#connections.has(serverId)) {
      throw new Error(`MCP server already connected: ${serverId}`);
    }
    this.#connections.set(serverId, connection);
  }

  async discover(serverId: string): Promise<McpToolCatalog> {
    const connection = this.connection(serverId);
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;

    do {
      const page = await connection.listTools(cursor);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);

    tools.sort((left, right) => left.name.localeCompare(right.name));
    const catalog: McpToolCatalog = {
      serverId,
      tools,
      hash: createHash("sha256").update(JSON.stringify(tools)).digest("hex"),
      discoveredAt: new Date().toISOString(),
    };
    this.#catalogs.set(serverId, catalog);
    return catalog;
  }

  namespacedTools(): Array<
    McpToolDescriptor & { qualifiedName: string; serverId: string }
  > {
    return [...this.#catalogs.values()].flatMap((catalog) =>
      catalog.tools.map((tool) => ({
        ...tool,
        serverId: catalog.serverId,
        qualifiedName: `mcp.${catalog.serverId}.${tool.name}`,
      })),
    );
  }

  async call(
    qualifiedName: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const match = /^mcp\.([a-z][a-z0-9-]*)\.(.+)$/.exec(qualifiedName);
    if (!match?.[1] || !match[2])
      throw new Error(`Invalid MCP tool name: ${qualifiedName}`);
    return this.connection(match[1]).callTool(match[2], input, signal);
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.#connections.values()].map((connection) => connection.close()),
    );
    this.#connections.clear();
    this.#catalogs.clear();
  }

  private connection(serverId: string): McpConnection {
    const connection = this.#connections.get(serverId);
    if (!connection) throw new Error(`MCP server not connected: ${serverId}`);
    return connection;
  }
}
