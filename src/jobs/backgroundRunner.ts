export abstract class BackgroundRunner {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void>[] = [];

  protected constructor(
    private readonly name: string,
    private readonly pollIntervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.wake(), this.pollIntervalMs);
    this.timer.unref?.();
    this.wake();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  wake(): void {
    if (this.running) return;
    const task = this.runLoop()
      .catch((err) => {
        console.error(`[${this.name}] run loop failed:`, err);
      })
      .finally(() => {
        this.running = false;
        this.inFlight = this.inFlight.filter((p) => p !== task);
      });
    this.running = true;
    this.inFlight.push(task);
  }

  async drain(): Promise<void> {
    this.stop();
    await Promise.allSettled(this.inFlight);
  }

  protected abstract runLoop(): Promise<void>;
}
