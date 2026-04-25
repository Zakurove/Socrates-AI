# Socrates AI — Brand Guidelines

---

## 1. Color System

### Primary — Owl Purple

| Shade | Hex | Usage |
|---|---|---|
| Purple 50 | `#F5F1FB` | Card backgrounds, tinted surfaces |
| Purple 100 | `#E8DCF5` | Hover states on light surfaces, borders |
| Purple 200 | `#CDBAE8` | Disabled states, subtle dividers |
| Purple 300 | `#A882D6` | Muted icons, placeholder text on dark bg |
| Purple 400 | `#7B4DB8` | Secondary interactive elements |
| Purple 500 | `#5A2E9A` | Links, focus rings, active states |
| Purple 600 | `#3E1A6E` | Hover on primary buttons |
| Purple 700 | `#2D1152` | Dark navbar, dark card headers |
| **Purple 800** | **`#1E0A38`** | **PRIMARY — logo, main CTAs, dark mode base** |
| Purple 900 | `#0F0520` | Deepest backgrounds in dark mode |

---

### Accent — Wisdom Amber

| Shade | Hex | Usage |
|---|---|---|
| Amber 100 | `#FDF3DC` | Notification banners, reward card backgrounds |
| Amber 400 | `#F0BC50` | Score bar fill, icon highlights |
| **Amber 500** | **`#E8A520`** | **CTA buttons on dark bg, score badges, achievements** |
| Amber 600 | `#C47A0A` | Amber text on light backgrounds, hover state |

> Use amber for CTAs on dark/purple backgrounds only. Never as a primary button on white.

---

### Semantic Colors

| State | Hex | Surface | Usage |
|---|---|---|---|
| **Pass / Correct** | `#0D9488` | `#F0FAFA` | Correct answers, passed stations |
| **Review / Partial** | `#E8A520` | `#FDF3DC` | Needs improvement, partial marks |
| **Fail / Incorrect** | `#E11D48` | `#FFE4EC` | Missed items, failed stations |
| **Neutral / Info** | `#6B6478` | `#F8F6FB` | Labels, timestamps, hints |

> Always use the surface hex as the background and the full color for the left-border accent on feedback blocks.

---

### Neutrals — Warm Gray

| Shade | Hex | Usage |
|---|---|---|
| Warm 950 | `#1A1520` | Primary body text |
| Warm 800 | `#3A3340` | Secondary headings |
| Warm 600 | `#6B6478` | Muted labels, captions |
| Warm 400 | `#9B94A8` | Placeholder text, disabled labels |
| Warm 200 | `#C8C2D4` | Input borders, dividers |
| Warm 100 | `#E8E4F0` | Card borders, table lines |
| Warm 50 | `#F8F6FB` | App background (light mode) |

> Use warm (purple-tinted) grays throughout — not cold neutral grays.

---

### Dark Mode

| Element | Light | Dark |
|---|---|---|
| App background | `#FAFAF9` | `#0F0520` |
| Card surface | `#FFFFFF` | `#1E0A38` |
| Card border | `#E8E4F0` | `#2D1152` |
| Primary text | `#1A1520` | `#F5F1FB` |
| Muted text | `#6B6478` | `#A882D6` |
| Input background | `#FFFFFF` | `#2D1152` |
| Input border | `#C8C2D4` | `#3E1A6E` |

---

## 2. Typography

### Font Stack

| Role | Font | Fallback |
|---|---|---|
| **Display / Headings** | Lora | Georgia, serif |
| **Body / UI** | DM Sans | system-ui, sans-serif |

**Google Fonts import:**
```
https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@300;400;500;600&display=swap
```

---

### Type Scale

| Style | Font | Size | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|---|
| Display H1 | Lora | 36px | 600 | 1.15 | -0.01em |
| H2 | Lora | 26px | 600 | 1.25 | 0 |
| H3 | DM Sans | 18px | 600 | 1.35 | 0 |
| H4 | DM Sans | 15px | 600 | 1.4 | 0 |
| Body | DM Sans | 15px | 400 | 1.7 | 0 |
| Body Small | DM Sans | 13px | 400 | 1.6 | 0 |
| Label | DM Sans | 11px | 600 | 1.2 | 0.10em (uppercase always) |
| Caption | DM Sans | 12px | 400 | 1.5 | 0.01em |

**Rules:**
- Lora is for H1 and H2 only. H3 and below use DM Sans.
- Max font weight is 600 (SemiBold). Never use 700+.
- Italic Lora is permitted for brand taglines and pull quotes only.
- Minimum font size: 11px.

---

## 3. Logo Usage

### Approved Color Combinations

| Background | Logo Color |
|---|---|
| White / Light `#FAFAF9` | Purple `#1E0A38` |
| Dark purple `#1E0A38` | White `#FFFFFF` |
| Purple tint `#F5F1FB` | Purple 700 `#2D1152` |

> Never render the logo in amber, teal, red, or gray. Only white or Purple 800.

---

### Minimum Sizes

| Variant | Minimum (Digital) |
|---|---|
| Combination mark (owl + wordmark) | 120px wide |
| Icon only | 32px wide |

### Clear Space
Maintain clear space equal to **half the height of the owl icon** on all four sides. No text or graphic elements should enter this zone.

### Don'ts
- Do not stretch or distort in any dimension
- Do not add drop shadows, glows, or outer strokes
- Do not place on busy or photographic backgrounds
- Do not rotate or flip
- Do not export below @2x resolution

---

## 4. Developer Tokens

### CSS Custom Properties

