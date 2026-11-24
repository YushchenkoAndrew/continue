import { RequestOptions } from "@continuedev/config-types";
import type { Socket } from "net";
import { isIP } from "net";

/**
 * Per-phase request limits.
 *
 * A single "timeout" cannot serve both a remote API (answers in seconds) and a large local
 * model (llama.cpp holds the HTTP request open for a minute or more while it loads the
 * weights and processes the prompt). The phases are therefore limited separately:
 *
 *  - connect:    TCP connection not established
 *  - firstToken: connected, but the server has sent nothing yet (model loading, prompt eval)
 *  - idle:       the response started, then no data arrived for this long
 *  - total:      the whole request, from start to end of the response
 *
 * Only `total` (requestOptions.timeout) and explicitly configured values apply to remote
 * hosts. Local and private-network hosts also get generous defaults for firstToken/idle.
 */
export type TimeLimitPhase = "connect" | "firstToken" | "idle" | "total";

export interface RequestTimeLimits {
  connectMs?: number;
  firstTokenMs?: number;
  idleMs?: number;
  totalMs?: number;
}

export const LOCAL_FIRST_TOKEN_SECONDS = 600;
export const LOCAL_IDLE_SECONDS = 300;

// The error text must not contain "timeout"/"timed out": the OpenAI client classifies such
// errors as its own connection timeout, discards the cause and replaces the message with
// "Request timed out.".
export class RequestTimeLimitError extends Error {
  readonly code = "ERR_REQUEST_TIME_LIMIT";

  constructor(
    readonly phase: TimeLimitPhase,
    readonly seconds: number,
    readonly host: string,
  ) {
    super(RequestTimeLimitError.describe(phase, seconds, host));
    this.name = "RequestTimeLimitError";
  }

  private static describe(
    phase: TimeLimitPhase,
    seconds: number,
    host: string,
  ): string {
    switch (phase) {
      case "connect":
        return `Could not connect to ${host} within ${seconds}s. Check that the model server is running and reachable.`;
      case "firstToken":
        return `${host} sent no response within ${seconds}s. A large local model may still be loading, or the prompt is still being processed.`;
      case "idle":
        return `${host} stopped sending data for ${seconds}s in the middle of a response. The request was cancelled.`;
      case "total":
        return `The request to ${host} ran longer than the overall limit of ${seconds}s and was cancelled.`;
    }
  }
}

export function isRequestTimeLimitError(
  e: unknown,
): e is RequestTimeLimitError {
  return (
    !!e &&
    typeof e === "object" &&
    (e as { name?: unknown }).name === "RequestTimeLimitError"
  );
}

/** Loopback, private-network, link-local, CGNAT (Tailscale) and bare/`.local` host names. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) {
    return false;
  }
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".lan")
  ) {
    return true;
  }
  const family = isIP(h);
  if (family === 4) {
    const [a, b] = h.split(".").map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (family === 6) {
    return (
      h === "::1" ||
      h.startsWith("fc") ||
      h.startsWith("fd") ||
      h.startsWith("fe80")
    );
  }
  // A bare name such as `nixos` or a docker-compose service is not on the public internet.
  return !h.includes(".");
}

// undefined -> use the fallback; 0 or negative -> explicitly disabled.
function seconds(
  configured: number | undefined,
  fallbackSeconds?: number,
): number | undefined {
  const value = configured ?? fallbackSeconds;
  return value !== undefined && value > 0 ? value * 1000 : undefined;
}

export function resolveRequestTimeLimits(
  url: URL,
  requestOptions?: RequestOptions,
): RequestTimeLimits {
  const local = isLocalHost(url.hostname);
  return {
    connectMs: seconds(requestOptions?.connectTimeout),
    firstTokenMs: seconds(
      requestOptions?.firstTokenTimeout,
      local ? LOCAL_FIRST_TOKEN_SECONDS : undefined,
    ),
    idleMs: seconds(
      requestOptions?.idleTimeout,
      local ? LOCAL_IDLE_SECONDS : undefined,
    ),
    totalMs: seconds(requestOptions?.timeout),
  };
}

export interface TimeLimitGuard {
  /** Aborts when the caller aborts or a limit is exceeded (reason = RequestTimeLimitError). */
  signal: AbortSignal;
  /** Observe the sockets of a directly connected agent (connect, first-byte and idle limits). */
  watchAgent(agent: unknown): void;
  /** Sockets are not observable (proxy): treat time-to-headers as the first-token limit. */
  waitForHeaders(): void;
  /** The response headers arrived. */
  responseStarted(): void;
  /** The request is over (success, failure or cancel): stop every timer. */
  finish(): void;
}

