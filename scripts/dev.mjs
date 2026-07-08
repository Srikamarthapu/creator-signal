import { spawn } from "node:child_process";

const commands = [
  {
    name: "api",
    command: "node",
    args: ["server/index.mjs"]
  },
  {
    name: "web",
    command: "vite",
    args: ["--host", "127.0.0.1"]
  }
];

const children = commands.map(({ name, command, args }) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" }
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      for (const other of children) {
        if (other !== child && !other.killed) other.kill("SIGTERM");
      }
      process.exitCode = code;
    }
  });

  return child;
});

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

