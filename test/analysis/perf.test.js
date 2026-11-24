import { analyseRide } from '../../src/analysis/ride.js';
test('a 6 h ride with an hour-long lap analyses quickly', () => {
    const samples = Array.from({length: 21600}, (_, t) => ({t, power: 180 + (t % 60), heartRate: 140, cadence: 85, speed: 8, distance: t * 8, altitude: 300}));
    const laps = Array.from({length: 6}, (_, i) => ({start: i * 3600, end: (i + 1) * 3600}));
    const t0 = Date.now();
    const a = analyseRide({samples, pauses: [], laps, ftp: 250, wprime: 20000, lthr: 170});
    expect(a.intervals).toHaveLength(6);
    expect(Date.now() - t0).toBeLessThan(1500);
});
