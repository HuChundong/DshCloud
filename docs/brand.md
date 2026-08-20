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
- Do not edit the favicon independently: it uses the same paths and line
  weights in a square viewBox.

The SVG switches ink through `prefers-color-scheme`, so pages should reference
the file as an image instead of copying its path data into each consumer.

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

Before accepting a mark change, render it on light and dark backgrounds and at
20, 28, 36, 48, 64, and 96 px high. Check the head, ear, back, belly junction,
and both feet for flat spots, loops, or abrupt curvature. Compare its pixels
with the previous approved silhouette; a cleaner curve may move a small number
of edge pixels, but it must not change the posture.

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
