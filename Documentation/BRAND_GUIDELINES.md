# Brand Guidelines

Socrates is a product name and a persona. It is always capitalised, never abbreviated, and
never localised.

This document is the visual + voice system. Implementation detail lives in
`client/src/index.css`, `tailwind.config.ts`, and `client/public/manifest.webmanifest`.

## Identity

- **Name:** Socrates AI.
- **Short name:** Socrates. (Used inside the UI as the AI persona's name.)
- **Tagline (internal):** "Your OSCE practice partner."
- **Category:** Medical education tool. Not a content platform, not a social network.
- **Tone:** The voice of a kind senior resident. Calm, brief, specific. Never chirpy, never
  dramatic.
- **Icon:** Owl silhouette in Owl Purple on a warm off-white background. Served at
  `/brand/icon.png` (512x512, maskable-safe).

## Core colors

The brand has two anchors: Owl Purple for primary, Wisdom Amber for accent. That is it. No
rainbow. No red anywhere in the UI — see "Destructive" below.

| Token | Hex | HSL (CSS var) | Use |
| --- | --- | --- | --- |
| Owl Purple 500 | `#5A2E9A` | `267 54% 39%` (`--ring`) | Primary brand color. PWA theme color. Hover rings. |
| Owl Purple 700 | `#2D1152` | `268 65% 19%` | Primary text on light surfaces. Secondary surfaces. |
| Owl Purple 800 | `#1E0A38` | `268 70% 13%` (`--primary`) | Button fill, primary background for dark surfaces. |
| Owl Purple 900 | `#0F0520` | — | Deepest shade. Reserved for shadows and dark-mode backdrop. |
| Wisdom Amber 500 | `#E8A520` | `39 81% 52%` (`--brand-accent`) | Brand accent. Used sparingly on **dark surfaces only**. |
| Wisdom Amber 600 | `#C47A0A` | — | Amber hover state. |
| Warm Off-White | `#FAFAF9` | `60 11% 98%` (`--background`) | Page background. PWA background color. |
| Warm 950 (text) | `#1A1520` | `280 17% 10%` (`--foreground`) | Primary body text. |

### Owl Purple ramp (defined in `tailwind.config.ts` under `colors.primary`)

| Step | Hex | Purpose |
| --- | --- | --- |
| 50  | `#F5F1FB` | Hover fills on light surfaces. `--secondary`. |
| 100 | `#E8DCF5` | Borders, separators. |
| 200 | `#CDBAE8` | Disabled outlines. |
| 300 | `#A882D6` | Quiet accents. |
| 400 | `#7B4DB8` | Mid-tone in gradients. |
| 500 | `#5A2E9A` | Brand midpoint, focus ring. |
| 600 | `#3E1A6E` | Hover on primary buttons. |
| 700 | `#2D1152` | Primary text on light. |
| 800 | `#1E0A38` | `--primary`. Button fill. |
| 900 | `#0F0520` | Shadows. |

### Wisdom Amber ramp

| Step | Hex | Purpose |
| --- | --- | --- |
| 100 | `#FDF3DC` | Very soft badge fills. |
| 400 | `#F0BC50` | Amber pills on dark. |
| 500 | `#E8A520` | `--brand-accent`. Timer active state. |
| 600 | `#C47A0A` | Amber hover. |

Amber on light backgrounds reads as a warning, which it should not here. The design rule: use
amber **only on Owl Purple 700+ surfaces**. On light surfaces, use Owl Purple.

## Destructive

The destructive color is a deep warm brown, not red:

- Token: `--destructive: 28 35% 38%` (HSL).
- Approximate hex: `#7A5635`.

Rationale: OSCE practice includes mistakes by design. Saturated red on a mistake feels
punitive and makes the app harder to return to. Warm brown reads as "not this, try again"
without the adrenaline response. Red is also overloaded in clinical UIs (vitals alarms) and
Socrates is not a vitals monitor.

## Typography

From `tailwind.config.ts`:

```
font-family: -apple-system, "SF Pro Display", "SF Pro Text",
             "InterVariable", "Inter", system-ui, sans-serif;
```

Apple HIG-calibrated type scale (iOS-native at touch sizes, portable to Android / desktop
via Inter):

| Token | Size / line-height / weight | Use |
| --- | --- | --- |
| `display` | 34 / 1.08 / 700 | Hero numbers. Station score. Mock-exam final score. |
| `h1` | 28 / 1.15 / 700 | Page titles. |
| `h2` | 22 / 1.25 / 600 | Section headings. |
| `h3` | 17 / 1.35 / 600 | Card headings. |
| `body` | 15 / 1.55 / 400 | Default body copy. |
| `caption` | 13 / 1.4 / 500 | Secondary copy under body. |
| `label` | 11 / 1.3 / 600 / 0.08em tracked | Uppercase labels above groups. |
| `numeric` | 26 / 1.0 / 600 | Tabular numerals on results. |

Letter-spacing on display through h3 is negative (`-0.028em` down to `-0.012em`) because the
San Francisco rendering at those sizes reads as slightly loose at the default. The label
style is the only positive-tracked element.

## Shape

- Border radii: `sm 8px`, `md 12px`, `lg 16px`, `xl 20px`, `2xl 24px`, `3xl 28px`.
- Default CSS `--radius: 0.625rem` (10px).
- Cards default to `md` (12px). Full-width alert cards go to `lg` (16px). Hero cards on the
  home screen go to `2xl` (24px).
- Buttons are `md`. Pills are `full`. No hard corners anywhere in the UI.

## Elevation

Four shadow tokens declared as CSS vars and surfaced on Tailwind as `shadow-xs | sm | md | lg`.
Usage:

- `shadow-xs` — subtle separation (hover on a clickable row).
- `shadow-sm` — card default.
- `shadow-md` — raised card (station card on home).
- `shadow-lg` — floating (bottom sheet, toast, modal backdrop).

Legacy aliases `shadow-card | raised | float` map to sm/md/lg.

## Surfaces and backgrounds

- Primary surface: `--background` (warm off-white on light, deep purple-black on dark).
- Secondary surface: `--muted`. Used for disabled form inputs and quiet sections.
- The desktop view draws a subtle radial gradient (`app-backdrop`) behind the 440-px phone
  frame so the clamped column does not feel like a floating rectangle. See `App.tsx`.
- The auth pages have their own `auth-bg` radial gradient. See `client/src/index.css`.

## Dark mode

Dark mode is a full token override, not a color inversion. The theme color meta tag flips to
`#1E0A38` and the body `root` gets `.dark`. Primary becomes a lighter Owl Purple (400) so it
stays legible on the deep purple-black background, and Wisdom Amber's usage rule relaxes —
amber reads correctly on the dark surface.

## PWA identity

From `client/public/manifest.webmanifest`:

| Field | Value |
| --- | --- |
| `name` | Socrates AI |
| `short_name` | Socrates |
| `theme_color` | `#5A2E9A` (Owl Purple 500) |
| `background_color` | `#FAFAF9` (warm off-white) |
| `categories` | `education`, `medical`, `productivity` |
| `display` | `standalone` |
| `orientation` | `portrait` |

## Voice and copy

Six rules for every string written into the UI:

1. **Say what happened, not how you feel about it.**
   Good: "Station saved." Bad: "Amazing! Your station is saved!"
2. **Use the vocabulary table.**
   Always "Station", "Examiner Questions", "Session", "Socrates". Never "Card", "Viva",
   "Attempt" (except on `mock_exam_attempts`), or "Bot".
3. **Apologise once, then fix it.**
   Error copy says what broke and what to try. No more than one "sorry" per dialog.
4. **Numbers are tabular.**
   Percentages, scores, and times use the `numeric` style so they align in lists.
5. **No emoji.**
   Clinical tool. Medical educators are the audience.
6. **Never call Socrates "an AI".**
   Inside the practice UI, Socrates is "the patient" or "the examiner". The word "AI" appears
   only outside simulation — on settings, billing, error messages.

## Persona (for the patient simulator)

The patient prompt enforces these traits. Copy lives in
`server/services/patient-simulator.ts`.

- Speaks in 1 to 3 sentences.
- Uses lay language. No "oedema", no "pleuritic", no "myocardial" unless the candidate uses the
  word first.
- Answers only the question asked. Does not volunteer.
- Never states a diagnosis, differential, or investigation result. A keyword filter
  (`BLOCKED_DIAGNOSIS_TERMS`, ~80 terms) backstops this and retries with a stricter prompt if
  a leak is detected.

The examiner persona (real-time voice only) is more clipped. "Brief, direct, neutral. Moves on
if the candidate stalls." Voice: Gemini `Charon` for examiner, `Aoede` for patient.

## Assets

All brand assets live under `client/public/brand/`:

- `icon.png` — 512x512 app icon. Used by PWA manifest in both `any` and `maskable` slots.
- Additional sizes are generated at build time if needed; only 512 is committed.

## Do not

- Do not place Wisdom Amber on light surfaces.
- Do not introduce red. Use the warm-brown destructive token.
- Do not add a third brand color. Any new semantic (success, warning, info) must derive from
  the existing ramp or from muted foreground.
- Do not use emoji in the UI, in code comments visible to users, in error toasts, or in
  generated AI copy.
- Do not capitalise "Ai" or "AI" mid-sentence when referring to Socrates. The product is
  "Socrates AI"; the in-simulation persona is just "Socrates".

## Where to go next

- Component primitives (shadcn): `client/src/components/ui/`.
- CSS variables and auth-page gradient: `client/src/index.css`.
- Tailwind config and ramps: `tailwind.config.ts`.
- Frontend layout conventions: `Documentation/FRONTEND.md`.
