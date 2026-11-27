//
// Layouts the rider shapes: which tiles show, in what order, how big.
//
//   layouts = {
//     version: 1,
//     ride:     {phone: {screens: [{id, name, tiles: [{id, size}]}]}, large: …},
//     training: {phone: {cards: [{id, size, hidden}]}, large: …},
//   }
//
// Tiles keep an order and a size; the grid places them (no free placement).
// `phone` is used on phones (portrait and the handlebar landscape), `large`
// on tablets, desktops and TVs.
//

const VERSION = 1;
const MAX_SCREENS = 8;
const GRID_COLS = 12;
const MAX_ROW_SPAN = 6;
const NUMBER = ['small', 'wide', 'large'];
const GRAPH = ['wide', 'large'];

const RIDE_TILES = [
    {id: 'power',                 name: 'Power',            description: 'Power in its zone colour, 3 s power on tap', sizes: NUMBER, size: 'large'},
    {id: 'target',                name: 'Target',           description: 'Target power, resistance or slope', sizes: NUMBER, size: 'small'},
    {id: 'interval-time',         name: 'Interval Time',    description: 'Time left in this interval', sizes: NUMBER, size: 'small'},
    {id: 'elapsed-time',          name: 'Elapsed Time',     description: 'Time since the start', sizes: NUMBER, size: 'small'},
    {id: 'heart-rate',            name: 'Heart Rate',       description: 'Heart rate; average and max on tap', sizes: NUMBER, size: 'small'},
    {id: 'cadence',               name: 'Cadence',          description: 'Cadence; lap, average and target on tap', sizes: NUMBER, size: 'small'},
    {id: 'speed',                 name: 'Speed',            description: 'Speed', sizes: NUMBER, size: 'small'},
    {id: 'distance',              name: 'Distance',         description: 'Distance', sizes: NUMBER, size: 'small'},
    {id: 'slope',                 name: 'Slope',            description: 'Slope in slope mode', sizes: NUMBER, size: 'small'},
    {id: 'power-avg',             name: 'Power Lap / Avg',  description: 'Lap and average power, kcal, gear on tap', sizes: NUMBER, size: 'small'},
    {id: 'fuelling',              name: 'Carbs',            description: 'Carbs burned and recommended intake, g/h on tap', sizes: NUMBER, size: 'small'},
    {id: 'smo2',                  name: 'SmO2',             description: 'Muscle oxygen (Moxy)', sizes: NUMBER, size: 'small'},
    {id: 'thb',                   name: 'THb',              description: 'Total haemoglobin (Moxy)', sizes: NUMBER, size: 'small'},
    {id: 'core-body-temperature', name: 'Core',             description: 'Core body temperature (CORE sensor)', sizes: NUMBER, size: 'small'},
    {id: 'skin-temperature',      name: 'Skin',             description: 'Skin temperature (CORE sensor)', sizes: NUMBER, size: 'small'},
    {id: 'chart',                 name: 'Live chart',       description: 'Power, target, heart rate and cadence over the ride', sizes: GRAPH, size: 'large', graph: true},
    {id: 'workout',               name: 'Workout',          description: 'The workout\'s intervals and where you are', sizes: GRAPH, size: 'large', graph: true},
    {id: 'stats',                 name: 'Statistics',       description: 'Training load, peaks and zones of this ride', sizes: GRAPH, size: 'large', graph: true},
    {id: 'map',                   name: 'Map',              description: 'Live GPS route and position', sizes: GRAPH, size: 'large', graph: true},
];

const CARD = ['narrow', 'wide', 'full'];
const TRAINING_CARDS = [
    {id: 'readiness', name: 'Readiness',   sizes: CARD, size: 'wide'},
    {id: 'form',     name: 'Form',          sizes: CARD, size: 'narrow'},
    {id: 'week',     name: 'This week',     sizes: CARD, size: 'wide'},
    {id: 'health',   name: 'Health',        sizes: CARD, size: 'full'},
    {id: 'calendar', name: 'Calendar',      sizes: CARD, size: 'full'},
    {id: 'volume',   name: 'Weekly volume', sizes: CARD, size: 'narrow'},
    {id: 'curve',    name: 'Power curve',   sizes: CARD, size: 'wide'},
    {id: 'model',    name: 'CP and W′',     sizes: CARD, size: 'narrow'},
    {id: 'profile',  name: 'Power profile', sizes: CARD, size: 'narrow'},
    {id: 'zones',    name: 'Time in zones', sizes: CARD, size: 'wide'},
    {id: 'ftp',      name: 'FTP trend',     sizes: CARD, size: 'wide'},
    {id: 'efficiency',     name: 'Aerobic efficiency',  sizes: CARD, size: 'full'},
    {id: 'readiness-perf', name: 'Readiness and rides', sizes: CARD, size: 'narrow'},
    {id: 'decoupling',     name: 'Aerobic decoupling',  sizes: CARD, size: 'wide'},
    {id: 'compliance',     name: 'Plan compliance',     sizes: CARD, size: 'narrow'},
    {id: 'durability',     name: 'Durability',          sizes: CARD, size: 'full'},
];

