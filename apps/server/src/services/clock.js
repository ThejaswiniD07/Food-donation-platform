export class Clock {
  constructor(initialMs = null) {
    this._customMs = initialMs;
  }

  now() {
    return this._customMs !== null ? this._customMs : Date.now();
  }

  set(ms) {
    this._customMs = ms;
  }

  advance(ms) {
    if (this._customMs === null) {
      this._customMs = Date.now() + ms;
    } else {
      this._customMs += ms;
    }
    return this._customMs;
  }

  reset() {
    this._customMs = null;
  }
}

export const defaultClock = new Clock();
