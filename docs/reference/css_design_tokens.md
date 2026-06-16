# CSS Design Tokens

All design tokens (colors, spacing, shadows, border-radii, typography, and transitions) are defined as CSS custom properties in:
[variables.css](../../frontend/src/styles/variables.css)

Every component-level CSS file inherits these custom properties.

---

## Token Usage Standard
Never hardcode a color, spacing value, or font stack in component CSS files. Always reference the corresponding CSS custom variable.

```css
/* Correct — use the variable */
color: var(--color-primary);

/* Incorrect — hardcoded value */
color: #063F1E;
```

---

## Brand Colors

| Variable | Value | Description |
|----------|-------|-------------|
| `--color-primary` | `#063F1E` | Deep Forest Green |
| `--color-primary-light` | `#0b622f` | Light variant of primary |
| `--color-primary-dark` | `#032512` | Dark variant of primary |
| `--color-gold` | `#D89F01` | Heritage Gold (accent color) |
| `--color-gold-dark` | `#b58501` | Dark variant of gold accent |
| `--color-cream` | `#F9F8F6` | Cream background / neutral light |

---

## Typography

* **Heading Font (`--font-heading`)**: Libre Baskerville (serif) — used for page titles and major section headers.
* **Body & UI Label Font (`--font-body` / `--font-subheading`)**: Montserrat (sans-serif) — used for body copy, buttons, forms, and tables.
* **Decorative Font (`--font-decorative`)**: Dancing Script (cursive) — used sparingly for quotes or minor accent labels.

---

## Semantic Feedback Colors
Use these variables to display alert states, form validation, and feedback messages.

* **Success (`--color-success`)**: `#10B981` (Green)
* **Warning (`--color-warning`)**: `#F59E0B` (Amber)
* **Error (`--color-error`)**: `#EF4444` (Red)
* **Info (`--color-info`)**: `#3B82F6` (Blue)

---

## Dashboard Chart & Badge Accents
Shades used in charts and status pills:
* `--accent-budget`
* `--accent-spent`
* `--accent-remaining`
* `--accent-percent`
* `--accent-approved`
* `--accent-needs-changes`

---

## Neutral Palette

| Variable | Value | Description |
|----------|-------|-------------|
| `--color-white` | `#FFFFFF` | Backgrounds, text on dark elements |
| `--color-cream` | `#F9F8F6` | Page backgrounds, section dividers |
| `--color-gray-200` | `#E3E3E3` | Form input borders, soft rules |
| `--color-gray-500` | `#6B7280` | Subtext, icons, disabled states |
| `--color-black` | `#222222` | Main text color |

---

## Animation & Transitions

* **Fast Transition (`--transition-fast`)**: `0.15s ease`
* **Base Transition (`--transition-base`)**: `0.2s ease`
* **Slow Transition (`--transition-slow`)**: `0.3s ease`
