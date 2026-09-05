/** Converts fractional follow intent into integer root-scroll transport steps. */

export type IntegerScrollDebtTransport = {
  apply: (requestedDeltaPx: number) => number;
  reset: () => void;
  getDebt: () => number;
};

export function createIntegerScrollDebtTransport(
  applyIntegerDelta: (deltaPx: number) => void
): IntegerScrollDebtTransport {
  let debtPx = 0;

  return {
    apply: (requestedDeltaPx) => {
      if (!Number.isFinite(requestedDeltaPx) || requestedDeltaPx === 0) return 0;
      debtPx += requestedDeltaPx;
      const appliedDeltaPx = debtPx > 0 ? Math.floor(debtPx) : Math.ceil(debtPx);
      if (appliedDeltaPx === 0) return 0;
      debtPx -= appliedDeltaPx;
      applyIntegerDelta(appliedDeltaPx);
      return appliedDeltaPx;
    },
    reset: () => {
      debtPx = 0;
    },
    getDebt: () => debtPx,
  };
}
