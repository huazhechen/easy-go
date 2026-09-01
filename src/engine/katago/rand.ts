/** Small deterministic-policy random helpers used by the MCTS search root. */
export class Rand {
  private spare: number | null = null;

  nextBool(p: number): boolean {
    return Math.random() < p;
  }

  nextDouble(): number {
    return Math.random();
  }

  nextGaussian(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }

    let u = 0;
    let v = 0;
    let s = 0;
    while (s === 0 || s >= 1) {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      s = u * u + v * v;
    }
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * mul;
    return u * mul;
  }
}