```css
:root {
  /* PRIMARY — Owl Purple */
  --color-primary-50:  #F5F1FB;
  --color-primary-100: #E8DCF5;
  --color-primary-200: #CDBAE8;
  --color-primary-300: #A882D6;
  --color-primary-400: #7B4DB8;
  --color-primary-500: #5A2E9A;
  --color-primary-600: #3E1A6E;
  --color-primary-700: #2D1152;
  --color-primary-800: #1E0A38;  /* ← BRAND PRIMARY */
  --color-primary-900: #0F0520;

  /* ACCENT — Wisdom Amber */
  --color-accent-100: #FDF3DC;
  --color-accent-400: #F0BC50;
  --color-accent-500: #E8A520;   /* ← BRAND ACCENT */
  --color-accent-600: #C47A0A;

  /* SEMANTIC */
  --color-success:         #0D9488;
  --color-success-surface: #F0FAFA;
  --color-warning:         #E8A520;
  --color-warning-surface: #FDF3DC;
  --color-error:           #E11D48;
  --color-error-surface:   #FFE4EC;

  /* NEUTRALS */
  --color-neutral-950: #1A1520;
  --color-neutral-800: #3A3340;
  --color-neutral-600: #6B6478;
  --color-neutral-400: #9B94A8;
  --color-neutral-200: #C8C2D4;
  --color-neutral-100: #E8E4F0;
  --color-neutral-50:  #F8F6FB;

  /* ALIASES */
  --color-text-primary:   #1A1520;
  --color-text-secondary: #6B6478;
  --color-text-muted:     #9B94A8;
  --color-text-on-dark:   #F5F1FB;
  --color-text-link:      #5A2E9A;

  --color-bg-app:         #FAFAF9;
  --color-bg-card:        #FFFFFF;
  --color-bg-card-tinted: #F5F1FB;
  --color-bg-dark:        #1E0A38;

  --color-border-default: #E8E4F0;
  --color-border-strong:  #C8C2D4;
  --color-border-focus:   #5A2E9A;

  /* TYPOGRAPHY */
  --font-display: 'Lora', Georgia, serif;
  --font-body:    'DM Sans', system-ui, sans-serif;
  --font-mono:    'Courier New', Courier, monospace;

  /* SPACING (8pt grid) */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;

  /* BORDER RADIUS */
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   16px;
  --radius-xl:   24px;
  --radius-full: 9999px;

  /* SHADOWS (purple-tinted) */
  --shadow-raised: 0 2px 8px rgba(30, 10, 56, 0.08);
  --shadow-float:  0 8px 24px rgba(30, 10, 56, 0.14);
  --shadow-focus:  0 0 0 3px rgba(90, 46, 154, 0.20);
}

/* DARK MODE */
@media (prefers-color-scheme: dark) {
  :root {
    --color-text-primary:   #F5F1FB;
    --color-text-secondary: #A882D6;
    --color-text-muted:     #7B4DB8;

    --color-bg-app:         #0F0520;
    --color-bg-card:        #1E0A38;
    --color-bg-card-tinted: #2D1152;

    --color-border-default: #2D1152;
    --color-border-strong:  #3E1A6E;
  }
}
```

---

### React Native / Expo

```typescript
// theme.ts
export const colors = {
  primary: {
    50:  '#F5F1FB',
    100: '#E8DCF5',
    200: '#CDBAE8',
    300: '#A882D6',
    400: '#7B4DB8',
    500: '#5A2E9A',
    600: '#3E1A6E',
    700: '#2D1152',
    800: '#1E0A38', // brand primary
    900: '#0F0520',
  },
  accent: {
    100: '#FDF3DC',
    400: '#F0BC50',
    500: '#E8A520', // brand accent
    600: '#C47A0A',
  },
  semantic: {
    success:        '#0D9488',
    successSurface: '#F0FAFA',
    warning:        '#E8A520',
    warningSurface: '#FDF3DC',
    error:          '#E11D48',
    errorSurface:   '#FFE4EC',
  },
  neutral: {
    950: '#1A1520',
    800: '#3A3340',
    600: '#6B6478',
    400: '#9B94A8',
    200: '#C8C2D4',
    100: '#E8E4F0',
    50:  '#F8F6FB',
  },
} as const;

export const typography = {
  fontDisplay:       'Lora_600SemiBold',
  fontDisplayItalic: 'Lora_400Regular_Italic',
  fontBody:          'DMSans_400Regular',
  fontBodyMedium:    'DMSans_500Medium',
  fontBodySemiBold:  'DMSans_600SemiBold',
} as const;

export const spacing = {
  1: 4,  2: 8,  3: 12, 4: 16,
  5: 20, 6: 24, 8: 32, 10: 40, 12: 48,
} as const;

export const radius = {
  sm: 6, md: 10, lg: 16, xl: 24, full: 9999,
} as const;

export const shadow = {
  raised: {
    shadowColor: '#1E0A38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  float: {
    shadowColor: '#1E0A38',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
} as const;
```

---

### Tailwind Config

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#F5F1FB',
          100: '#E8DCF5',
          500: '#5A2E9A',
          700: '#2D1152',
          800: '#1E0A38',
          900: '#0F0520',
        },
        accent: {
          100: '#FDF3DC',
          500: '#E8A520',
          600: '#C47A0A',
        },
      },
      fontFamily: {
        display: ['Lora', 'Georgia', 'serif'],
        body:    ['DM Sans', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '6px', md: '10px', lg: '16px', xl: '24px',
      },
    },
  },
}
```

---

*Socrates AI Brand Guidelines — Internal use only.*
