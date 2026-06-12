# Apple Pay In-App — Route A (SFSafariViewController Handoff)

**Status:** Scoped 2026-06-12 · Not yet built
**Decision:** Route A chosen over Braintree-native (Route B) and waiting (Route C).

---

## Why Route A (decision record)

- **Web Apple Pay is live** (shipped 2026-06-12): PayPal JS SDK `applepay`
  component on newquest.html, domain `www.finderseek.com` registered with
  Apple via PayPal. First live Face ID transaction confirmed same day ($11,
  quest TXA-0011).
- **Plain PayPal has no native-app path.** PayPal's Apple Pay for direct
  merchants is JS-SDK/web only; their native Mobile iOS SDK supports
  PayPal + cards but NOT Apple Pay. The only PayPal-family native Apple Pay
  is **Braintree**, which is a separate gateway with separate settlement
  (bank deposit, not the FinderSeek PayPal balance). That breaks the
  manual-payout workflow → rejected.
- Route A keeps 100% of money flow identical to the web: card → PayPal →
  existing PayPal business account, same fees, same escrow/capture/TTS/
  scheduling pipeline (`create-checkout.js` → `paypal-capture.js`).
- Apple Pay works in **SFSafariViewController** (unlike WKWebView, where
  Apple disables it for script-injecting apps like Capacitor).

## App Review risk posture (researched 2026-06-12)

- Prior rejection (Sign in with Apple in a browser) was the **login-specific
  rule** (native AuthenticationServices required). Payments for **physical
  goods/services** fall under guideline **3.1.5(a)**: must use non-IAP
  payments; web checkout is standard and FinderSeek's in-app payments have
  ALWAYS been web pages — already approved in v1.1.
- Guardrail 1: use **SFSafariViewController** (in-app sheet), never bounce
  to the external Safari app.
- Guardrail 2: **no Apple Pay-branded button inside the app UI.** The app
  trigger stays generic ("Fund Quest" / "Secure checkout"). The Apple Pay
  button appears only on the web page inside the sheet (HIG: the Apple Pay
  button must directly summon the payment sheet).
- Review notes text (use verbatim in App Store Connect):
  > Quest funding pays for physical cash prizes hidden at real-world
  > locations. Per guideline 3.1.5(a) these are processed outside IAP via
  > PayPal / Apple Pay on our secure checkout page.
- Bounded downside: if rejected, remove the in-app entry point; web Safari
  Apple Pay is untouched (outside App Review jurisdiction).

## Key existing assets (verified in repo)

- `@capacitor/browser` is **already installed** (`node_modules/@capacitor/browser`)
  → SFSafariViewController via `Browser.open()`. VERIFY it's compiled into
  the shipped iOS binary (check `ios/App/Podfile` for CapacitorBrowser);
  if yes, **v1 needs no Xcode rebuild**.
- newquest.html already accepts an auth token in the URL: `?at=<token>`
  (line ~1581) → solves the "SFSafariViewController doesn't share
  localStorage with the app webview" problem.
- newquest.html already has payment success **polling**
  (`_stopPaymentPoll` etc.) → the app side can detect funding without any
  message channel from the Safari sheet.

## v1 flow (target: zero native changes)

1. App webview (newquest.html, in Capacitor): user reaches the payment
   step. Detect native platform (`window.Capacitor.isNativePlatform()`).
2. Show a generic "Secure checkout" option alongside the existing in-app
   PayPal buttons (which keep working as today).
3. On tap: `Browser.open({ url:
   'https://www.finderseek.com/newquest.html?pay=1&huntId=<id>&at=<token>' })`
   → SFSafariViewController with the full payment modal, Apple Pay button
   included (ApplePaySession exists there).
4. `?pay=1` mode: page jumps straight to the payment modal for `huntId`
   (skip the builder), shows a "Payment complete? Return to the app" note
   after success.
5. Meanwhile the app page polls `hunts?id=eq.<huntId>&select=escrow_status,
   status,quest_id` every ~3s. When `escrow_status=funded`:
   `Browser.close()` + show the existing PIN card flow.
6. User taps Done / sheet closes → they're back in the app on the PIN card.

### v1 open questions
- [ ] Confirm CapacitorBrowser pod is in the live binary (else v1 needs the
      rebuild and should batch with v2).
- [ ] PIN handling: PIN is generated client-side pre-payment in the app
      webview; `?pay=1` mode in the sheet must NOT regenerate it. Pass
      nothing — the hunt row already exists as draft; sheet only pays.
- [ ] Token freshness: `at` token may expire if user dawdles; sheet page
      already has refresh logic — verify it works token-only (no sb session).
- [ ] Decide whether to hide the in-sheet PayPal buttons in `?pay=1` mode
      (probably keep them — more payment options, same pipeline).

## v2 polish (batch with next native release)

Batch with: maintained Google sign-in plugin migration (drop the
privacy-manifest fixer build phase) + native Apple sign-in sheet.

- Deep-link return: after payment success the sheet page redirects to a
  universal link / custom scheme; app handles `appUrlOpen` →
  `Browser.close()` instantly (no polling latency).
- Optional: revisit true-native sheet ONLY if PayPal ships Apple Pay in
  their native Mobile SDK (watch paypal/paypal-ios releases). Apple
  Merchant ID `merchant.com.finderseek.app` is already registered
  (2026-06-12) and costs nothing to hold. Do NOT generate a payment
  processing certificate until a processor CSR exists to generate it
  against (PayPal-direct provides none; only Braintree does).

## Test plan (v1)

1. TestFlight/dev build or live app: fund a $1 quest via "Secure checkout"
   → sheet opens, Apple Pay button renders, Face ID completes.
2. App detects funding within ~3s, sheet closes, PIN card shows, quest
   scheduled/active correct, TTS fires, (post-deploy) scheduled-confirmation
   email arrives.
3. Regression: in-app PayPal buttons still work without the sheet.
4. Cancel path: open sheet, tap Done without paying → app still on payment
   step, no orphaned state, can retry.
5. Token-expired path: leave sheet idle 1h+, attempt payment.

## Effort estimate

- v1 (web + existing plugin): ~1 evening build + 1 evening test.
- v2 (deep link + plugin migrations + native Apple sign-in): 2–3 evenings
  + App Review cycle.
