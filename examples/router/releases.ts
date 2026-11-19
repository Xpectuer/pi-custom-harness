/**
 * 固定匿名 GitHub Release 读取器。
 *
 * 只以 GET 读取本仓库的 releases 列表，并按 GitHub Link 中的 next 分页；
 * Link 的仓库 ID 形式只作为下一页信号，实际请求归一化回固定路径。
 * 不读取 process.env，也不自动使用宿主代理；仅在 env 显式提供 HTTPS_PROXY
 * 时经 HTTP CONNECT 隧道读取。不使用 token，不跟随重定向，也不执行网页正文。
 * 只有完整读取所有页面后才返回快照；HTTP/网络失败抛出安全 Error，
 * 可重试失败在 Error 上带 `retryAfterMs`（网络退避 60 秒至 15 分钟，
 * 服务端限流要求更长时原样尊重，不截短）。
 */

import { request as httpRequest } from "node:http";
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import type { TLSSocket } from "node:tls";

export const RELEASES_URL =
  "https://api.github.com/repos/Xpectuer/pi-custom-harness/releases";

const GITHUB_HOST = "api.github.com";
const GITHUB_PORT = 443;
const GITHUB_AUTHORITY = `${GITHUB_HOST}:${GITHUB_PORT}`;
const RELEASES_ORIGIN = `https://${GITHUB_HOST}`;
const RELEASES_PATH = "/repos/Xpectuer/pi-custom-harness/releases";
/** GitHub 的 Link 会使用仓库 ID 形式引用同一 releases 集合。 */
const CANONICAL_RELEASES_PATH = /^\/repositories\/[1-9]\d*\/releases$/;
const USER_AGENT = "pi-router-harness (anonymous GitHub release reader)";
const GITHUB_ACCEPT = "application/vnd.github+json";
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 15 * 60_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const ALLOWED_PAGE_PARAMETERS: Readonly<Partial<Record<string, number>>> = {
  page: Number.MAX_SAFE_INTEGER,
  per_page: 100,
};

export interface ReleaseRecord {
  id: number;
  tag_name: string;
  published_at: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

export interface ReleaseSnapshot {
  releases: ReleaseRecord[];
  fetchedAt: string;
  source: string;
}

interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

interface PageResult {
  releases: ReleaseRecord[];
  nextUrl: string | null;
}

interface ProxyConfig {
  host: string;
  port: number;
}

interface ReadSettings {
  timeoutMs: number;
  proxy: ProxyConfig | undefined;
}

interface ProxyState {
  request?: ClientRequest;
  raw?: Duplex;
  tls?: TLSSocket;
}

interface ReadReleasesOptions {
  signal: AbortSignal;
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  beforeRequest: (url: string) => string;
  afterRequest: (actionId: string, state: "confirmed" | "unknown", error?: string) => void;
}

export async function readReleases(options: ReadReleasesOptions): Promise<ReleaseSnapshot> {
  const settings = validateOptions(options);
  const { signal } = options;
  if (signal.aborted) throw abortError();

  const releases: ReleaseRecord[] = [];
  const seenIds = new Set<number>();
  const visitedUrls = new Set<string>();
  let currentUrl = assertFixedUrl(RELEASES_URL).toString();

  while (true) {
    if (signal.aborted) throw abortError();
    if (visitedUrls.has(currentUrl)) {
      throw readError(
        "GitHub 发布分页出现重复目标，已停止读取。",
        MIN_RETRY_AFTER_MS,
      );
    }
    visitedUrls.add(currentUrl);

    const page = await readPage(
      currentUrl,
      settings,
      signal,
      options.beforeRequest,
      options.afterRequest,
    );
    for (const release of page.releases) {
      if (seenIds.has(release.id)) continue;
      seenIds.add(release.id);
      releases.push(release);
    }

    if (page.nextUrl === null) break;
    currentUrl = page.nextUrl;
  }

  return {
    releases,
    fetchedAt: new Date().toISOString(),
    source: RELEASES_URL,
  };
}

function validateOptions(options: ReadReleasesOptions): ReadSettings {
  if (options === null || typeof options !== "object") {
    throw readError("发布读取选项无效。");
  }
  if (
    !options.signal ||
    typeof options.signal.addEventListener !== "function" ||
    typeof options.signal.removeEventListener !== "function" ||
    typeof options.signal.aborted !== "boolean"
  ) {
    throw readError("发布读取需要有效的取消信号。");
  }
  validateReleaseEnv(options.env);
  const proxy = readProxyEnv(options.env);
  if (typeof options.beforeRequest !== "function") {
    throw readError("发布读取缺少网络准入库。");
  }
  if (typeof options.afterRequest !== "function") {
    throw readError("发布读取缺少动作结果记录。");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw readError("发布读取超时必须是正数毫秒。");
  }
  return { timeoutMs, proxy };
}

/**
 * 可信接入配置校验：只允许空配置或显式 HTTPS_PROXY。
 * 在任何持久化或网络动作前调用；不读取 process.env，也不接受代理凭证。
 */
export function validateReleaseEnv(env?: Readonly<Record<string, string>>): void {
  readProxyEnv(env);
}

function readProxyEnv(env: Readonly<Record<string, string>> | undefined): ProxyConfig | undefined {
  if (env === undefined) return undefined;
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw readError("发布读取器只允许显式 HTTPS_PROXY 环境配置。");
  }

