# Agora theme across the application

The approved landing page's visual language now continues through the authenticated workspace, account screens, agent authorization, and shared dialogs. The landing page markup, scoped CSS, responsive sizing, and five-stage animation are unchanged.

## Theme and coverage

- Chakra Petch throughout the application, including forms, setup instructions, code samples and tables.
- Parchment surfaces, navy ink, rust actions, teal statuses and gold highlights; square corners, clear borders and offset shadows.
- One matching Capora mark for the workspace, authentication, authorization and favicon. The marketplace reuses the original landing SVG as a static, decorative illustration.
- Shared controls cover marketplace filters/list view, capability schemas and purchasing, overview, agents and spending policies, transactions, approvals, providers, developer setup and the agent playground. Existing status labels remain distinct and readable.
- Workspace body text and compact labels have a readable minimum size. Darker rust and muted shades keep small application text readable on gold and parchment; the original landing palette stays intact.
- Forms and dialogs grow or scroll naturally on short screens. Code blocks and tables scroll within their own containers. Mobile navigation keeps the account and sign-out controls accessible.
- Controlled workspace dialogs restore focus to the opener on Escape/dismissal. Loading placeholders have an explicit status role.

## Screenshots

These screenshots render actual responses from the disposable local Worker/D1 browser fixture. Its payment simulator and example account are isolated from production. Captures show local demonstration labels where applicable; no production purchases were made for visual review.

| Screen                       | Desktop 1440px                              | Mobile 390px                               |
| ---------------------------- | ------------------------------------------- | ------------------------------------------ |
| Marketplace                  | [View](marketplace-1440.png)                | [View](marketplace-390.png)                |
| Capability and purchase form | [View](marketplace-gleif_entities-1440.png) | [View](marketplace-gleif_entities-390.png) |
| Overview                     | [View](overview-1440.png)                   | [View](overview-390.png)                   |
| Agents and budgets           | [View](agents-1440.png)                     | [View](agents-390.png)                     |
| Transactions                 | [View](transactions-1440.png)               | [View](transactions-390.png)               |
| Approvals                    | [View](approvals-1440.png)                  | [View](approvals-390.png)                  |
| Provider console             | [View](providers-1440.png)                  | [View](providers-390.png)                  |
| Developer guide              | [View](developers-1440.png)                 | [View](developers-390.png)                 |
| Agent playground             | [View](demo-1440.png)                       | [View](demo-390.png)                       |
| Sign in                      | [View](login-1440.png)                      | [View](login-390.png)                      |
| Sign up                      | [View](signup-1440.png)                     | [View](signup-390.png)                     |
| Create-agent dialog          | [View](create-agent-1440.png)               | [View](create-agent-390.png)               |
| Capability schema dialog     | [View](list-capability-1440.png)            | [View](list-capability-390.png)            |

The capability schema dialog capture intentionally shows its scrolled schema controls. Agent authorization is also captured in [the existing browser flow](connect-mobile.png).

## Validation

- Production build and Worker dry run, typecheck, lint and whitespace checks.
- 185 unit tests and 28 browser tests.
- All nine workspace routes at 1440×900, 1280×600, 1024×768, 768×1024, 390×844, 390×600, 360×600 and 667×320: shared font and no horizontal page overflow.
- Automated WCAG A/AA checks, including contrast, for all nine desktop workspace routes, desktop/mobile sign-in and sign-up, and the mobile developer guide. Existing landing tests retain their documented palette-specific contrast exception.
- Keyboard dialog trapping, Escape dismissal, restored focus, long provider-form scrolling, reduced-motion behavior, marketplace discovery, account isolation, signup/sign-in, browser agent authorization and MCP tool discovery.
- The existing disposable-local purchase → approval → invocation tests continue to validate functionality. They do not represent hosted PayPal transactions.
- The existing landing tests still cover source palette/artwork, all five trade stages, 13 hero viewport sizes and 10 section viewport sizes.

To regenerate the themed screenshots after a build:

```powershell
$env:CAPORA_CAPTURE_THEME = 'true'
pnpm exec playwright test
Copy-Item .local/screenshots/connect-mobile.png docs/review/agora-app-theme/connect-mobile.png
```

## Changed implementation files

| File                                         | Purpose                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/web/src/theme.css`                     | Shared semantic palette, themed components and responsive refinements                               |
| `apps/web/src/styles.css`                    | Replace previous green palette, rounded corners and mixed fonts with theme tokens; preserve layouts |
| `apps/web/src/main.tsx`                      | Load the shared theme                                                                               |
| `apps/web/src/components/brand.tsx`          | Matching mark and reuse of the original agora SVG                                                   |
| `apps/web/public/favicon.svg`                | Matching browser icon                                                                               |
| `apps/web/src/pages/marketplace.tsx`         | Use the shared marketplace illustration                                                             |
| `apps/web/src/pages/auth.tsx`, `connect.tsx` | Matching brand treatment                                                                            |
| `apps/web/src/components/ui.tsx`             | Dialog focus restoration and loading semantics                                                      |
| `tests/browser/theme.spec.ts`                | Route, viewport, font, accessibility and dialog regressions                                         |
| `tests/browser/landing.spec.ts`              | Expect the requested shared workspace typeface                                                      |

No backend handlers, authentication/session logic, agent authorization decisions, MCP contracts, payment configuration, purchase actions, spending policies, storage, database migrations or deployment configuration changed.
