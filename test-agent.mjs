import { startModel, stopModel }  from "./core/model.mjs";
import { connect, disconnect }    from "./core/mcp.mjs";
import { runInstruction }         from "./core/agent.mjs";

console.log("=== Prueba del agente completo ===\n");

try {
  // 1. Cargar modelo
  await startModel();

  // 2. Conectar a Godot
  console.log("\nConectando a server MCP...");
  await connect();

  // 3. Ejecutar instrucción real

  const respuesta = await runInstruction(
    "Muestra informacion sobre el server MCP",
    (token) => process.stdout.write(token),      // streaming en tiempo real
    (tool, args) => console.log(`\n  → ${tool}`, JSON.stringify(args)),
  );

  console.log("\n\n✓ Respuesta final:", respuesta);

} catch (err) {
  console.error("\n✗ Error:", err.message);
} finally {
  disconnect();
  await stopModel();
}
