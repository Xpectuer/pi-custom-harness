#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(packageRoot, "examples/router-agent.ts");
const defaultRouterDataDir = resolve(homedir(), ".pi", "router-harness");
const routerTools = [
  "router_dispatch",
  "router_list",
  "router_inspect",
  "router_collect",
  "router_queryContext",
  "router_cancel",
  "router_sendInput",
].join(",");

function fail(message) {
  console.error(`pi-router-harness: ${message}`);
  process.exit(1);
}

function takeOptionValue(argv, index, name) {
  const value = argv[index + 1];
  if (value === undefined || value === "--" || value.startsWith("-")) {
    fail(`${name} 需要一个值。`);
  }
  return value;
}

function parseLauncherOptions(argv) {
  let cliMode;
  let cliDataDir;
  let cliHttpsProxy;
  const passthrough = [];
  let optionsEnded = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (optionsEnded) {
      passthrough.push(argument);
      continue;
    }
    if (argument === "--") {
      optionsEnded = true;
      passthrough.push(argument);
      continue;
    }
    if (argument === "--router-mode") {
      cliMode = takeOptionValue(argv, index, "--router-mode");
      index += 1;
      continue;
    }
    if (argument.startsWith("--router-mode=")) {
      cliMode = argument.slice("--router-mode=".length);
      if (cliMode.length === 0) fail("--router-mode 需要一个值。");
      continue;
    }
    if (argument === "--router-data-dir") {
      cliDataDir = takeOptionValue(argv, index, "--router-data-dir");
      if (cliDataDir.length === 0) fail("--router-data-dir 需要一个值。");
      index += 1;
      continue;
    }
    if (argument.startsWith("--router-data-dir=")) {
      cliDataDir = argument.slice("--router-data-dir=".length);
      if (cliDataDir.length === 0) fail("--router-data-dir 需要一个值。");
      continue;
    }
    if (argument === "--router-https-proxy") {
      cliHttpsProxy = takeOptionValue(argv, index, "--router-https-proxy");
      if (cliHttpsProxy.length === 0) fail("--router-https-proxy 需要一个值。");
      index += 1;
      continue;
    }
    if (argument.startsWith("--router-https-proxy=")) {
      cliHttpsProxy = argument.slice("--router-https-proxy=".length);
      if (cliHttpsProxy.length === 0) fail("--router-https-proxy 需要一个值。");
      continue;
    }
    passthrough.push(argument);
  }

  return { cliMode, cliDataDir, cliHttpsProxy, passthrough };
}

function validateMode(value) {
  if (value === "mock" || value === "backend") return value;
  fail("router 模式必须是 mock 或 backend。");
}

function validateHttpsProxy(value) {
  const raw = value.trim();
  if (raw === "") fail("HTTPS 代理地址不能为空。");

  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("HTTPS 代理只支持不含凭证的 http://host:port 地址。");
  }
  if (
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hostname === "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    fail("HTTPS 代理只支持不含凭证的 http://host:port 地址。");
  }
  const port = url.port === "" ? 80 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("HTTPS 代理只支持不含凭证的 http://host:port 地址。");
  }
  return raw;
}

const launcherOptions = parseLauncherOptions(process.argv.slice(2));
const mode = validateMode(
  launcherOptions.cliMode ?? process.env.PI_ROUTER_MODE ?? "mock",
);

let dataDir;
if (launcherOptions.cliDataDir !== undefined) {
  if (launcherOptions.cliDataDir.trim() === "") {
    fail("--router-data-dir 不能为空。");
  }
  dataDir = resolve(launcherOptions.cliDataDir.trim());
} else if (process.env.PI_ROUTER_DATA_DIR !== undefined) {
  if (process.env.PI_ROUTER_DATA_DIR.trim() === "") {
    fail("PI_ROUTER_DATA_DIR 不能为空。");
  }
  dataDir = resolve(process.env.PI_ROUTER_DATA_DIR.trim());
} else if (mode === "backend") {
  dataDir = defaultRouterDataDir;
}

let httpsProxy;
if (launcherOptions.cliHttpsProxy !== undefined) {
  httpsProxy = validateHttpsProxy(launcherOptions.cliHttpsProxy);
} else if (process.env.PI_ROUTER_HTTPS_PROXY !== undefined) {
  httpsProxy = validateHttpsProxy(process.env.PI_ROUTER_HTTPS_PROXY);
}

if (!existsSync(extensionPath)) {
  fail(`找不到 router extension：${extensionPath}`);
}

if (mode === "mock") {
  console.error(
    "pi-router-harness: 模式=mock；仅进程内模拟，不调用发布读取器、不读取真实 Release，退出后状态不保留。",
  );
} else {
  const proxyScope = httpsProxy === undefined
    ? "HTTPS 代理=未配置（直连）"
    : "HTTPS 代理=已显式配置";
  console.error(
    `pi-router-harness: 模式=backend；真实只读 GitHub Release；数据目录=${dataDir}；${proxyScope}；关闭 Pi 后监控暂停，重开同一目录并恢复原会话后继续任务、基线与待通知。`,
  );
}

const childEnv = { ...process.env, PI_ROUTER_MODE: mode };
if (dataDir === undefined) {
  delete childEnv.PI_ROUTER_DATA_DIR;
} else {
  childEnv.PI_ROUTER_DATA_DIR = dataDir;
}
if (httpsProxy === undefined) {
  delete childEnv.PI_ROUTER_HTTPS_PROXY;
} else {
  childEnv.PI_ROUTER_HTTPS_PROXY = httpsProxy;
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
  ...launcherOptions.passthrough,
];

const piBin = process.env.PI_BIN || "pi";
const child = spawn(piBin, piArgs, {
  stdio: "inherit",
  env: childEnv,
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
