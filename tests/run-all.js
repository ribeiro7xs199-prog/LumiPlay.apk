// Executa todos os testes em sequência e mostra um resumo.
const {spawnSync} = require("child_process");
const fs = require("fs"), path = require("path");
const files = fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort();
const results = [];
for (const file of files) {
  process.stdout.write(`\n==== ${file}\n`);
  const run = spawnSync(process.execPath, [path.join(__dirname, file)], {stdio: "inherit", cwd: __dirname});
  results.push([file, run.status === 0]);
}
console.log("\n==== Resumo");
results.forEach(([file, ok]) => console.log(`${ok ? "ok   " : "FALHA"} ${file}`));
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
