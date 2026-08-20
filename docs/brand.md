# HamsterHQ brand and mascot

English | [中文](brand.zh.md)

This is the source of truth for HamsterHQ's hamster. It keeps the product mark,
account avatar, ecosystem banner, and task illustrations recognisably related
without forcing one asset to serve every job.

## Canonical character

The character is a compact side-profile hamster with a rounded back, short
snout, one circular eye, a looped ear, and two grounded feet. The lower belly is
a distinct light area rather than an extra contour drawn through a solid body.
Its posture must remain physically plausible when a prop or action changes.

Keep these identifiers in every variant:

- no exercise wheel, long tail, prominent incisors, or mouse-like pointed face;
- the ear stays attached to the crown and opens toward the back;
- the chest flows into the front foot, and the rear haunch carries the rear
  foot rather than leaving either foot as a floating stroke;
- the belly remains visibly separate from the upper coat;
- props support the action and never replace the face, belly, or grounded
  silhouette.

The geometry in [`../gateway/assets/hamster.svg`](../gateway/assets/hamster.svg)
is authoritative for the neutral side profile.

## Primary mark

`gateway/assets/hamster.svg` is the transparent, single-colour product mark.
Its outer and inner contours are curvature-continuous cubic Bézier splines. The
interior, including the belly, is transparent; one rounded arc identifies the
belly, and the eye is a solid circle.

- Light surfaces: ink black `#101113`.
- Dark surfaces: warm white `#F4F4F2`.
- Native aspect ratio: `1200:746` (about `1.61:1`). Do not stretch it.
- Use the full mark at 20 px high or larger. At smaller square sizes, use
  `gateway/assets/favicon.svg`.
- Leave the background transparent. Do not add a body fill, gradient, shadow,
  enclosure, or a second outline colour.
- The source contours stay identical at every size. Up to 40 px high (or 64 px
  wide), the full mark adds a 16-unit optical stroke and raises the belly arc
  from 24 to 38 units so thin features survive rasterisation.
- The favicon uses the same paths in a square viewBox, with a stronger compact
  correction: a 40-unit optical stroke and a 56-unit belly arc up to 64 px.

Keep the SVG as the single source of geometry. Pages should reference the file
as an image instead of copying its path data into each consumer.

## Wordmark

The name is two parts and is set as two parts: **Hamster** is the word, and
**HQ** is the mark on it — reversed out of a rounded ink block.

Monochrome, like the mark above and in the same two colours: ink black
`#101113` and warm white `#F4F4F2`. The pair turns over together, so the chip is
ink on a light surface and warm white on a dark one. No third colour enters the
lockup, and the accent green belongs to product state — a running sandbox — and
not to the name.

Three rules make it one shape wherever it is set:

- it is sized in `em`, so the sign-in page at 1.5rem and the sidebar at 15px are
  the same lockup rather than two designs;
- the chip carries `letter-spacing: 0`, because the negative tracking the word
  is set with pulls `H` and `Q` into each other;
- the chip carries `line-height: 1`. Inherited, its box is as tall as a LINE of
  text rather than as tall as the letters, and it stands off the word above and
  below by a leading it has no use for.

It is defined once per surface and shared: `WORDMARK` and `BRAND_CSS` in
`gateway/src/page-chrome.js` for the pages that the gateway renders, `.word-hq`
in `web/landing/styles.css` for the front door, and `BrandName` in
`packages/dsh-brand/client.js` for the application shell — which cannot use the
tokens, since they are this deployment's, so it carries the two colours itself
and turns them over on `body[data-ds-dark-theme]`.

## The application's neutrals

The shell ships a blue-leaning grey ramp — every step has more blue in it than
red, by two parts at the light end and fifteen in the middle. The front door
does not: its paper is a warm off-white. Side by side the two read as two
products, so `packages/dsh-brand/client.js` replaces the ramp with a warm one.

