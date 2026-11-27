// @ts-check
//
// Why the trainer and sensors can't connect in this browser, and what to do.
// Bluetooth is missing for three different reasons, which need different
// advice: a page that isn't secure (plain http on another address; Chrome
// hides Bluetooth there), iOS (no Web Bluetooth in any browser), or a
// browser without it (Firefox, Safari).
//

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

// {secure, bluetooth, host, userAgent} -> {kind, text} | null
function compatibilityProblem({secure, bluetooth, host = '', userAgent = ''}) {
    if(bluetooth) return null;
    const name = String(host).replace(/:\d+$/, '');
    if(!secure) {
        return {
            kind: 'insecure',
            text: `The trainer and sensors can't connect: Bluetooth only works on a secure page, and ${host} is opened over plain http. ` +
                  `Open https://${name}:8443 (with the Docker setup and its certificate), or http://localhost on the computer that runs it. ` +
                  'Everything else works here.',
        };
    }
    if(/iPhone|iPad|iPod/.test(userAgent)) {
        return {
            kind: 'ios',
            text: "iPhone and iPad have no Bluetooth for web pages, whatever the browser, so the trainer and sensors can't connect here. " +
                  'You can still look at your training. To ride, use Chrome or Edge on a computer or an Android device.',
        };
    }
    return {
        kind: 'browser',
        text: "This browser has no Bluetooth for web pages, so the trainer and sensors can't connect. " +
              'Use Chrome or Edge (or another Chromium browser) on Windows, macOS, Linux or Android. Everything else works here.',
    };
}

export { compatibilityProblem, esc };
