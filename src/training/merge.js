//
// Auuki's own ride summaries together with rides from intervals.icu,
// without counting a ride twice. An external ride is left out when it is
// one of Auuki's own uploads (auukiRideId), or when it and an Auuki ride
// overlap for at least 80 % of the shorter one's duration (the same ride
// recorded by a head unit that started earlier or stopped later).
//

const OVERLAP = 0.8;

function span(s) {
    const start = Number(s.start) || 0;
    return [start, start + Math.max(0, Number(s.duration) || 0) * 1000];
}

function sameRide(a, b) {
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    const shorter = Math.min(a1 - a0, b1 - b0);
    if(shorter <= 0) return false;
    return Math.min(a1, b1) - Math.max(a0, b0) >= OVERLAP * shorter;
}

function mergeRides(own = [], external = []) {
    const ids = new Set(own.map(s => s.id));
    const kept = external.filter(x =>
        !(x.auukiRideId && ids.has(x.auukiRideId)) && !own.some(s => sameRide(s, x)));
    return [...own, ...kept].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

// rides recorded in Auuki have no sport: they are cycling
function isCycling(summary) {
    return !summary?.sport || summary.sport === 'cycling';
}

export { mergeRides, isCycling, sameRide };
