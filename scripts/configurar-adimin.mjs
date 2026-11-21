import { pbkdf2Sync, randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const localVariables = new URL("../.dev.vars", import.meta.url);

async function configureAdimin() {
  const exists = await access(localVariables).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (exists) throw new Error("O arquivo .dev.vars já existe. Guarde a configuração atual antes de gerar outra.");
  if (!stdin.isTTY) throw new Error("Execute o comando em um terminal interativo.");

  let echo = true;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (echo) stdout.write(chunk, encoding);
      done();
    },
  });
  const prompt = createInterface({ input: stdin, output, terminal: true });
  const abort = new AbortController();
  prompt.on("SIGINT", () => abort.abort());

  try {
    const email = (await prompt.question("E-mail do Adimin: ", { signal: abort.signal })).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
    echo = false;
    stdout.write("Senha do Adimin: ");
    const password = await prompt.question("", { signal: abort.signal });
    if (!password || password.length > 256) throw new Error("Use uma senha de 1 a 256 caracteres.");

    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256");
    const entries = [
      "VITRINE_MASTER_LOGIN_EMAIL=" + email,
      "VITRINE_MASTER_PASSWORD_VERIFIER=v1:" + salt.toString("hex") + ":" + hash.toString("hex"),
      "VITRINE_MASTER_SESSION_KEY=" + randomBytes(32).toString("hex"),
      "",
    ];
    await writeFile(localVariables, entries.join("\n"), { flag: "wx", mode: 0o600 });
  } finally {
    prompt.close();
    if (!echo) stdout.write("\n");
  }

  console.log("Configuração gravada em .dev.vars.");
}

configureAdimin().catch((error) => {
  console.error(error.name === "AbortError" ? "Configuração cancelada." : error.message);
  process.exitCode = 1;
});

