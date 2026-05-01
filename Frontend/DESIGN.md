# Design System Document

## 1. Overview & Creative North Star: "The Editorial Guardian"

This design system is engineered to transform the complex, often stressful world of mortgage services into a high-end, editorial experience. We are moving away from the "calculator-heavy" utility look of traditional fintech. Our Creative North Star is **"The Editorial Guardian"**—a visual language that feels as authoritative as a heritage broadsheet but as fluid and modern as a luxury digital atelier.

To achieve this, the design system rejects the rigid, boxed-in constraints of standard web grids. We embrace **intentional asymmetry**, where high-end imagery overlaps translucent containers, and **dynamic whitespace** to create a sense of "breathing room" found in premium physical publications. By leveraging glassmorphism and deep tonal layering, we ensure the user feels they are being guided by an expert, not just using a tool.

---

## 2. Colors & Surface Philosophy

The palette is anchored in heritage and prestige. We utilize deep navy and muted blues to establish institutional trust, while Champagne Gold acts as a "light-source" accent, drawing the eye to key conversion points.

### The "No-Line" Rule
Standard 1px solid borders are strictly prohibited for sectioning. Structural definition must be achieved through:
1.  **Background Color Shifts:** Use a `surface-container-low` section sitting against a `background` or `surface` base.
2.  **Tonal Transitions:** Define boundaries by moving from a `primary` background to a `primary-container` background.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of fine materials. 
- **Base Layer:** `surface` (#f8f9fa)
- **Primary Content Blocks:** `surface-container-low` (#f3f4f5)
- **Nested Interactive Elements:** `surface-container-highest` (#e1e3e4)
This creates "natural" depth without relying on artificial outlines.

### The "Glass & Gradient" Rule
To elevate the "AskJuthis" experience, use **Glassmorphism** for floating cards and navigation bars. Use `surface_variant` at 60% opacity with a `backdrop-blur` of 20px. 
- **Signature Gradient:** For Hero backgrounds and Primary CTAs, use a subtle linear gradient from `primary` (#000309) to `primary_container` (#0f1e2e) at a 135-degree angle. This adds a "silk" texture that flat colors lack.

---

## 3. Typography: The Voice of Authority

The system employs a high-contrast typographic scale to create an editorial rhythm.

*   **Display & Headlines (Manrope):** We use Manrope for its architectural clarity. Use `display-lg` (3.5rem) with tight letter-spacing (-0.02em) for hero statements. This font carries the "Editorial" weight.
*   **Body & UI (Inter):** Inter provides maximum legibility for complex mortgage data. 
*   **The Hierarchy Intent:** Large `headline-lg` titles should be paired with generous `body-lg` leading (1.6x) to ensure the content feels curated rather than crowded.

---

## 4. Elevation & Depth

We eschew traditional "Drop Shadows" in favor of **Tonal Layering** and **Ambient Glows.**

*   **The Layering Principle:** Place a `surface-container-lowest` card on a `surface-container-low` background. The shift in hex value provides enough contrast for the eye to perceive a "lift" without visual noise.
*   **Ambient Shadows:** When a floating element (like a mortgage calculator modal) is required, use a shadow with a 40px blur and 4% opacity, tinted with `primary` (#000309) to mimic natural light passing through dark glass.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility, use `outline_variant` at **15% opacity**. Never use 100% opaque lines.
*   **Glassmorphism Depth:** Elements using glassmorphism should have a `1px` inner-stroke using `outline_variant` at 20% opacity to simulate the edge of a glass pane.

---

## 5. Components

### Buttons
*   **Primary:** A gradient-fill (Primary to Primary-Container) with `secondary_fixed` (#f9e194) text. Radius: `md` (0.375rem).
*   **Secondary:** Glass-morphic background with a `Ghost Border`.
*   **Tertiary:** All-caps `label-md` with 2px letter spacing and a `secondary` underline that expands on hover.

### Cards & Lists
*   **The Rule of Space:** Forbid all horizontal divider lines. Separate list items using the `spacing-6` (2rem) scale.
*   **Mortgage Product Cards:** Use `surface-container-lowest` with a `lg` corner radius. The top-right corner should remain "sharp" (0px radius) to create an intentional, asymmetric editorial look.

### Input Fields
*   **Styling:** Minimalist. No background fill; only a bottom "Ghost Border" using `outline_variant`.
*   **Focus State:** The bottom border transitions to `secondary` (Champagne Gold), and the label floats upward using `label-sm`.

### High-End Specialized Components
*   **The "Progressive Disclosure" Accordion:** Instead of a chevron, use a "+" icon that rotates 45 degrees. The expanded area should use a `surface-container-low` background to "cradle" the information.
*   **The Mortgage Glass-Slider:** A custom range-slider where the track is a semi-transparent `primary-container` and the handle is a polished `secondary_fixed_dim` circle.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical margins (e.g., 8.5rem on the left, 4rem on the right) for hero sections to create a "magazine" feel.
*   **Do** use high-quality architectural or lifestyle photography with a 10% `primary` color overlay to unify the imagery with the brand.
*   **Do** leverage the `spacing-20` (7rem) scale between major sections to emphasize luxury and ease.

### Don’t
*   **Don't** use 1px solid black or high-contrast borders. It breaks the "glass and paper" illusion.
*   **Don't** crowd the screen with multiple CTAs. Every page should have one "Golden Path" using the Champagne Gold accent.
*   **Don't** use standard "Success Green" or "Warning Orange" at full saturation. Mute them or use iconography to maintain the premium tonal balance.