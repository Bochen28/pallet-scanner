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

1. **START SCANNING** opens the camera. Every package label in view is added automatically (several at once
   is fine): green **✓ ADDED** banner and a beep. A code already on the list shows an amber
   **ALREADY SCANNED** banner and a low tone, and is not counted twice.
   Only package labels count: Code-128 barcodes starting with **0000**, or with **one digit 1–9 followed by
   0000** (e.g. `00001234567`, `30000123456`). Other barcodes on the boxes are ignored.
2. Scanning continues until you tap **FINISH SCANNING**.
3. The list shows the **total** and every code in scan order with the scan time: search, sort A–Z,
   remove a wrong scan (✕), **Share** the list, **CONTINUE SCANNING**, or start a **New pallet**.

The list is saved on the phone after every scan; nothing is sent anywhere.

## Comparing with the printed list

1. On the main screen, under **Printed list**, tap **📷 Scan printed list**. Hold the list inside the white
   frame and move the phone slowly down it (2–3 seconds per part). The camera reads the list live, on the
   phone; every package number read twice is added with a beep. Long lists are fine: just keep going, or
   tap **FINISH LIST** and later **📷 Continue list scan**. Numbers already on the list are not added again.
2. Only package numbers are taken from the list (starting with 0000 or one digit + 0000); dates, order numbers,
   quantities and other text are skipped. A wrong number can be erased right away with ✕ under
   **LAST READ**. Numbers can also be typed or pasted with **Type numbers**.
3. **Compare** shows the result; every printed-list position can be fixed (✎) or erased (✕):
   - ✗ **Missing from pallet**: on the list, not scanned
   - \+ **Not on printed list**: scanned, but not on the list
   - ? **Check**: one character different (usually a misread of the list)
   - ✓ **Matched**
4. While scanning packages, one that isn't on the printed list shows a purple **NOT ON PRINTED LIST** banner
   with a different sound, and the counter shows how many of the list have been found.

Small differences are tolerated: spaces, dashes and brackets, a barcode with the GS1 `00` prefix in front of the
printed number, and typical misreads such as O/0, I/1, S/5, B/8. **Share** includes the comparison.

Differences from the native apps: iPhones don't allow web apps to vibrate (you get the beep only), and the
**Light** button appears only on phones whose browser can control the flashlight.

## Development

Plain HTML/CSS/JavaScript, no build step. Barcode reading uses
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 2.2.4 (ZXing-C++ compiled to WebAssembly, MIT licence);
reading the printed list uses [Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 (Apache-2.0) with the
English model. Both are bundled in `vendor/` so the app works offline.

- Run locally: `python -m http.server 8123` in this folder, then open http://localhost:8123
  (the camera needs `localhost` or https).
- Logic tests: `node --test`
- After changing files, bump `CACHE` in `sw.js` so installed copies pick up the update right away.
