# Pixel agora landing page review

The initial design was delivered in PR #4, and the hero was fitted to the first viewport in PR #5. This revision fits the remaining sections beneath the sticky header while leaving that approved hero unchanged. The existing workflow deploys only a successful `main` push/manual run with the deployment variable enabled; feature branches and PRs run verification only.

## Design source and fidelity

The supplied root `index.html` is preserved, unmodified and untracked. An exact copy is committed at [pixel-agora-reference.html](../../design/pixel-agora-reference.html) so comparisons and browser tests are reproducible. SHA-256 at import: `a93c2bf795b2fc9f8abe4a23e95eedd628a9e74747cf80411dc7dff4a767079d`.

The implementation ports the approved SVG geometry and effective CSS directly into native React components. There is no iframe, replacement artwork, or generated illustration. Chakra Petch is the only font family used for the landing interface, including its dialogs. The existing workspace retains its typography.

Browser comparisons against the supplied source passed at **1440×1050** and **390×844**:

- Hero palette, font family, weight, backgrounds, border colors and shadows retained from the source. Its sizing and spacing now intentionally adapt to viewport height.
- Matching computed font families, weights, colors, backgrounds, visible borders and shadows in the section headings, ledger, narrative and spending decree. Section sizes and spacing intentionally adapt to the viewport.
- Every original SVG element and non-class attribute preserved in the JSX port. Class names are prefixed to isolate styles.
- No horizontal page overflow at either width.

Comparison uses the supplied HTML locally. The hosted design URL was not accessible through the web reader; it was not used to substitute or reinterpret the supplied source.

| View            | Implemented                    | Supplied reference               |
| --------------- | ------------------------------ | -------------------------------- |
| Desktop, 1440px | [Screenshot](desktop-1440.png) | [Screenshot](reference-1440.png) |
| Mobile, 390px   | [Screenshot](mobile-390.png)   | [Screenshot](reference-390.png)  |

![Implemented desktop landing page](desktop-1440.png)

## First-viewport hero

The header, headline, copy, primary buttons, full artwork, story controls and complete ticker fit without scrolling across 13 tested viewports: 1920×1080, 1440×900, 1440×768, 1366×768, 1280×600, 1024×768, 820×600, 768×1024, 430×932, 390×844, 375×667, 390×600 and 360×600.

The hero uses viewport-height-aware spacing and type sizes, keeps two columns on tablets/laptops, and scales the SVG proportionally. The caption sits below the artwork so it cannot cover the acquired scroll. Mobile actions share one row with 44px touch targets. Very short landscape/zoomed layouts retain natural scrolling instead of clipping controls.

| First screen            | Screenshot                      |
| ----------------------- | ------------------------------- |
| Laptop, 1366×768        | [View](first-view-1366x768.png) |
| Short desktop, 1280×600 | [View](first-view-1280x600.png) |
| Tablet, 1024×768        | [View](first-view-1024x768.png) |
| Mobile, 390×844         | [View](first-view-390x844.png)  |
| Short mobile, 390×600   | [View](first-view-390x600.png)  |

## Remaining section viewport fit

The marketplace, trade explanation, human controls and closing section fit beneath the sticky header at 1440×900, 1366×768, 1280×600, 1024×768, 820×600, 768×1024, 390×844, 375×667, 390×600 and 360×600. Closing actions and the footer fit together. Section anchors account for the actual header height.

Desktop keeps three stalls side by side. Mobile uses native horizontal scrolling and scroll snap, with previous/next buttons, an announced counter, and left/right keyboard controls. Each card retains the real catalog metadata and complete read-only inspection dialog. On mobile the longer trade explanation is a native disclosure, and the currently selected stage shows its description while all five stage buttons remain visible. Opening the explanation or using a very short/zoomed window allows natural page scrolling; no fixed-height containers clip content.

| Section            | Desktop 1280×600                    | Mobile 390×600                     |
| ------------------ | ----------------------------------- | ---------------------------------- |
| Marketplace        | [View](section-stalls-1280x600.png) | [View](section-stalls-390x600.png) |
| How trade works    | [View](section-how-1280x600.png)    | [View](section-how-390x600.png)    |
| For humans         | [View](section-guard-1280x600.png)  | [View](section-guard-390x600.png)  |
| Closing and footer | [View](section-ag-end-1280x600.png) | [View](section-ag-end-390x600.png) |

## Five-stage exchange

The story is an explicitly labeled illustration. It never requests a quote, buys, invokes a capability, or fabricates an API result. The ledger is an explanation of that same example transaction, not an account transaction history. An explicit reduced-motion offer pose preserves the settled scroll position when the existing workspace's global accessibility rule disables all keyframes.

| Stage          | Behavior verified in the rendered SVG                              | Desktop                                       | Mobile                           |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------- | -------------------------------- |
| 1. Arrival     | Robot enters from the left; scroll remains hidden                  | [Screenshot](desktop-stage-1-arrival.png)     | [Screenshot](mobile-stage-1.png) |
| 2. Offer       | Scroll starts at merchant counter x=665 and travels left to x=556  | [Screenshot](desktop-stage-2-offer.png)       | [Screenshot](mobile-stage-2.png) |
| 3. Inspection  | Robot advances, arm reaches −24°, scroll moves to x=542            | [Screenshot](desktop-stage-3-inspection.png)  | [Screenshot](mobile-stage-3.png) |
| 4. Purchase    | Coin travels right (+94, −40); scroll travels left to x=503        | [Screenshot](desktop-stage-4-purchase.png)    | [Screenshot](mobile-stage-4.png) |
| 5. Acquisition | Scroll overlaps robot chest at x=448; level-up follows its arrival | [Screenshot](desktop-stage-5-acquisition.png) | [Screenshot](mobile-stage-5.png) |

