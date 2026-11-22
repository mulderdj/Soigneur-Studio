# Auuki Desktop (fork)

A fork of [dvmarinoff/Auuki](https://github.com/dvmarinoff/Auuki) with a dashboard made for PC, laptop and TV screens. Phones, tablets and dock mode keep the original layout; the desktop layout switches on at 1200 × 680 px and up.

**What's new on the home screen**
* **Wide-screen layout**: power as a large tile that takes the colour of your current power zone (with zone name and live W/kg), the other metrics in a compact grid, connections in a slim header and one bottom bar for the clock and navigation.
* **Live ride chart**: power coloured by zone, target power, heart rate and cadence, with 5 min, 20 min or whole-ride views, a hover read-out and series toggles. Your choices are remembered.
* **Live training statistics** (sidebar):
  * *This interval*: average power against target, the share of time within 5 % of target, and pacing cues ("Above target by 20 W — ease off", low cadence under load, heart-rate drift)
  * *Training load*: TSS, intensity factor, normalized power, work (kJ)
  * *Power*: average, max, average W/kg, variability index
  * *Heart*: average, max, efficiency factor (NP/HR), power:HR decoupling
  * *Time in zone*: the app's 7 zones (Recovery to Anaerobic), using your FTP
  * *Best efforts*: 5 s, 1 min, 5 min and 20 min in W and W/kg
* **GoldenCheetah metrics** (same formulas as GoldenCheetah's `src/Metrics`):
  * *Anaerobic reserve*: live W′bal (Skiba differential model), time until W′ is empty at the current power, matches burned (efforts above FTP costing ≥ 2 kJ), lowest W′bal, work above FTP. W′ is editable in the panel (default 20 kJ, as in GoldenCheetah); FTP is used as CP.
  * *Training load*: BikeScore and xPower next to TSS and NP, plus the aerobic / anaerobic split from Skiba's TISS.
  * W′bal line on the ride chart, and peak power for 5 s, 30 s, 1, 5, 10, 20 and 60 min.
* Light and dark theme, 4K / TV scaling, and statistics rebuilt from the recorded session after a page reload.

**More workout files.** Load several at once from the Workouts page:
* `.zwo` Zwift workouts (also when saved as `.xml`)
* `.erg` (watts) and `.mrc` (percent of FTP) from TrainerRoad, GoldenCheetah, PerfPRO and others, including `[COURSE TEXT]` cues
* `.txt` intervals.icu workout text: `- 10m ramp 50-75% 85rpm`, `Main set 5x`, `200w`, `Z2`, `1m30s`, cues as free text
* `.fit` courses (as before)

Extensions are case-insensitive. Files that can't be read are listed in an error message, and the other files still load.

New files: `src/analytics.js` (the statistics, tested in `test/analytics.test.js`), `src/workouts/formats.js` (workout formats, tested in `test/workout-formats.test.js`), `src/views/training-dashboard.js` (chart and sidebar), `src/css/desktop.css` (layout and theme).

Run it locally with `npm install` then `npm start`, and open the printed address in Chrome or Edge. Web Bluetooth needs `localhost` or HTTPS. For accounts in development, run `npm run server` in a second terminal; the Parcel dev server forwards `/api` to it (`.proxyrc.json`). Server tests: `npm run test:server`.

**Riders, accounts and saved sensors.** The rider pill at the top left of the home screen opens a panel with:
* *Riders*: several riders on one device, each with their own FTP, weight, W′, workouts, rides and saved sensors. Switching reloads the app with that rider's data.
* *Account*: sign in to the self-hosted account server (part of the Docker setup) to sync FTP, weight, W′, imported workouts and every saved ride across devices, without the 7-ride limit. The first account becomes the admin.
* *Sensors*: the last trainer, heart-rate strap, power meter and other sensors per rider. With Chrome's persistent Bluetooth permissions (`chrome://flags/#enable-web-bluetooth-new-permissions-backend`) they reconnect when the app opens, without the device list.
* *Ride history*: all rides on your account, with `.fit` download, upload status per service, and *Send to Strava / intervals.icu / Garmin*.
* *Connected services* (under *Account*), per rider:
  * **Strava**: *Connect with Strava*; new rides upload automatically to the rider's own Strava. Needs one Strava API app for the server (`PUBLIC_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`; see `.env.example`). New Strava apps start with a limit of 1 connected athlete until Strava raises it.
  * **intervals.icu**: paste the personal API key; new rides upload automatically.
  * **Garmin Connect**: Garmin's upload API is for approved businesses only, so *Send to Garmin* downloads the `.fit` and opens Garmin's import page.
  * Uploads retry after 30 s, 5 min and 30 min; tokens and keys stay on the server.
* *Users* (admins): create accounts, reset passwords, change roles, disable or delete accounts.

## Run with Docker

The container only serves the web page. Bluetooth and ANT+ still run in Chrome or Edge on the computer you ride with, so Docker does not affect them. Your trainer, heart-rate strap and ANT+ USB stick connect to that computer, not to the Docker host. The browser only allows Bluetooth and USB on a secure page: `https://…` or `http://localhost`.

```sh
docker compose up -d --build
```

This starts two containers: `auuki` (Caddy serving the app) and `api` (the account server, data in the `api-data` volume). Open the app, click the rider pill, and create the first account under *Account*; it becomes the admin. Set `ALLOW_SIGNUP=true` to let riders create their own accounts.

* **Riding on the same machine:** open `http://localhost:8080`. No certificate needed.
* **Riding on another device** (Docker on a notebook or NAS, riding on a PC or Android phone): start it with the address the other devices use, then open `https://<that address>:8443` there.

  ```sh
  AUUKI_HOST=192.168.1.20 docker compose up -d --build
  docker compose cp auuki:/data/caddy/pki/authorities/local/root.crt ./auuki-root.crt
  ```

  Install `auuki-root.crt` as a trusted root certificate on each riding device. On Windows, import it under *Trusted Root Certification Authorities*. On Android, use *Settings → Security → Install a certificate → CA certificate*. Use the same address in the browser as in `AUUKI_HOST`. The certificate is kept in the `caddy-data` volume, so you only install it once.
* **Quick test without a certificate**, one PC only: in Chrome open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<host>:8080`, and relaunch Chrome.

---

<img alt="Auuki Indoor Cyling app for Structured Training" src="https://github.com/user-attachments/assets/292a3216-2f52-4994-9b15-614446e41912" />

# Auuki
Auuki is a powerful, no-nonsense app built for hammering out **structured workouts** on a smart trainer, right in your browser. No installs, no dependencies, no slow updates taking from precious training time.

**Key Features**:
* Run Zwift **.ZWO workouts**
* Connect via **Bluetooth** to smart trainers, power meters, heart rate monitors, the moxy monitor, and many more
* Full control with **ERG mode**, **Grade Simulation**, and **Resistance mode**
* Workouts with **Slope-based targets** for realistic effort control
* Record **.FIT activities** in a cross-industry standard
* Recording of native **RR intervals** in the .FIT file
* Built-in structured workouts to get you started
* **Intervals.icu and Strava** integrations for seamless syncing and uploads

Built as a **progressive web app (PWA)**, Auuki is fully browser-based and runs independently. It makes use of some of the most advanced Browser APIs like: Web Bluetooth, Web Serial, and Web Components. The web version is **free and open-source**, keeping everything on your device.
Train anywhere, with full control directly in your browser.

_Status_: Currently working on creating a full suite of Apple platform native apps (iOS, iPadOS, tvOS, watchOS).

# The Web App
- You can find the web app at [auuki.com](https://auuki.com)
- There is also a special development version which has the latest features available for preview: [dev.auuki.com](https://dev.auuki.com)
- [How to create a Profile and Connect Intervals.icu](https://forum.intervals.icu/t/auuki-com-intervals-icu-integration/87105)

## Sponsors 💖
So, if you’re loving what Auuki’s bringing to the table, consider supporting the project on [GitHub Sponsors](https://github.com/sponsors/dvmarinoff)? Think of it as buying me a coffee or, heck, a whole power meter to keep this thing cranking. Hit that sponsor button and let’s keep the good times rolling!

## Supported Browsers and Platforms

### MacOS, Windows, Andorid 

Please use either Chrome, Edge, Opera, Samsung Internet, or Brave. These browsers include built-in bluetooth.

| Chrome | Edge | Opera | Chrome Android | Samsung Internet | Brave | Firefox | Safari | Safari iOS | Chrome iOS |
|--------|------|-------|----------------|------------------|-------|---------|--------|------------|------------|
| yes    | yes  | yes   | yes            | yes              | yes*  | no      | no     | no         | no         |

If using Brave browser, you'll need to [manually enable bluetooth support](https://community.brave.com/t/can-you-enable-web-bluetooth-api-in-brave/522553/2).

### Linux
On Linux you might need to turn on the experimental platforms feature flag in your browser:

- Chrome: `chrome://flags/#enable-experimental-web-platform-features`

- Edge: `edge://flags/#enable-experimental-web-platform-features`

- Opera: `opera://flags/#enable-experimental-web-platform-features`

### iOS
Not Supported by the Web version

## Supported Trainers

### FTMS, FE-C over BLE, or WahooCPS

Works with all trainers that implement the bluetooth Fitness Machine Service (FTMS) or the Tacx FE-C over BLE solution.

The following table is copied from [DC Rainmaker Trainer Guide](https://www.dcrainmaker.com/2020/11/smart-cycle-trainer-recommendations-guide-winter.html/#technical-considerations) and shows current protocol support across the industry.

```
- Elite:    ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Gravat:   ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers
- JetBlack: ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Kinetic:  ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Minoura:  ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Saris:    ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- STAC:     ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Tacx:     ANT+ FE-C on all ‘Smart’ branded trainers (except Satori). FTMS on all non-NEO models. FEC over BLE on NEO.
- Wahoo:    ANT+ FE-C on all smart trainers. FTMS on all 2020 smart trainer.
- 4iiii:    ANT+ FE-C and Bluetooth FTMS on Fliiiight (--Ed)
- Schwinn:  Bluetooth FTMS on the IC8 / 800IC (--Ed)
```

### ANT+

Support for ANT+ is experimental at the moment. It is being rewritten right now and the code is moved to [WebANT](https://github.com/dvmarinoff/WebANT), which has a separate demo. When it becomes stable enough will be merged here. It currently has support for Ubuntu(Linux), and partially for MacOS, and Android. Windows 10 may be possible in the future.


The current development setup is using Suunto movestick mini, Garmin Fenix 5 watch broadcasting heart rate,
Tacx Heart Rate monitor, Tacx Flux S trainer, and X240 laptop with Ubuntu 20.04.2 LTS, M1 Mac, and Samsung S9 Android phone.

## Manual
- [How to create a Profile and Connect Intervals.icu](https://forum.intervals.icu/t/auuki-com-intervals-icu-integration/87105)
- [How-To: Using the connection settings](https://github.com/dvmarinoff/Auuki/discussions/91)
- [How-To: Using Auuki and another app concurrently](https://github.com/dvmarinoff/Auuki/discussions/101)

## Backers
<div>
    <a href="https://github.com/KlausMu" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/14290221?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/TClin76" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/96434118?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/fvolcic" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/59806465?s=64&v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/napfbike" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/192727271?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/sharalds" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/25537910?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/BenSimpsonAnalytics" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/81325092?v=4" width="48" height="48" />
    </a>
</div>
