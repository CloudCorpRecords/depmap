/**
 * depmap MCP server. Tools: map_internal_dependencies.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schema as an explicit literal, and every
 * tools/call is validated by the core, which names the
 * offending path on invalid input.
 *
 * The mapping is pure local computation: no upstream API,
 * no authentication, no configuration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { formatPayload, mapInternalDependencies, VERSION } from "./depmap.js";

const TOOLS = [
  {
    name: "map_internal_dependencies",
    description:
      "Map a monorepo's internal dependencies: which packages depend on which, the roots, the leaves, any cycles, and the map as a Mermaid graph.",
    inputSchema: {
      type: "object" as const,
      properties: {
        packages: {
          type: "array",
          description: "Packages in the monorepo (at least one)",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Package name (unique across the set)" },
              dependencies: {
                type: "array",
                description:
                  "Names this package depends on; names outside the set are external and counted, not mapped (optional, default [])",
                items: { type: "string" },
              },
            },
            required: ["name"],
          },
        },
      },
      required: ["packages"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "depmap", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "map_internal_dependencies") {
      const raw = (args ?? {}) as Record<string, unknown>;
      out = mapInternalDependencies(raw.packages);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