Coordinates are in the original 760×500 SVG viewBox. Screenshots show settled stage positions; motion is checked separately under normal motion settings. The original SVG and `preserveAspectRatio` attribute remain intact; the frame now follows its 760:500 ratio, showing all of the artwork. Replay restarts arrival; numbered controls and the ledger select and hold a stage. Reduced motion disables automatic progression and settles each selected stage without continuous animation. A pause/play control also pauses decorative movement.

## Application integration and differences

There are no framework constraints requiring a visual substitute. These deliberate production integrations are the remaining differences:

- **Hero sizing:** Updated from fixed padding/minimum scene heights to viewport-aware sizing at the user's request. Hero metrics intentionally differ from the original HTML. Captions sit below the artwork; mobile scene tags and spacing become more compact on shorter screens.
- **Section sizing:** Responsive section spacing, typography and card artwork sizing replace the original fixed spacing. Mobile stalls scroll horizontally, and the trade explanation expands on demand. The approved hero CSS, markup and SVG are unchanged in this revision.
- **Featured listings:** Names, descriptions, prices, pricing units and execution modes come from the existing public `/api/capabilities` catalog for `gleif_entities`, `brave_search`, and `code_scan`. Full catalog descriptions are longer than the mockup copy; card previews show three lines, and inspection shows the complete description. The registry's actual name is “Company Registry Search.” Loading, failed, disabled or missing listings do not display invented prices or offer an inspection purchase path.
- **Navigation:** “Explore the agora” opens `/marketplace`; “Open workspace” opens `/overview`; “Connect your agent” opens `/developers`, which already contains the setup prompt and MCP connection guide. Inspection links to the existing `/marketplace/:id` schema and purchase page. These destinations retain the existing sign-in redirect and return path. In-page navigation remains as designed.
- **Demonstration text:** The hero and capability dialog explicitly state **FOR DEMONSTRATION PURPOSES ONLY**. The spending decree retains the reference's amounts but is labeled an example policy rather than implying that it reflects a signed-in agent's settings.
- **Accessibility:** Added a skip link, a pause/play control, semantic keyboard-operable ledger buttons, menu Escape handling, and Radix dialog focus trapping, Escape dismissal, focus restoration and background scroll locking. The level-up burst waits for the scroll's transition to finish. The single-font requirement applies to the landing page and its dialogs; existing workspace screens keep their current design.

The landing page only reads public catalog metadata. Authentication, agent authorization, MCP, quote/purchase/invocation handlers, payment configuration, spending policies, security controls, storage, migrations and deployment workflow are unchanged.

## Validation

Verified locally on October 17, 2026 (America/Phoenix):

| Check                       | Result                                                       |
| --------------------------- | ------------------------------------------------------------ |
| `pnpm typecheck`            | Passed                                                       |
| `pnpm lint`                 | Passed                                                       |
| `pnpm build`                | Passed: Vite production assets and Wrangler **dry run only** |
| `pnpm exec vitest run`      | 185 tests passed across 13 files                             |
| `pnpm exec playwright test` | 18 browser tests passed, including 9 landing tests           |
| `git diff --check`          | Passed                                                       |

The full browser suite includes signup/sign-in, account isolation, short/mobile navigation, copied setup prompt → browser authorization → real MCP tool discovery, marketplace filtering and details, and the **disposable local payment simulator** purchase/approval/queued-execution flow. It uses isolated storage and credentials. These local results do not claim a new hosted PayPal transaction; production deployment and live verification are tracked separately by the release workflow.

Read-only production checks returned `status: ok`, `paymentMode: sandbox`, and the expected enabled featured listings/prices ($0.20, $0.05, $3.00). No production account or payment mutation was made.

**Known accessibility limitation inherited from the approved design:** the reference palette contains small text below WCAG AA contrast. Examples include rust ledger labels (~3.88:1), white primary-button text (~4.09:1), and the footer demonstration note (~2.90:1). Colors were retained for fidelity. The automated accessibility checks exclude `color-contrast` explicitly and otherwise pass WCAG A/AA rules for the landing page and open dialog; this is not a claim of full WCAG conformance. Keyboard, focus, reduced-motion and pause behavior are verified independently.

To regenerate screenshots alongside browser verification, after building:

```powershell
$env:CAPORA_CAPTURE_LANDING = 'true'
pnpm exec playwright test tests/browser/landing.spec.ts
```

## Changed files

| File                                            | Purpose                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/web/src/pages/landing.tsx`                | Native page structure, navigation and story state                               |
| `apps/web/src/pages/landing-sections.css`       | Viewport-aware marketplace, trade, guardrails, closing and footer               |
| `apps/web/src/components/agora-explanation.tsx` | Native responsive trade explanation disclosure                                  |
| `apps/web/src/pages/landing-hero.css`           | Viewport-aware hero layout, artwork frame and ticker sizing                     |
| `apps/web/src/pages/landing.css`                | Scoped reference styles and accessibility/integration additions                 |
| `apps/web/src/components/agora-art.tsx`         | Original SVG artwork as JSX                                                     |
| `apps/web/src/components/agora-story.tsx`       | Five stages, captions, controls and reduced-motion preference                   |
| `apps/web/src/components/agora-stalls.tsx`      | Catalog-backed stalls and accessible read-only inspection dialogs               |
| `apps/web/index.html`                           | Chakra Petch loading and matching theme color                                   |
| `tests/browser/landing.spec.ts`                 | Visual-source comparison, animation, routes, catalog failures and accessibility |
| `docs/design/pixel-agora-reference.html`        | Unmodified supplied source                                                      |
| `docs/review/pixel-agora/`                      | Review notes and desktop/mobile evidence                                        |