What changes is temperature and nothing else. Each step keeps the luminance it
had, computed rather than judged, so every contrast ratio in the interface is
the one upstream chose — sampled pairs move by less than a hundredth. Three steps are pinned instead of converted, and they are the ones the eye
lands on. The front door's mock-up of this window is layered — the window is
`#fbfbfa`, its sidebar `#f4f4f2`, and only the composer is paper white — while
the shell paints its base and all three layers from the lightest step, so in
light mode it has no layers and they are all pure white. Converting that step by
luminance kept it white, which is the difference that remained visible: the
application read as white where the front door reads as off-white. The lightest
step therefore takes the window's colour, and step 50 takes the sidebar's — 50
because that is what `--dsw-specific-sidebar-fill` resolves to, which is the
only way to know it: the sidebar is drawn by its own plugin and paints with a
token neither of the two the shell itself uses. That step is also the dark
mode's text colour, and it wants the same value for a second reason: `#f4f4f2`
is the warm white this document sets the mark in on dark surfaces. The darkest is the brand's ink `#101113`, which is what the front
door sets its text in.

The ramp is overridden, not the seventy-eight aliases built on it: those are
`var()` references and follow by themselves. The accent and the state colours
are not neutrals and are untouched — a running sandbox is the same green.

## Filled mascot and scenes

Filled artwork is a separate illustration family, not a rasterisation of the
line mark. Use a warm paper field, off-white and pale warm-grey fur, slate-blue
outlines, and green as the only strong accent. Shapes stay flat and softly
rounded, with restrained texture and shadow. Avoid neon colour, glossy 3D,
photorealism, glass panels, or dense interface chrome.

- `web/landing/avatar.webp` is the 128 px account avatar. Its tight crop and
  green field are intentional; do not substitute the wide line mark.
- `docs/assets/dshcloud-banner.webp` shows several hamsters in separate habitat
  cells around a shared gateway. The cells represent isolated sandboxes; the
  scene should read as an ecosystem, not a cage or exercise-wheel scene.
- `web/landing/images/work-build.webp` pairs hamsters with a simplified laptop
  and device outputs for building a product.
- `web/landing/images/work-research.webp` uses a magnifier, notes, and source
  material for research.
- `web/landing/images/work-data.webp` turns loose tiles into an ordered table
  and export for data work.
- `web/landing/images/work-scripts.webp` connects a scheduled input, processing
  step, run control, and result chart for automation.
- `web/landing/images/work-repo.webp` maps folders through connected burrows for
  repository reading and navigation.

Computers and tools use simplified silhouettes. Screens do not need decorative
code or illegible text; the hamster's action should explain the capability.

## Creating another pose

Start from the canonical anatomy, then change the weight distribution before
adding a prop. Sitting, standing, reading, coding, or wearing sunglasses may
move the paws and spine, but the feet still support the body and the belly still
belongs to the torso. Keep one clear action per image and use the fewest lines
that communicate it.

For a family or grid of poses:

1. keep eye, ear, outline weight, belly treatment, and palette constant;
2. vary the silhouette and prop rather than changing the character's species;
3. keep props secondary and simplify small details at logo scale;
4. compare every result with the canonical SVG and at least one approved filled
   scene before accepting it.

## Asset map

| Role | File | Format and canvas |
| --- | --- | --- |
| Product mark | `gateway/assets/hamster.svg` | SVG, `1200 x 746` viewBox |
| Browser icon | `gateway/assets/favicon.svg` | SVG, square viewBox |
| Account avatar | `web/landing/avatar.webp` | WebP, `128 x 128` |
| Repository banner | `docs/assets/dshcloud-banner.webp` | WebP, `2172 x 724` |
| Landing capability scenes | `web/landing/images/work-*.webp` | WebP, 1280 px wide |

Keep source assets at these stable paths. Vite fingerprints copies during the
landing build; generated files under `dist/` are not the editing source.

## Review checklist

Before accepting a mark change, render it on light and dark backgrounds. Check
the favicon at 16 and 32 px square and the full mark at 20, 24, 28, 36, 48, 64,
and 96 px high. Check the head, ear, back, belly junction, and both feet for flat
spots, loops, or abrupt curvature. Compare its pixels with the previous approved
silhouette; a cleaner curve may move a small number of edge pixels, but it must
not change the posture.

Run the repository checks that cover these assets and their documentation:

```sh
xmllint --noout gateway/assets/hamster.svg gateway/assets/favicon.svg
node scripts/check-landing.mjs
node scripts/check-docs.mjs
npx oxlint packages/dsh-brand/client.js
npm --prefix web/landing run build
git diff --check
```

Update this page and [the Chinese version](brand.zh.md) together whenever the
anatomy, palette, asset roles, or review process changes.
