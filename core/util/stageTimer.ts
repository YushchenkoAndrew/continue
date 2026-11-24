/**
 * Minimal stage timer for slow-path diagnostics. Records how long each named stage takes and
 * prints a single line, but only when the whole operation was slower than `thresholdMs`, so
 * normal operation stays silent.
 */
export class StageTimer {
  private last = Date.now();
  private readonly start = this.last;
  private readonly stages: string[] = [];

  constructor(
    private readonly label: string,
    private readonly thresholdMs = 400,
  ) {}

  /** Close the current stage under `name`. */
  mark(name: string) {
    const now = Date.now();
    this.stages.push(`${name}=${now - this.last}ms`);
    this.last = now;
  }

  end(extra?: string) {
    const total = Date.now() - this.start;
    if (total >= this.thresholdMs) {
      console.info(
        `[perf] ${this.label} ${total}ms (${this.stages.join(", ")})${extra ? ` ${extra}` : ""}`,
      );
    }
  }
}