/**
 * Enforces RequestTimeLimits for one request. Returns undefined when no limit applies, so
 * requests to remote providers without explicit settings behave exactly as before.
 */
export function createTimeLimitGuard(
  limits: RequestTimeLimits,
  host: string,
  external?: AbortSignal | null,
): TimeLimitGuard | undefined {
  const { connectMs, firstTokenMs, idleMs, totalMs } = limits;
  if (!connectMs && !firstTokenMs && !idleMs && !totalMs) {
    return undefined;
  }

  const controller = new AbortController();
  let finished = false;
  let connectTimer: NodeJS.Timeout | undefined;
  let firstTokenTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let totalTimer: NodeJS.Timeout | undefined;

  const clearTimers = () => {
    clearTimeout(connectTimer);
    clearTimeout(firstTokenTimer);
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  };

  const finish = () => {
    finished = true;
    clearTimers();
    external?.removeEventListener("abort", onExternalAbort);
  };

  const fail = (phase: TimeLimitPhase, ms: number) => {
    if (finished) {
      return;
    }
    finish();
    controller.abort(
      new RequestTimeLimitError(phase, Math.round(ms / 1000), host),
    );
  };

  const arm = (phase: TimeLimitPhase, ms: number | undefined) => {
    if (!ms || finished) {
      return undefined;
    }
    const timer = setTimeout(() => fail(phase, ms), ms);
    timer.unref?.();
    return timer;
  };

  function onExternalAbort() {
    finish();
    controller.abort(external?.reason);
  }

  if (external?.aborted) {
    finish();
    controller.abort(external.reason);
  } else {
    external?.addEventListener("abort", onExternalAbort, { once: true });
    totalTimer = arm("total", totalMs);
  }

  const watchSocket = (socket: Socket) => {
    if (finished) {
      return;
    }
    const startWaitingForServer = () => {
      clearTimeout(connectTimer);
      clearTimeout(firstTokenTimer);
      firstTokenTimer = arm("firstToken", firstTokenMs);
    };
    if (socket.connecting) {
      clearTimeout(connectTimer);
      connectTimer = arm("connect", connectMs);
      socket.once("connect", startWaitingForServer);
    } else {
      startWaitingForServer();
    }
    // A data listener on the socket does not change how the HTTP parser reads it.
    let chunks = 0;
    socket.on("data", () => {
      if (finished) {
        return;
      }
      clearTimeout(firstTokenTimer);
      clearTimeout(idleTimer);
      chunks += 1;
      // The first chunk is often just the response headers, and the first token can still
      // be a long prompt evaluation away, so it keeps the longer first-token allowance.
      idleTimer =
        chunks === 1
          ? arm("firstToken", Math.max(idleMs ?? 0, firstTokenMs ?? 0))
          : arm("idle", idleMs);
    });
    socket.once("close", () => {
      clearTimeout(connectTimer);
    });
  };

  return {
    signal: controller.signal,
    watchAgent(agent: unknown) {
      const a = agent as {
        createConnection?: (...args: any[]) => Socket | undefined;
      };
      const original = a?.createConnection;
      if (typeof original !== "function") {
        return;
      }
      a.createConnection = (...args: any[]) => {
        const socket = original.apply(agent, args);
        if (socket) {
          watchSocket(socket);
        }
        return socket;
      };
    },
    waitForHeaders() {
      clearTimeout(firstTokenTimer);
      firstTokenTimer = arm("firstToken", firstTokenMs);
    },
    responseStarted() {
      clearTimeout(connectTimer);
      clearTimeout(firstTokenTimer);
    },
    finish,
  };
}
