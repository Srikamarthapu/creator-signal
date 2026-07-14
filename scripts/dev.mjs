import { execFileSync, spawn } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

function localSupabaseEnvironment() {
  if (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) return {};
  try {
    const output = execFileSync("supabase", ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (!match) return [];
      const value = match[2].replace(/^['"]|['"]$/g, "");
      return [[match[1], value]];
    }));
    const url = values.API_URL;
    const publishableKey = values.PUBLISHABLE_KEY || values.ANON_KEY;
    const secretKey = values.SECRET_KEY || values.SERVICE_ROLE_KEY;
    if (!url || !publishableKey || !secretKey) return {};
    return {
      SUPABASE_URL: url,
      VITE_SUPABASE_URL: url,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_SECRET_KEY: secretKey,
      REQUIRE_AUTH: process.env.REQUIRE_AUTH || "true"
    };
  } catch {
    return {};
  }
}

const childEnvironment = { ...process.env, ...localSupabaseEnvironment(), FORCE_COLOR: "1" };

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
    env: childEnvironment
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
