//
// Which layout the app is in. The CSS breakpoints match these numbers
// (see src/css/ride.css); JS uses this where behaviour changes per layout.
//

const PHONE_MAX = 599;
const DESKTOP_MIN = 1200;
const TV_MIN = {width: 2200, height: 1100};

function layoutFor(width, height) {
    if(height <= PHONE_MAX && width > height && width < DESKTOP_MIN) return 'phone-landscape';
    if(width <= PHONE_MAX) return 'phone';
    if(width < DESKTOP_MIN) return 'tablet';
    if(width >= TV_MIN.width && height >= TV_MIN.height) return 'tv';
    return 'desktop';
}

function currentLayout() {
    return layoutFor(window.innerWidth, window.innerHeight);
}

function isPhone(layout = currentLayout()) {
    return layout === 'phone' || layout === 'phone-landscape';
}

// the live chart on a phone has room for the last 5 minutes only; the
// rider's own choice (5 min / 20 min / whole ride) applies on wider screens
function chartRangeFor(layout, saved) {
    return isPhone(layout) ? '5' : saved;
}

export { layoutFor, currentLayout, isPhone, chartRangeFor };
