import { connect, getTools, disconnect } from "./core/mcp.mjs";

console.log("=== Prueba de conexión MCP ===\n");

try {
  const { serverInfo, tools } = await connect();

  console.log("\nServidor:", serverInfo.name, serverInfo.version);
  console.log("\nHerramientas disponibles:");
  tools.forEach(t => console.log(`  - ${t.name}: ${t.description?.slice(0,60) ?? ""}...`));

  disconnect();
  console.log("\n✓ Prueba MCP completada");

} catch (err) {
  console.error("\n✗ Error:", err.message);
  process.exit(1);
}
