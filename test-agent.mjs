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
  console.log("\n🤖 Instrucción: gira el floor 45 grados en su eje X /no_think\n");
  const respuesta = await runInstruction(
    "gira el floor 45 grados en su eje X /no_think",
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
