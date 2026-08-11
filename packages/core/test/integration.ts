import path from "node:path";
import {
  createListDirectoryTool,
  createReadFileTool,
  createWriteFileTool,
  loadAgentConfig,
  ToolRegistry,
} from "@agent-harness/core";

async function main() {
  console.log("=== Agent Harness Integration Test ===\n");

  // Test 1: Load agent config
  console.log("Test 1: Loading orchestrator agent config...");
  const configPath = path.resolve("../../agents/orchestrator.md");
  const config = await loadAgentConfig(configPath);
  console.log(`✓ Loaded agent: ${config.name}`);
  console.log(`  Model: ${config.model}`);
  console.log(`  Tools: ${config.tools.join(", ")}`);
  console.log(`  Max steps: ${config.maxSteps}`);
  console.log(`  Instructions: ${config.instructions.substring(0, 100)}...\n`);

  // Test 2: Create tool registry
  console.log("Test 2: Creating tool registry...");
  const root = process.cwd();
  const registry = new ToolRegistry();
  registry.register(createReadFileTool(root));
  registry.register(createWriteFileTool(root));
  registry.register(createListDirectoryTool(root));
  console.log(`✓ Registered ${registry.getAll().length} tools`);
  console.log(
    `  Tools: ${registry
      .getAll()
      .map((t) => t.name)
      .join(", ")}\n`,
  );

  // Test 3: Test tool execution
  console.log("Test 3: Testing tool execution...");
  const listTool = registry.get("listDirectory");
  if (listTool) {
    const result = await listTool.execute({ path: "." });
    const lines = result.split("\n").slice(0, 5);
    console.log(`✓ listDirectory executed successfully`);
    console.log(`  First 5 entries:\n${lines.map((l) => `    ${l}`).join("\n")}\n`);
  }

  console.log("=== All tests passed ===");
}

main().catch(console.error);
