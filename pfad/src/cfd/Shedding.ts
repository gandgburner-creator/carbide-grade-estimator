/**
 * VORTEX SHEDDING FROM THE LIFT: the frequency at which the lift of a body oscillates when the wake sheds vortices, read from the time
 * series of the lift coefficient over the measurement window. Nothing is assumed about the flow: if the lift is steady, or oscillates
 * without a regular rhythm, or the window holds too few cycles, no frequency is reported and the note says why.
 *
 * Time is in flow-throughs of the plate, T = plate length / free-stream speed, so a frequency in units of 1 / T is the Strouhal number
 * f L / U based on the plate length; based on the height of the body across the stream (h) it is f h / U.
 */
export interface Shedding {
  /** the amplitude of the lift oscillation (√2 × the standard deviation) and the mean lift, in lift-coefficient units */
  amplitude: number;
  meanLift: number;
  /** complete cycles found in the window */
  cycles: number;
  /** the period in flow-throughs and the frequency in 1 / flow-through (= the Strouhal number based on the plate length); null when none */
  period: number | null;
  strouhal: number | null;
  /** the Strouhal number based on the height of the body across the stream (null when there is no frequency) */
  strouhalHeight: number | null;
  /** the spread of the periods between cycles (standard deviation ÷ mean) */
  irregularity: number | null;
  note: string;
}

/**
 * @param lift     the lift coefficient at equal time steps
 * @param dt       the time between two values in flow-throughs
 * @param heightL  the height of the body across the stream, in plate lengths
 */
export function analyseShedding(lift: ArrayLike<number>, dt: number, heightL: number): Shedding {
  const n = lift.length;
  const empty = (note: string, amplitude = 0, meanLift = 0): Shedding => ({ amplitude, meanLift, cycles: 0, period: null, strouhal: null, strouhalHeight: null, irregularity: null, note });
  if (n < 20) return empty('too few samples of the lift to look for shedding');
  let mean = 0;
  for (let i = 0; i < n; i++) mean += lift[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (lift[i] - mean) ** 2;
  const amplitude = Math.SQRT2 * Math.sqrt(v / n);
  if (!(amplitude > 0.01)) return empty(`the lift is steady (oscillation amplitude ${amplitude.toExponential(1)}): no vortex shedding in the window`, amplitude, mean);
  // a three-point moving average takes out single-sample spikes; then the upward crossings of the mean, placed by linear interpolation
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = (lift[Math.max(0, i - 1)] + lift[i] + lift[Math.min(n - 1, i + 1)]) / 3 - mean;
  // upward crossings of the mean, with hysteresis: a crossing counts only after the lift has been below a quarter of the amplitude under the mean,
  // so noise that wiggles around the mean does not make extra cycles
  const cross: number[] = [];
  let armed = false;
  const h = 0.25 * amplitude;
  for (let i = 1; i < n; i++) {
    if (y[i] < -h) armed = true;
    if (armed && y[i - 1] < 0 && y[i] >= 0) {
      cross.push((i - 1 + -y[i - 1] / (y[i] - y[i - 1])) * dt);
      armed = false;
    }
  }
  if (cross.length < 3) return empty(`the lift oscillates (amplitude ${amplitude.toFixed(2)}) but the window holds fewer than 2 complete cycles: no frequency`, amplitude, mean);
  const periods: number[] = [];
  for (let i = 1; i < cross.length; i++) periods.push(cross[i] - cross[i - 1]);
  const p = periods.reduce((a, b) => a + b, 0) / periods.length;
  const irregularity = Math.sqrt(periods.reduce((a, b) => a + (b - p) ** 2, 0) / periods.length) / p;
  if (irregularity > 0.35) return { amplitude, meanLift: mean, cycles: periods.length, period: null, strouhal: null, strouhalHeight: null, irregularity, note: `the lift oscillates (amplitude ${amplitude.toFixed(2)}) without a regular rhythm: the periods of ${periods.length} cycles scatter by ${(100 * irregularity).toFixed(0)} %, so no single frequency is reported` };
  const strouhal = 1 / p;
  // a vortex street sheds at a Strouhal number of the order of 0.2 based on the height across the stream; an oscillation many times faster is
  // sound waves in the lattice, left over from the start of the flow, not shedding
  if (heightL > 0 && strouhal * heightL > 0.7) return { amplitude, meanLift: mean, cycles: periods.length, period: null, strouhal: null, strouhalHeight: null, irregularity, note: `the lift oscillates (amplitude ${amplitude.toFixed(2)}) at f L / U = ${strouhal.toFixed(2)}, far faster than a vortex street sheds (f h / U = ${(strouhal * heightL).toFixed(2)} against about 0.2): sound waves of the start-up in the lattice, not shedding` };
  return {
    amplitude,
    meanLift: mean,
    cycles: periods.length,
    period: p,
    strouhal,
    strouhalHeight: heightL > 0 ? strouhal * heightL : null,
    irregularity,
    note: `the lift oscillates with amplitude ${amplitude.toFixed(2)} at a period of ${p.toFixed(2)} flow-throughs (${periods.length} cycles, periods scatter by ${(100 * irregularity).toFixed(0)} %)`,
  };
}