  const keys = Object.keys(env);
  if (keys.length === 0) return undefined;
  if (keys.length !== 1 || keys[0] !== "HTTPS_PROXY") {
    throw readError("发布读取器只允许显式 HTTPS_PROXY 环境配置。");
  }

  const raw: unknown = env.HTTPS_PROXY;
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw readError("HTTPS_PROXY 必须是非空代理地址。");
  }
  return parseProxyAddress(raw.trim());
}

function parseProxyAddress(raw: string): ProxyConfig {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw proxyConfigError();
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
    throw proxyConfigError();
  }

  const port = url.port === "" ? 80 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw proxyConfigError();
  }
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  if (host.length === 0) throw proxyConfigError();
  return { host, port };
}

function proxyConfigError(): Error {
  return readError("HTTPS_PROXY 只支持不含凭证的 http://host:port 代理。");
}

async function readPage(
  url: string,
  settings: ReadSettings,
  signal: AbortSignal,
  beforeRequest: (url: string) => string,
  afterRequest: (actionId: string, state: "confirmed" | "unknown", error?: string) => void,
): Promise<PageResult> {
  let target: string;
  try {
    target = new URL(url).toString();
  } catch {
    throw readError("发布读取分页目标无效。");
  }
  const actionId = beforeRequest(target);
  if (typeof actionId !== "string" || actionId.length === 0) {
    throw readError("发布读取未获得有效的动作标识，已取消网络请求。");
  }

  let responseStarted = false;
  let page: PageResult | undefined;
  let failure: unknown = undefined;
  try {
    const response = await performRequest(
      new URL(target),
      settings,
      signal,
      () => {
        responseStarted = true;
      },
    );
    if (response.status !== 200) {
      throw httpError(response);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw readError("GitHub 发布响应不是有效 JSON。", MIN_RETRY_AFTER_MS);
    }

    page = {
      releases: parseReleases(parsed),
      nextUrl: parseNextLink(response.headers.link, target),
    };
  } catch (error) {
    failure = error;
  }

  const failureMessage = failure === undefined ? undefined : safeMessage(failure);
  afterRequest(actionId, responseStarted ? "confirmed" : "unknown", failureMessage);
  if (failure !== undefined) throw failure;
  if (page === undefined) {
    throw readError("发布读取未产生完整页面结果。", MIN_RETRY_AFTER_MS);
  }
  return page;
}

