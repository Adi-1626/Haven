// Critically damped 2D spring used for the pointer parallax. Integrated in fixed sub-steps so the
// result does not depend on the display's frame rate and never overshoots or jitters.

export class PointerSpring {
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;

  constructor(
    private readonly stiffness = 13,
    private readonly dampingRatio = 0.92,
  ) {}

  step(targetX: number, targetY: number, dt: number): void {
    const damping = 2 * Math.sqrt(this.stiffness) * this.dampingRatio;
    let remaining = Math.min(Math.max(dt, 0), 0.1);
    while (remaining > 1e-9) {
      const h = Math.min(remaining, 1 / 120);
      this.vx += ((targetX - this.x) * this.stiffness - this.vx * damping) * h;
      this.vy += ((targetY - this.y) * this.stiffness - this.vy * damping) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      remaining -= h;
    }
  }

  reset(): void {
    this.x = this.y = this.vx = this.vy = 0;
  }
}
