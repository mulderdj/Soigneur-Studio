// @ts-check

const TimerStatus = Object.freeze({
    stopped: 'stopped',
    started: 'started',
    paused: 'paused',
    resumed: 'resumed',
});

const TimerAction = Object.freeze({
    start: 'start',
    stop: 'stop',
    pause: 'pause',
});

const EventType = Object.freeze({
    start: 'start',
    stop: 'stop',
});

export {
    TimerStatus,
    TimerAction,
    EventType,
};