// cards an update adds that a saved layout should show (not hide): at their default place
const ADDED_VISIBLE = new Set(['readiness', 'model', 'profile', 'efficiency', 'readiness-perf', 'decoupling', 'compliance', 'durability']);

const RIDE_BY_ID = new Map(RIDE_TILES.map(t => [t.id, t]));
const CARD_BY_ID = new Map(TRAINING_CARDS.map(c => [c.id, c]));

const t = (id, size = RIDE_BY_ID.get(id).size) => ({id, size});

function defaultLayouts() {
    const rideScreen = () => ['interval-time', 'elapsed-time', 'heart-rate', 'cadence', 'speed', 'distance']
        .map(id => t(id));
    return {
        version: VERSION,
        ride: {
            phone: {screens: [
                {id: 'ride', name: 'Ride', tiles: [t('power', 'wide'), t('target'), ...rideScreen(),
                                                   t('chart'), t('workout'), t('stats')]},
                {id: 'big', name: 'Big numbers', tiles: ['power', 'heart-rate', 'cadence', 'interval-time'].map(id => t(id, 'large'))},
                {id: 'chart', name: 'Chart', tiles: [t('power', 'wide'), t('target'), t('chart', 'large')]},
            ]},
            large: {screens: [
                // 4 columns: Power and six tiles fill two rows
                {id: 'ride', name: 'Ride', tiles: [t('power', 'wide'), t('target'), ...rideScreen().slice(0, 5),
                                                   t('chart'), t('workout'), t('stats')]},
                {id: 'big', name: 'Big numbers', tiles: ['power', 'heart-rate', 'cadence', 'interval-time'].map(id => t(id, 'wide'))},
                {id: 'chart', name: 'Chart', tiles: [t('power', 'wide'), t('target'), t('heart-rate'), t('cadence'), t('chart', 'large')]},
            ]},
        },
        training: {
            phone: {cards: TRAINING_CARDS.map(c => ({id: c.id, size: 'full', hidden: false}))},
            large: {cards: TRAINING_CARDS.map(c => ({id: c.id, size: c.size, hidden: false}))},
        },
    };
}

const isObj = x => typeof x === 'object' && x !== null && !Array.isArray(x);

function clampInt(v, min, max) {
    return Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function readTiles(tiles) {
    const seen = new Set();
    const out = [];
    for(const tile of Array.isArray(tiles) ? tiles : []) {
        const def = RIDE_BY_ID.get(tile?.id);
        if(!def || seen.has(def.id)) continue;
        seen.add(def.id);
        const entry = {id: def.id, size: def.sizes.includes(tile.size) ? tile.size : def.size};
        const w = clampInt(tile.w, 1, GRID_COLS);
        const h = clampInt(tile.h, 1, MAX_ROW_SPAN);
        if(w !== null) entry.w = w;
        if(h !== null) entry.h = h;
        out.push(entry);
    }
    return out;
}

function readScreens(saved, fallback) {
    if(!isObj(saved) || !Array.isArray(saved.screens) || saved.screens.length === 0) return fallback;
    const ids = new Set();
    const screens = saved.screens.slice(0, MAX_SCREENS).map((s, i) => {
        let id = typeof s?.id === 'string' && s.id.trim() ? s.id.trim().slice(0, 40) : `screen-${i + 1}`;
        while(ids.has(id)) id = `${id}-${i + 1}`;
        ids.add(id);
        const name = typeof s?.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 24) : `Screen ${i + 1}`;
        return {id, name, tiles: readTiles(s?.tiles)};
    });
    // tiles were saved but none is known any more (renamed in an update):
    // the built-in screens, not a Ride page without tiles
    const hadTiles = saved.screens.some(s => Array.isArray(s?.tiles) && s.tiles.length > 0);
    if(hadTiles && screens.every(s => s.tiles.length === 0)) return fallback;
    return screens;
}

