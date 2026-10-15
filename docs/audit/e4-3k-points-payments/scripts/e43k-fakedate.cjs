// Fixture-server-only preload: shifts "now" forward so weekly attendance counts 0..7 are all reachable
// (e.g. +3 days turns a Thursday into Sunday). Never loaded by the app itself.
const shift = Number(process.env.E43K_SHIFT_DAYS || 0) * 864e5;
if (shift) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + shift);
      else super(...args);
    }
    static now() {
      return RealDate.now() + shift;
    }
  }
  FakeDate.UTC = RealDate.UTC.bind(RealDate);
  FakeDate.parse = RealDate.parse.bind(RealDate);
  globalThis.Date = FakeDate;
}
