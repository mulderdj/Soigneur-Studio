import { xf, formatDate, escapeHtml, } from '../functions.js';
import { models } from '../models/models.js';
import { formatTime, } from '../utils.js';

class ActivityList extends HTMLElement {
    constructor() {
        super();
        this.capacity = 3;
        this.index = 0;
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        xf.sub('activity:add', self.onAdd.bind(this), this.signal);
        xf.sub('db:activity', self.onRestore.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
        this.unsubs();
    }
    onAdd(activity) {
        const self = this;
        self.insertAdjacentHTML("afterbegin", self.template(this.index, activity));

        if(this.childElementCount > 3) {
            self.removeChild(self.lastElementChild);
        }

        this.index++;
    }
    onRestore(activities) {
        const self = this;
        activities.forEach((a) => {
            self.insertAdjacentHTML("beforeend", self.template(this.index, a));
        });
    }
    id(data) {
        return data.id;
    }
    name(data) {
        return data.name;
    }
    date(data) {
        return formatDate({
            date: new Date(data.timestamp),
            separator: '/',
            year: false,
        });
    }
    duration(data) {
        return `${Math.ceil(data.duration / 60)} min`;
    }
    template(i, data) {
        const id = escapeHtml(this.id(data));
        const name = escapeHtml(this.name(data));
        // uploads to Strava and intervals.icu happen through the account
        // server (rider menu); this list keeps rides on this device
        return `
            <activity-item id="i${i}--activity--item" class="list-row activity" data-id="${id}">
                <div class="list-row__main">
                    <div id="i${i}--activity--date" class="list-row__title activity--name">${name}</div>
                    <div class="list-row__meta">
                        <span class="activity--date">${this.date(data)}</span> ·
                        <span id="i${i}--activity--duration" class="activity--duration">${this.duration(data)}</span>
                    </div>
                </div>
                <view-action on="click" action=":download" topic=":activity:${id}">
                    <button type="button" class="btn btn--icon" aria-label="Download ${name} (.fit)">
                        <svg width="24" height="24"><use href="#icon--save-btn" /></svg>
                    </button>
                </view-action>
                <view-action on="click" action=":remove" topic=":activity:${id}">
                    <button type="button" class="btn btn--icon btn--danger" aria-label="Delete ${name}">
                        <svg width="24" height="24"><use href="#icon--delete" /></svg>
                    </button>
                </view-action>
            </activity-item>
        `;
    }
}

customElements.define('activity-list', ActivityList);

class ActivityItem extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };
        this.id = this.dataset.id;

        xf.sub(`action:activity:${self.id}`, this.onAction.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onAction(action) {
        if(action === ':remove') {
            models.activity.remove(this.id);
            this.remove();
            return;
        }
        if(action === ':download') {
            models.activity.download(this.id);
            return;
        }
    }
}

customElements.define('activity-item', ActivityItem);
