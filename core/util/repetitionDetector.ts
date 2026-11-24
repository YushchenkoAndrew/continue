/**
 * Detects degenerate generation: text that repeats a block verbatim, or
 * reasoning that runs on far beyond a sane budget. Pure and cheap: the
 * repetition scan runs only every CHECK_EVERY new characters.
 */

const WINDOW = 4000;
const CHECK_EVERY = 400;
const MIN_PERIOD = 24;
const MAX_PERIOD = 600;
const REPEATS = 3;

export type LoopReason = "repetition" | "thinking-cap";

/** True if the tail of `text` is the same block of >= MIN_PERIOD chars repeated REPEATS times. */
export function tailRepeats(text: string): boolean {
  const tail = text.length > WINDOW ? text.slice(-WINDOW) : text;
  const maxP = Math.min(MAX_PERIOD, Math.floor(tail.length / REPEATS));
  for (let p = MIN_PERIOD; p <= maxP; p++) {
    const unit = tail.slice(-p);
    if (unit.trim().length < MIN_PERIOD / 2) continue; // whitespace/dots only
    let ok = true;
    for (let r = 2; r <= REPEATS; r++) {
      if (tail.slice(-p * r, -p * (r - 1)) !== unit) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export class LoopGuard {
  private thinking = "";
  private content = "";
  private sinceCheck = 0;
  private thinkingChars = 0;
  tripped: LoopReason | undefined;

  constructor(private readonly maxThinkingChars: number) {}

  /** Cap on reasoning size, derived from the model's context length. */
  static thinkingCapChars(contextLength: number | undefined): number {
    const ctx = contextLength && contextLength > 0 ? contextLength : 8192;
    const tokens = Math.min(8000, Math.max(1500, ctx * 0.2));
    return Math.floor(tokens * 3.2);
  }

  feed(kind: "thinking" | "content", delta: string): LoopReason | undefined {
    if (this.tripped || !delta) return this.tripped;
    if (kind === "thinking") {
      this.thinkingChars += delta.length;
      this.thinking = (this.thinking + delta).slice(-WINDOW);
      if (this.thinkingChars > this.maxThinkingChars) {
        this.tripped = "thinking-cap";
        return this.tripped;
      }
    } else {
      this.content = (this.content + delta).slice(-WINDOW);
    }
    this.sinceCheck += delta.length;
    if (this.sinceCheck >= CHECK_EVERY) {
      this.sinceCheck = 0;
      if (tailRepeats(this.thinking) || tailRepeats(this.content)) {
        this.tripped = "repetition";
      }
    }
    return this.tripped;
  }
}

export function toolCallSignature(name: string, args: unknown): string {
  const stable = (v: any): any =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.keys(v)
          .sort()
          .reduce((o: any, k) => ((o[k] = stable(v[k])), o), {})
      : Array.isArray(v)
        ? v.map(stable)
        : v;
  return `${name}:${JSON.stringify(stable(args ?? {}))}`;
}

/** How many of the most recent signatures equal `sig` (consecutively, newest last). */
export function trailingIdentical(history: string[], sig: string): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === sig; i--) n++;
  return n;
}