function readCards(saved, fallback) {
    if(!isObj(saved) || !Array.isArray(saved.cards)) return fallback;
    const seen = new Set();
    const out = [];
    for(const c of saved.cards) {
        const def = CARD_BY_ID.get(c?.id);
        if(!def || seen.has(def.id)) continue;
        seen.add(def.id);
        const entry = {id: def.id, size: def.sizes.includes(c.size) ? c.size : def.size, hidden: c.hidden === true};
        const w = clampInt(c.w, 1, GRID_COLS);
        const h = clampInt(c.h, 1, MAX_ROW_SPAN);
        if(w !== null) entry.w = w;
        if(h !== null) entry.h = h;
        out.push(entry);
    }
    TRAINING_CARDS.forEach((def, i) => {
        if(seen.has(def.id)) return;
        if(ADDED_VISIBLE.has(def.id)) out.splice(Math.min(i, out.length), 0, {id: def.id, size: def.size, hidden: false});
        else out.push({id: def.id, size: def.size, hidden: true});
    });
    return out;
}

// A saved layout made safe to use: whatever it is, the result has at least
// one Ride screen per class and every Training card exactly once.
function readLayout(saved) {
    const d = defaultLayouts();
    if(!isObj(saved) || saved.version !== VERSION) return d;
    const ride = isObj(saved.ride) ? saved.ride : {};
    const training = isObj(saved.training) ? saved.training : {};
    return {
        version: VERSION,
        ride: {
            phone: {screens: readScreens(ride.phone, d.ride.phone.screens)},
            large: {screens: readScreens(ride.large, d.ride.large.screens)},
        },
        training: {
            phone: {cards: readCards(training.phone, d.training.phone.cards)},
            large: {cards: readCards(training.large, d.training.large.cards)},
        },
    };
}

function screenClass(layoutName) {
    return layoutName === 'phone' || layoutName === 'phone-landscape' ? 'phone' : 'large';
}

function columnsFor(layoutName) {
    if(layoutName === 'phone') return 3;
    if(layoutName === 'phone-landscape') return 5;
    if(layoutName === 'tablet') return 4;
    if(layoutName === 'tv') return 6;
    return 4;
}

function spanFor(size, columns) {
    if(size === 'large') return columns;
    if(size === 'wide') return Math.min(2, columns);
    return 1;
}

function widthFor(item, layoutName = 'desktop', kind = 'ride') {
    if(Number.isInteger(item?.w) && item.w >= 1 && item.w <= GRID_COLS) return item.w;
    const size = item?.size;
    if(kind === 'training') {
        if(screenClass(layoutName) === 'phone') return size === 'narrow' ? 6 : 12;
        if(size === 'full') return 12;
        if(size === 'wide') return 8;
        return 4;
    }
    if(size === 'large') return 12;
    if(layoutName === 'phone') return size === 'wide' ? 8 : 4;
    if(layoutName === 'tv') return size === 'wide' ? 4 : 2;
    return size === 'wide' ? 6 : 3;
}

function heightFor(item, kind = 'ride') {
    if(Number.isInteger(item?.h) && item.h >= 1 && item.h <= MAX_ROW_SPAN) return item.h;
    if(kind === 'training') return 1;
    const id = item?.id;
    if(id === 'chart' || id === 'map' || id === 'stats') return 3;
    if(id === 'workout') return 2;
    if(id === 'power' && item?.size === 'large') return 2;
    return 1;
}

function sizeForWidth(w, kind = 'ride') {
    if(kind === 'training') return w >= 10 ? 'full' : w >= 6 ? 'wide' : 'narrow';
    return w >= 10 ? 'large' : w >= 6 ? 'wide' : 'small';
}

export {
    RIDE_TILES, TRAINING_CARDS, RIDE_BY_ID, CARD_BY_ID, MAX_SCREENS, GRID_COLS, MAX_ROW_SPAN,
    defaultLayouts, readLayout, screenClass, columnsFor, spanFor, widthFor, heightFor, sizeForWidth,
};
