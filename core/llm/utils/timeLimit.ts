import { isRequestTimeLimitError } from "@continuedev/fetch";

const HINTS = {
  connect:
    "Raise requestOptions.connectTimeout if the server is slow to accept connections.",
  firstToken:
    "If this model needs longer to load, raise requestOptions.firstTokenTimeout in config.yaml.",
  idle: "If the model pauses this long between tokens, raise requestOptions.idleTimeout.",
  total: "Raise requestOptions.timeout to allow longer requests.",
} as const;

/**
 * Turns a request-limit failure into a message that names the setting to change. The OpenAI
 * client wraps fetch failures, so the original error may be the `cause`. Other errors are
 * returned untouched.
 */
export function describeTimeLimitError(e: any): any {
  const limit = isRequestTimeLimitError(e)
    ? e
    : isRequestTimeLimitError(e?.cause)
      ? e.cause
      : undefined;
  if (!limit) {
    return e;
  }
  const described: any = new Error(`${limit.message} ${HINTS[limit.phase]}`);
  described.name = limit.name;
  described.cause = limit;
  return described;
}
