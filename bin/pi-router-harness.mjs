#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(packageRoot, "examples/router-agent.ts");
const routerTools = [
  "router_dispatch",
  "router_list",
  "router_inspect",
  "router_collect",
  "router_queryContext",
].join(",");

if (!existsSync(extensionPath)) {
  console.error(`pi-router-harness: 找不到 router extension：${extensionPath}`);
  process.exit(1);
}

const piArgs = [
  "--no-extensions",
  "-e",
  extensionPath,
  "--no-builtin-tools",
  "--no-mcp",
  "--no-skills",
  "--no-prompt-templates",
  "--tools",
  routerTools,
  ...process.argv.slice(2),
];

const piBin = process.env.PI_BIN || "pi";
const child = spawn(piBin, piArgs, {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(`pi-router-harness: 找不到 Pi CLI（${piBin}）。`);
    console.error("请先安装 Pi，或设置 PI_BIN 指向 pi 可执行文件。");
  } else {
    console.error(`pi-router-harness: 启动 Pi 失败：${error.message}`);
  }
  process.exit(127);
});

child.on("exit", (code, signal) => {
  if (signal) {
    const signalCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
    process.exit(signalCodes[signal] ?? 1);
  }
  process.exit(code ?? 1);
});