function performRequest(
  url: URL,
  settings: ReadSettings,
  signal: AbortSignal,
  onResponse: () => void,
): Promise<HttpResponse> {
  const { promise, resolve, reject } = Promise.withResolvers<HttpResponse>();
  let settled = false;
  let receivedResponse = false;
  let timer: NodeJS.Timeout | undefined;
  let request: ClientRequest | undefined;
  const proxyState: ProxyState = {};

  const destroyTransports = (): void => {
    request?.destroy();
    proxyState.request?.destroy();
    proxyState.tls?.destroy();
    proxyState.raw?.destroy();
  };
  const finish = (settle: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    settle();
  };
  const stop = (error: Error): void => {
    if (settled) return;
    finish(() => reject(error));
    destroyTransports();
  };
  const onAbort = (): void => {
    stop(abortError());
  };
  const onTimeout = (): void => {
    stop(readError("读取 GitHub 发布超时。", MIN_RETRY_AFTER_MS));
  };

  const handleResponse = (response: IncomingMessage): void => {
    if (settled) return;
    receivedResponse = true;
    onResponse();

    const status = response.statusCode ?? 0;
    const headers = response.headers;
    const chunks: Buffer[] = [];
    let size = 0;

    response.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        stop(readError("GitHub 发布响应超过可读取大小。", MIN_RETRY_AFTER_MS));
        response.destroy();
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => {
      if (settled) return;
      let body: string;
      try {
        body = Buffer.concat(chunks).toString("utf8");
      } catch {
        stop(readError("读取 GitHub 发布失败（响应读取）。", MIN_RETRY_AFTER_MS));
        return;
      }
      finish(() => resolve({ status, headers, body }));
    });
    response.on("error", () => {
      stop(readError("读取 GitHub 发布失败（网络错误）。", MIN_RETRY_AFTER_MS));
    });
    response.on("aborted", () => {
      stop(readError("读取 GitHub 发布失败（响应中断）。", MIN_RETRY_AFTER_MS));
    });
    response.on("close", () => {
      if (!response.complete) {
        stop(readError("读取 GitHub 发布失败（响应中断）。", MIN_RETRY_AFTER_MS));
      }
    });
  };

  const startRequest = (tunnel?: TLSSocket): void => {
    const headers = {
      "user-agent": USER_AGENT,
      accept: GITHUB_ACCEPT,
      "x-github-api-version": GITHUB_API_VERSION,
      connection: "close",
    };
    try {
      request = tunnel
        ? httpsRequest(
          url,
          { method: "GET", defaultPort: GITHUB_PORT, headers, createConnection: () => tunnel },
          handleResponse,
        )
        : httpsRequest(
          url,
          { method: "GET", agent: false, rejectUnauthorized: true, headers },
          handleResponse,
        );
      request.on("error", () => {
        stop(readError("读取 GitHub 发布失败（网络错误）。", MIN_RETRY_AFTER_MS));
      });
      request.on("close", () => {
        if (!receivedResponse) {
          stop(readError("读取 GitHub 发布失败（连接关闭）。", MIN_RETRY_AFTER_MS));
        }
      });
      request.end();
    } catch {
      stop(readError("无法发起 GitHub 发布读取请求。", MIN_RETRY_AFTER_MS));
    }
  };

  const connectProxyAndStart = async (proxy: ProxyConfig): Promise<void> => {
    try {
      const tunnel = await openProxyTunnel(proxy, proxyState, () => settled);
      if (settled) {
        tunnel.destroy();
        return;
      }
      startRequest(tunnel);
    } catch (error) {
      if (settled) return;
      stop(
        error instanceof Error && error.name === "ReleaseReadError"
          ? error
          : readError("读取 GitHub 发布失败（代理连接）。", MIN_RETRY_AFTER_MS),
      );
    }
  };

  timer = setTimeout(onTimeout, settings.timeoutMs);
  if (signal.aborted) {
    onAbort();
    return promise;
  }
  signal.addEventListener("abort", onAbort, { once: true });

  if (settings.proxy) {
    void connectProxyAndStart(settings.proxy);
  } else {
    startRequest();
  }
  return promise;
}

function openProxyTunnel(
  proxy: ProxyConfig,
  state: ProxyState,
  isCancelled: () => boolean,
): Promise<TLSSocket> {
  const { promise, resolve, reject } = Promise.withResolvers<TLSSocket>();
  let settled = false;
  let connected = false;
  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    reject(error);
  };

  let connectRequest: ClientRequest;
  try {
    connectRequest = httpRequest({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: GITHUB_AUTHORITY,
      setHost: false,
      headers: {
        host: GITHUB_AUTHORITY,
        connection: "keep-alive",
        "proxy-connection": "keep-alive",
        "user-agent": USER_AGENT,
      },
      agent: false,
    });
  } catch {
    fail(readError("HTTPS 代理连接失败。", MIN_RETRY_AFTER_MS));
    return promise;
  }
  state.request = connectRequest;

  connectRequest.once("connect", (response, socket, head) => {
    connected = true;
    if (settled || isCancelled()) {
      socket.destroy();
      fail(readError("HTTPS 代理连接已取消。", MIN_RETRY_AFTER_MS));
      return;
    }
    if (response.statusCode !== 200) {
      socket.destroy();
      fail(readError(
        `HTTPS 代理 CONNECT 失败（HTTP ${response.statusCode ?? 0}）。`,
        MIN_RETRY_AFTER_MS,
      ));
      return;
    }

    state.request = undefined;
    state.raw = socket;
    socket.on("error", () => {
      fail(readError("HTTPS 代理连接失败。", MIN_RETRY_AFTER_MS));
    });
    socket.on("close", () => {
      if (!settled) fail(readError("HTTPS 代理连接关闭。", MIN_RETRY_AFTER_MS));
    });

    let tlsSocket: TLSSocket;
    try {
      if (head.length > 0) socket.unshift(head);
      tlsSocket = tlsConnect({
        socket,
        servername: GITHUB_HOST,
        host: GITHUB_HOST,
        port: GITHUB_PORT,
        rejectUnauthorized: true,
        ALPNProtocols: ["http/1.1"],
      });
    } catch {
      socket.destroy();
      fail(readError("GitHub 发布代理隧道建立失败。", MIN_RETRY_AFTER_MS));
      return;
    }
    state.tls = tlsSocket;

    tlsSocket.once("secureConnect", () => {
      if (settled) return;
      if (!tlsSocket.authorized) {
        fail(readError("GitHub 发布代理 TLS 校验失败。", MIN_RETRY_AFTER_MS));
        return;
      }
      settled = true;
      resolve(tlsSocket);
    });
    tlsSocket.on("error", () => {
      fail(readError("GitHub 发布代理 TLS 校验失败。", MIN_RETRY_AFTER_MS));
    });
    tlsSocket.on("close", () => {
      if (!settled) fail(readError("GitHub 发布代理连接关闭。", MIN_RETRY_AFTER_MS));
    });
  });

  connectRequest.on("error", () => {
    fail(readError("HTTPS 代理连接失败。", MIN_RETRY_AFTER_MS));
  });
  connectRequest.on("close", () => {
    if (!connected) fail(readError("HTTPS 代理连接关闭。", MIN_RETRY_AFTER_MS));
  });

  try {
    connectRequest.end();
  } catch {
    fail(readError("HTTPS 代理连接失败。", MIN_RETRY_AFTER_MS));
    connectRequest.destroy();
  }
  return promise;
}

