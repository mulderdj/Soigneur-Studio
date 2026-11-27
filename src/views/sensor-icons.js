// @ts-check
//
// The sensors: their names and icons (24 × 24, drawn in the header buttons'
// line style; .fill / .hole / .gap parts are styled in ride.css: a .gap is a
// thin line in the button's colour that separates two filled parts). Trainer: a
// direct-drive trainer; Moxy: oxygen bubbles; bike controls: a road shifter.
//

const SENSORS = {
    'ble:controllable':       {name: 'Trainer'},
    'ble:heartRateMonitor':   {name: 'Heart rate'},
    'ant:hrm':                {name: 'Heart rate (ANT+)'},
    'ble:powerMeter':         {name: 'Power meter'},
    'ble:speedCadenceSensor': {name: 'Speed / cadence'},
    'ble:smo2':               {name: 'Moxy (SmO₂)'},
    'ble:coreTemp':           {name: 'Core temperature'},
    'ble:openBikeControl':    {name: 'Bike controls'},
    'gps':                    {name: 'GPS'},
};

const HEART = '<path d="M12 20s-7-4.4-9.2-8.6A5 5 0 0 1 12 6.3a5 5 0 0 1 9.2 5.1C19 15.6 12 20 12 20z"/><path d="M3.5 12.5h4l1.5-2.5 2.5 5 1.5-2.5h7.5"/>';

const PATHS = {
    'ble:controllable': '<path class="fill" d="M4.4 17.2 8.3 4.6c.5-1.4 2-1.8 3-1 .7.5.9 1.3.7 2.1L9 17.2z"/><circle class="hole" cx="5.8" cy="16.6" r="4.6"/><circle class="fill" cx="5.8" cy="16.6" r="3.6"/><circle class="hole" cx="10.2" cy="5.2" r=".75"/><path class="leg" d="M9.6 11.4 20 19.4M18.4 20.4h3.6"/>',
    'ble:heartRateMonitor': HEART,
    'ant:hrm': HEART,
    'ble:powerMeter': '<circle cx="12" cy="12" r="8.4"/><path class="fill" d="M13.4 5.6 7.8 13.2h3.8l-1.2 5.2 5.8-7.8h-3.9z"/>',
    'ble:speedCadenceSensor': '<path d="M4 17a8.5 8.5 0 1 1 16 0"/><path d="M12 15.2 16.2 9.6"/><circle class="fill" cx="12" cy="15.4" r="1.6"/><path d="M5.6 13.2h1.2M7.8 7.8l.8.8M12 5.6v1.2M17.4 13.2h1.2"/>',
    'ble:smo2': '<circle cx="9" cy="15" r="5"/><circle cx="16.8" cy="8.6" r="3.2"/><circle cx="10.6" cy="5" r="1.6"/><circle cx="18.6" cy="16.6" r="1.4"/><path d="M6.4 13.2a3 3 0 0 1 2.2-1.6"/>',
    'ble:coreTemp': '<path d="M14 14.3V5a2 2 0 1 0-4 0v9.3a4 4 0 1 0 4 0z"/><circle class="fill" cx="12" cy="17.6" r="2.1"/><path d="M12 15.6V9"/><path d="M17 6h2M17 9h2M17 12h2"/>',
    'ble:openBikeControl': '<rect class="fill" x="3.6" y="4.3" width="2.4" height="2.4" rx=".4" transform="rotate(-16 4.8 5.5)"/><path class="fill" d="M6.6 2.2C8.6 2.2 10.8 3.6 13 4.2c1.3-.8 2.6-1.9 4.1-1.9 1.6.1 2.9 1.5 3.5 2.9l-.3 3.3c-1.7.2-3.4.4-5 .7L9.2 9C7.7 8.9 6.7 7.6 6.3 5.9 6.1 4.6 6 3.2 6.6 2.2z"/><path class="fill" d="M13.6 10.8c-2 .6-4.2 2-5 4.3-.4 1.1-.3 2.1-.1 2.9 2.1-1.3 3.9-3.8 5.1-7.2z"/><path class="gap gap--lever" d="M16.9 6.3c.9-.3 2.3-.5 3.7-.7l-.3 2.9c-1.3.2-2.7.7-3.4 1.7C15.6 12.8 14 14.8 12.8 17c-.6 1.2-.9 2.6-1 3.9-.1 1-1 1.4-1.5.6-.6-1-.7-2.4-.3-3.7.9-2.9 2.8-5.5 4.1-8.3.5-1 1.1-2.1 1.5-2.7.3-.3.8-.4 1.3-.5z"/><path class="fill" d="M16.9 6.3c.9-.3 2.3-.5 3.7-.7l-.3 2.9c-1.3.2-2.7.7-3.4 1.7C15.6 12.8 14 14.8 12.8 17c-.6 1.2-.9 2.6-1 3.9-.1 1-1 1.4-1.5.6-.6-1-.7-2.4-.3-3.7.9-2.9 2.8-5.5 4.1-8.3.5-1 1.1-2.1 1.5-2.7.3-.3.8-.4 1.3-.5z"/>',
    'gps': '<path d="M12 21s-6-5.4-6-10a6 6 0 1 1 12 0c0 4.6-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
};

// the sensors that show in the header only while in use
const EXTRA = ['ant:hrm', 'ble:powerMeter', 'ble:speedCadenceSensor', 'ble:smo2', 'ble:coreTemp', 'ble:openBikeControl', 'gps'];

function icon(id, cls = 'hdr-icon__svg') {
    const trainer = id === 'ble:controllable' ? ` ${cls}--trainer` : '';
    return `<svg class="${cls}${trainer}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[id] ?? ''}</svg>`;
}

export { SENSORS, EXTRA, icon };
