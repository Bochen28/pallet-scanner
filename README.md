# Pallet Scanner (web app)

Scan the Code-128 label of every package on a pallet and get the total count plus the full list of codes.
This is the web version for iPhones (it also works on Android in Chrome). It behaves the same as the native
Android and iPhone apps.

**Open:** https://bochen28.github.io/pallet-scanner/

## Install on an iPhone

1. Open the link above in **Safari**.
2. Tap the **Share** button (square with an arrow), then **Add to Home Screen** → **Add**.
3. Start **Pallet Scanner** from the new home-screen icon and allow camera access when asked.

No App Store, Apple ID or computer needed, and nothing expires. After the first start it also works offline.

## How it works

1. **START SCANNING** opens the camera. Every Code-128 barcode in view is added automatically (several at once
   is fine): green **✓ ADDED** banner and a beep. A code already on the list shows an amber
   **ALREADY SCANNED** banner and a low tone, and is not counted twice.
2. Scanning continues until you tap **FINISH SCANNING**.
3. The list shows the **total** and every code in scan order with the scan time: search, sort A–Z,
   remove a wrong scan (✕), **Share** the list, **CONTINUE SCANNING**, or start a **New pallet**.

The list is saved on the phone after every scan; nothing is sent anywhere.

Differences from the native apps: iPhones don't allow web apps to vibrate (you get the beep only), and the
**Light** button appears only on phones whose browser can control the flashlight.

## Development

Plain HTML/CSS/JavaScript, no build step. Barcode reading uses
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 2.2.4 (ZXing-C++ compiled to WebAssembly, MIT licence),
bundled in `vendor/` so the app works offline.

- Run locally: `python -m http.server 8123` in this folder, then open http://localhost:8123
  (the camera needs `localhost` or https).
- Logic tests: `node --test`
- After changing files, bump `CACHE` in `sw.js` so installed copies pick up the update right away.
