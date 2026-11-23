//
// The current rider's threshold heart rates (see thresholds.js). A change
// to the rider's own values is announced as 'training:thresholds', so the
// account sync sends it with the profile and the Training page recounts.
//

import { xf } from '../functions.js';
import { riders } from '../riders.js';
import { createThresholds } from './thresholds.js';

const thresholds = createThresholds({
    key: k => riders.key(k),
    onChange: v => xf.dispatch('training:thresholds', v),
});

export { thresholds };
