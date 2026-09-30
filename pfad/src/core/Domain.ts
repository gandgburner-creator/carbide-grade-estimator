/**
 * Rectangular simulation domain. Each axis is either periodic or bounded; a
 * bounded axis is closed by wall models (walls/), not by the domain itself.
 */
export interface DomainSpec {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  periodicX: boolean;
  periodicY: boolean;
}

export class Domain implements DomainSpec {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
  readonly periodicX: boolean;
  readonly periodicY: boolean;
  readonly width: number;
  readonly height: number;

  constructor(spec: DomainSpec) {
    if (!(spec.xmax > spec.xmin) || !(spec.ymax > spec.ymin)) {
      throw new Error(`invalid domain extents ${JSON.stringify(spec)}`);
    }
    this.xmin = spec.xmin;
    this.xmax = spec.xmax;
    this.ymin = spec.ymin;
    this.ymax = spec.ymax;
    this.periodicX = spec.periodicX;
    this.periodicY = spec.periodicY;
    this.width = spec.xmax - spec.xmin;
    this.height = spec.ymax - spec.ymin;
  }

  get area(): number {
    return this.width * this.height;
  }

  /** Minimum-image x separation (identity on a bounded axis). */
  imageDx(dx: number): number {
    return this.periodicX ? dx - this.width * Math.round(dx / this.width) : dx;
  }

  imageDy(dy: number): number {
    return this.periodicY ? dy - this.height * Math.round(dy / this.height) : dy;
  }

  /** Map a coordinate back into [min, max) on periodic axes. */
  wrapX(x: number): number {
    if (!this.periodicX) return x;
    let u = (x - this.xmin) % this.width;
    if (u < 0) u += this.width;
    return this.xmin + u;
  }

  wrapY(y: number): number {
    if (!this.periodicY) return y;
    let u = (y - this.ymin) % this.height;
    if (u < 0) u += this.height;
    return this.ymin + u;
  }

  toSpec(): DomainSpec {
    return {
      xmin: this.xmin,
      xmax: this.xmax,
      ymin: this.ymin,
      ymax: this.ymax,
      periodicX: this.periodicX,
      periodicY: this.periodicY,
    };
  }
}
