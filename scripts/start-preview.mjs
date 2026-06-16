import { spawn } from "node:child_process";

const port = process.env.PORT || "8080";

const child = spawn(
  process.execPath,
  ["./node_modules/vite/bin/vite.js", "preview", "--host", "0.0.0.0", "--port", port],
  {
    stdio: "inherit",
    shell: false,
  },
);

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