function parseReleases(value: unknown): ReleaseRecord[] {
  if (!Array.isArray(value)) {
    throw readError("GitHub 发布响应不是数组。", MIN_RETRY_AFTER_MS);
  }
  return value.map((item, index) => parseRelease(item, index));
}

function parseRelease(value: unknown, index: number): ReleaseRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRelease(index);
  }
  const record = value as Record<string, unknown>;
  const id = record.id;
  const tagName = record.tag_name;
  const publishedAt = record.published_at;
  const htmlUrl = record.html_url;
  const draft = record.draft;
  const prerelease = record.prerelease;

  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw invalidRelease(index);
  }
  if (typeof tagName !== "string" || tagName.length === 0) {
    throw invalidRelease(index);
  }
  if (
    publishedAt !== null &&
    (typeof publishedAt !== "string" ||
      publishedAt.length === 0 ||
      Number.isNaN(Date.parse(publishedAt)))
  ) {
    throw invalidRelease(index);
  }
  if (typeof htmlUrl !== "string" || htmlUrl.length === 0) {
    throw invalidRelease(index);
  }
  if (typeof draft !== "boolean" || typeof prerelease !== "boolean") {
    throw invalidRelease(index);
  }

  return {
    id,
    tag_name: tagName,
    published_at: publishedAt,
    html_url: htmlUrl,
    draft,
    prerelease,
  };
}

function invalidRelease(index: number): Error {
  return readError(
    `GitHub 发布响应第 ${index + 1} 项字段无效。`,
    MIN_RETRY_AFTER_MS,
  );
}

function parseNextLink(header: string | string[] | undefined, currentUrl: string): string | null {
  const raw = Array.isArray(header) ? header.join(", ") : header;
  if (raw === undefined || raw.trim() === "") return null;

  const entries = splitLinkEntries(raw);
  if (entries.length === 0) throw invalidPaginationLink();

  let next: string | null = null;
  for (const entry of entries) {
    const match = /^\s*<([^<>]+)>\s*(.*)$/.exec(entry);
    if (!match) throw invalidPaginationLink();

    const parameters = match[2];
    const relMatch =
      /(?:^|;)\s*rel\s*=\s*"([^"]*)"/i.exec(parameters) ??
      /(?:^|;)\s*rel\s*=\s*([^;\s,]+)/i.exec(parameters);
    if (!relMatch) continue;

    const relations = relMatch[1].toLowerCase().split(/\s+/).filter(Boolean);
    if (!relations.includes("next")) continue;
    if (next !== null) throw invalidPaginationLink();

    next = assertPaginationUrl(match[1].trim(), currentUrl);
  }
  return next;
}

