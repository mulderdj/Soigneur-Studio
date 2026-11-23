// What jsdom lacks and the charts (uPlot) use. Import this before the code
// under test: imports run before the rest of a test file.
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
globalThis.matchMedia ??= () => ({matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}});
