# Mobile viewport and device review

GPTMD's automated mobile layout suite uses representative screen sizes from the
[MobileViewer device list](https://mobileviewer.github.io/#viewerStage). Run it
with:

```sh
npm run test:e2e:mobileviewer
```

The suite checks horizontal overflow and the primary navigation at iPhone 15,
iPhone SE, Galaxy S24, open Galaxy Z Fold 5, and iPad Mini viewport sizes. It
also opens a mocked encounter at each size, confirms the Chart tab is selected
when entering the room, verifies patient details and image load, and repeats the
overflow check after rotating to landscape. It uses Chromium viewport and touch
emulation; it does not run iOS Safari, Android Chrome, or the MobileViewer
website itself.

## Manual visual review with MobileViewer

For a visual check, open the [MobileViewer preview](https://mobileviewer.github.io/#viewerStage),
enter a public test deployment URL, and inspect the iPhone 15, Galaxy S24, and
iPad Mini presets in portrait and landscape. Check the navigation, encounter
layout, scrolling, and chart readability. Save a screenshot and note the target
URL, preset, orientation, and result with the review.

Use a test deployment containing fictional data and no signed-in learner. The
viewer embeds the supplied URL in an iframe; the app's content security policy
may prevent embedding. Keep that policy intact and use the automated suite or a
direct browser/device check when framing is blocked. MobileViewer's own FAQ
also recommends real-device checks for browser-specific rendering.

MobileViewer advertises exact CSS viewport dimensions and QR sharing, while
noting that its simulation cannot reproduce full device and browser rendering.
Treat it as a visual review aid, not evidence of iOS WebKit, Android browser,
microphone, or authentication behavior.

## Browser-engine coverage

The standard Playwright suite covers Chromium, Firefox, and desktop WebKit. The
preflight suite also runs a WebKit iPhone 13 emulation profile. These runs do not
launch Safari on an iPhone or iPad.

Opera desktop has a separate run because it requires the Opera browser binary:

```sh
npm run test:e2e:opera
```

The runner uses `/usr/bin/opera` by default; set `OPERA_EXECUTABLE_PATH` when
Opera is installed elsewhere. It runs the main browser checks and the encounter
preflight checks against Opera. On 2026-10-07, Opera 136.0.6008.80 passed 13
main UI tests and 10 encounter-preflight tests.

WebKit is not a universal proxy for every iOS browser. Apple offers alternative
browser-engine entitlements for qualifying apps in the EU (iOS/iPadOS 17.4+)
and Japan (iOS 26.2+). Browser engine behavior can therefore vary by region,
OS version, and entitlement. The WebKit iPhone profile is useful regression
coverage, but it does not replace Safari or Opera testing on physical Apple
devices. See Apple's current requirements for [the EU](https://developer.apple.com/support/alternative-browser-engines/)
and [Japan](https://developer.apple.com/support/alternative-browser-engines-jp/).