function splitLinkEntries(header: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let inAngle = false;
  let inQuotes = false;

  for (let index = 0; index < header.length; index += 1) {
    const character = header[index];
    if (character === "<" && !inQuotes) {
      inAngle = true;
    } else if (character === ">" && !inQuotes) {
      inAngle = false;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inAngle && !inQuotes) {
      entries.push(header.slice(start, index));
      start = index + 1;
    }
  }
  if (inAngle || inQuotes) throw invalidPaginationLink();
  entries.push(header.slice(start));
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

function assertPaginationUrl(raw: string, currentUrl: string): string {
  let url: URL;
  try {
    url = new URL(raw, currentUrl);
  } catch {
    throw invalidPaginationLink();
  }

  if (
    url.origin !== RELEASES_ORIGIN ||
    (url.pathname !== RELEASES_PATH && !CANONICAL_RELEASES_PATH.test(url.pathname)) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw invalidPaginationLink();
  }

  for (const [key, value] of url.searchParams) {
    const maximum = Object.hasOwn(ALLOWED_PAGE_PARAMETERS, key)
      ? ALLOWED_PAGE_PARAMETERS[key]
      : undefined;
    if (
      maximum === undefined ||
      !/^[1-9]\d*$/.test(value) ||
      url.searchParams.getAll(key).length !== 1
    ) {
      throw invalidPaginationLink();
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > maximum) {
      throw invalidPaginationLink();
    }
  }

  // GitHub 的 Link 只用来说明下一页；实际请求始终回到固定允许目标。
  const target = new URL(RELEASES_URL);
  target.search = url.search;
  if (target.toString() === currentUrl) throw invalidPaginationLink();
  return target.toString();
}

function assertFixedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw readError("发布读取目标配置无效。");
  }
  if (
    url.origin !== RELEASES_ORIGIN ||
    url.pathname !== RELEASES_PATH ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.search !== ""
  ) {
    throw readError("发布读取目标配置无效。");
  }
  return url;
}

function httpError(response: HttpResponse): Error {
  const status = response.status;
  if ([301, 302, 303, 307, 308].includes(status)) {
    return readError(`GitHub 返回重定向（HTTP ${status}），已拒绝跟随。`, MIN_RETRY_AFTER_MS);
  }

  const retryAfterMs = retryAfterFor(response.headers, status);
  if (status === 429 || status === 403) {
    return readError(`GitHub 限流或拒绝访问（HTTP ${status}）。`, retryAfterMs);
  }
  if (status >= 500) {
    return readError(`GitHub 服务错误（HTTP ${status}）。`, retryAfterMs);
  }
  return readError(`GitHub 发布读取失败（HTTP ${status}）。`, retryAfterMs);
}

function retryAfterFor(headers: IncomingHttpHeaders, status: number): number {
  const retryAfterHeader = headers["retry-after"];
  const remainingHeader = headers["x-ratelimit-remaining"];
  const resetHeader = headers["x-ratelimit-reset"];
  const retryAfter = parseRetryAfter(
    Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader,
  );
  const remaining = Array.isArray(remainingHeader) ? remainingHeader[0] : remainingHeader;
  const reset = parseRateLimitReset(
    Array.isArray(resetHeader) ? resetHeader[0] : resetHeader,
  );
  const rateLimited = status === 429 ||
    retryAfter !== undefined ||
    (status === 403 && (remaining === undefined || remaining === "" || remaining === "0"));

  // 服务端给出的等待时间必须完整遵守；网络失败由后端按 60s 至 15m 退避。
  if (retryAfter !== undefined) return serverRetryAfter(retryAfter);
  if (rateLimited && reset !== undefined) return serverRetryAfter(reset);
  if (rateLimited) return MAX_RETRY_AFTER_MS;
  return MIN_RETRY_AFTER_MS;
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) {
    const timestamp = Date.parse(raw);
    if (Number.isNaN(timestamp)) return undefined;
    return timestamp - Date.now();
  }
  const milliseconds = Number(raw) * 1000;
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

function parseRateLimitReset(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) return undefined;
  const timestamp = Number(raw) * 1000;
  if (!Number.isFinite(timestamp)) return undefined;
  return timestamp - Date.now();
}

function serverRetryAfter(value: number): number {
  return Math.max(MIN_RETRY_AFTER_MS, Math.floor(value));
}

function invalidPaginationLink(): Error {
  return readError(
    "GitHub 发布分页链接无效或目标越界，已停止读取。",
    MIN_RETRY_AFTER_MS,
  );
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "GitHub 发布读取失败。";
}

function readError(message: string, retryAfterMs?: number): Error {
  const error = new Error(message);
  error.name = "ReleaseReadError";
  if (retryAfterMs !== undefined) {
    Object.defineProperty(error, "retryAfterMs", {
      value: retryAfterMs,
      enumerable: true,
      configurable: true,
    });
  }
  return error;
}

function abortError(): Error {
  const error = new Error("发布读取已取消。");
  error.name = "AbortError";
  return error;
}
