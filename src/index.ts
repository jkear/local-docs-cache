import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as types from "@modelcontextprotocol/sdk/types.js";

import { z } from "zod"; // Import Zod
import fs from "fs/promises";
import { fileURLToPath } from 'url';
import path from "path";
import { dirname } from 'path';

// Define paths relative to the script location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDir = path.resolve(__dirname, '..'); // Go up one level from dist/ to the project root
const cacheDir = path.join(baseDir, 'cache');
const indexFilePath = path.join(baseDir, 'index.json');

// Define the structure for the index file
interface CacheIndex {
  [libraryName: string]: string; // Maps library name to file path within cacheDir
}

// Helper function to read the index file
async function readIndex(): Promise<CacheIndex> {
  try {
    const data = await fs.readFile(indexFilePath, 'utf-8');
    return JSON.parse(data) as CacheIndex;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Index file doesn't exist, return empty index
      return {};
    }
    console.error("Error reading index file:", error);
    throw new Error("Could not read cache index.");
  }
}

// Helper function to write to the index file
async function writeIndex(index: CacheIndex): Promise<void> {
  try {
    await fs.writeFile(indexFilePath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (error) {
    console.error("Error writing index file:", error);
    throw new Error("Could not update cache index.");
  }
}

// Helper function to sanitize library names for use as filenames
function sanitizeLibraryName(name: string): string {
  // Replace non-alphanumeric characters (except ., -, _) with underscores
  // Also handle potential path traversal characters just in case
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.\./g, '_');
}

// --- Main Server Logic ---
async function main() {
  console.log("Starting Local Docs Cache MCP Server...");
  console.log(`Base directory: ${baseDir}`);
  console.log(`Cache directory: ${cacheDir}`);
  console.log(`Index file path: ${indexFilePath}`);

  // Ensure cache directory exists
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    console.log("Cache directory ensured.");
  } catch (error) {
    console.error("Error creating cache directory:", error);
    process.exit(1); // Exit if we can't create the cache directory
  }

  // --- Define Tool Schemas using Zod ---
  const GetCachedDocsInputSchema = z.object({
    libraryName: z.string().describe("The name of the library/framework to retrieve documentation for."),
  });
  const GetCachedDocsOutputSchema = z.object({
    status: z.union([z.literal("found"), z.literal("not_found")]).describe("Indicates if the documentation was found in the cache."),
    content: z.string().optional().describe("The cached documentation content, if found."),
  }).describe("Result of the cache lookup.");
  type GetCachedDocsInput = z.infer<typeof GetCachedDocsInputSchema>;
  type GetCachedDocsOutput = z.infer<typeof GetCachedDocsOutputSchema>;


  const CacheDocsInputSchema = z.object({
    libraryName: z.string().describe("The name of the library/framework being cached."),
    content: z.string().describe("The documentation content to cache."),
  });
  const CacheDocsOutputSchema = z.object({
    status: z.union([z.literal("success"), z.literal("error")]).describe("Indicates if caching was successful."),
    message: z.string().optional().describe("An optional message, e.g., an error description."),
  }).describe("Result of the caching operation.");
  type CacheDocsInput = z.infer<typeof CacheDocsInputSchema>;
  type CacheDocsOutput = z.infer<typeof CacheDocsOutputSchema>;


  // --- Initialize Server ---
  const server = new McpServer(
    {
      name: "local-docs-cache",
      version: "0.1.0",
      displayName: "Local Documentation Cache",
      description: "MCP server to cache and retrieve documentation locally.",
    },
    {
      capabilities: {
        tools: { // Use the Zod schemas here
          get_cached_docs: {
            description: "Retrieves cached documentation for a given library.",
            inputSchema: GetCachedDocsInputSchema,
            outputSchema: GetCachedDocsOutputSchema,
          },
          cache_docs: {
            description: "Saves documentation content to the local cache.",
            inputSchema: CacheDocsInputSchema,
            outputSchema: CacheDocsOutputSchema,
          },
        },
        resources: {},
        prompts: {},
      },
    }
  );

  // --- Tool Implementations ---

  // Define get_cached_docs tool
  server.tool("get_cached_docs", { libraryName: z.string().describe("The name of the library/framework to retrieve documentation for.") }, async (args: GetCachedDocsInput, extra: any) => { // Return type inferred
    const { libraryName } = args;
    console.log(`Received request to get cached docs for: ${libraryName}`);
    try {
      const index = await readIndex();
      const sanitizedName = sanitizeLibraryName(libraryName);
      const filePath = index[sanitizedName];

      if (filePath) {
        const fullPath = path.join(cacheDir, filePath);
        console.log(`Found in index. Reading from: ${fullPath}`);
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          console.log(`Successfully read content for ${libraryName}.`);
          // McpServer.tool expects the handler to return the output directly
          return { content: [{ type: "text", text: content }] }; // Wrap content in standard MCP format
        } catch (readError) {
          console.error(`Error reading cache file ${fullPath}:`, readError);
          return { content: [], _meta: { isError: true, message: "Cached documentation not found." } };
        }
      } else {
        console.log(`${libraryName} not found in index.`);
        return { content: [], _meta: { isError: true, message: "Cached documentation not found." } };
      }
    } catch (error) {
      console.error("Error in get_cached_docs handler:", error);
      return { content: [], _meta: { isError: true, message: "Cached documentation not found." } };
    }
  });

  // Define cache_docs tool
  server.tool("cache_docs", { libraryName: z.string().describe("The name of the library/framework being cached."), content: z.string().describe("The documentation content to cache.") }, async (args: CacheDocsInput, extra: any) => { // Return type inferred
    const { libraryName, content } = args;
    console.log(`Received request to cache docs for: ${libraryName}`);
    try {
      const index = await readIndex();
      const sanitizedName = sanitizeLibraryName(libraryName);
      const filename = `${sanitizedName}.md`; // Assume markdown for now
      const fullPath = path.join(cacheDir, filename);

      console.log(`Writing content to: ${fullPath}`);
      await fs.writeFile(fullPath, content, 'utf-8');

      // Update index
      index[sanitizedName] = filename;
      await writeIndex(index);

      console.log(`Successfully cached docs for ${libraryName}.`);
      // Return success with a simple text message in the standard format
      return { content: [{ type: "text", text: `Successfully cached docs for ${libraryName}.` }] };
    } catch (error: any) {
      console.error("Error in cache_docs handler:", error);
      // Return error in the standard format
      return { content: [], _meta: { isError: true, message: error.message || "Failed to cache documentation." } };
    }
  });

  // --- Start Server ---
  try {
    const transport = new StdioServerTransport();
    console.log("Connecting transport...");
    await server.connect(transport);
    console.log("Local Docs Cache MCP Server connected and running.");
  } catch (error) {
    console.error("Failed to start or connect the server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});
// Trigger re-analysis after npm install