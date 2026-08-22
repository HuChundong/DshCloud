/**
 * This deployment's own mark and name, browser half.
 *
 * The shell ships `@deepseek-ai/dsh-client-ui-brand-official`, which fills
 * three slots — `sidebar.brand.mark`, `sidebar.brand.name` and
 * `conversation.hero.brand.mark` — with DeepSeek's whale and wordmark. That is
 * correct for the official build and wrong for this one: this deployment is not
 * DeepSeek's, and "DeepSeek Harness" is DeepSeek's registered trademark, which
 * their brand guidelines ask projects not to wear as their own. The upstream
 * package says the same thing from the other side — "alternative presentation
 * belongs in another Cordis package occupying the same slots" — and this is
 * that package.
 *
 * It goes exactly as far as the slots do. The name in the tab, the mark in the
 * sidebar, the mark over an empty conversation: the three places a person reads
 * as "whose product is this". Nothing inside the agent changes — no prompt, no
 * tool, no model request — because none of that is brand and all of it is
 * upstream's to name.
 *
 * Where DSH is genuinely being referred to, it is still called DSH: the
 * deployment's own pages say what harness they run, and this file does not
 * touch anything that says so.
 *
 * Written against the module loader the shell installs rather than built from
 * the workspace, like every client half in this repository: `require` here is
 * the shell's own module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-brand',
  factory: (require) => {
    const React = require('react')

    /** What this plugin's own rules are scoped to; nothing else uses it. */
    const CLASS = 'dsh-brand'

    /**
     * What this deployment is called, in two parts.
     *
     * `Hamster` is the word and `HQ` is the mark on it, reversed out of an ink
     * block — the same treatment the sign-in page and the front door give it.
     * Monochrome, like the hamster beside it and for the same reason: this
     * brand has two colours, ink and the surface, and `docs/brand.md` names
     * them. They turn over together with the theme.
     */
    const NAME = 'Hamster'
    const MARK_TEXT = 'HQ'

    /** The mark's two colours, from `docs/brand.md`. */
    const INK = '#101113'
    const PAPER = '#F4F4F2'

    /**
     * The mark, served by nginx from the deployment's own root.
     *
     * An `img` rather than an inlined SVG: it is the same theme-aware,
     * single-colour line mark the sign-in page and the landing page use, and
     * one copy served from one place is what keeps the three from drifting
     * apart.
     */
    const MARK = '/brand/hamster.svg'

    /** The tab icon, replacing the whale the published `index.html` links. */
    const FAVICON = '/brand/favicon.svg'

    /**
     * What the shell calls itself in the tab, which is the trademark this
     * deployment must not present as its own. Matched as a substring so that a
     * title carrying a session name keeps it.
     */
    const UPSTREAM = 'DeepSeek Harness'

    /**
     * The mark, inside the box its host surface asks for.
     *
     * `size` is a box, not a height. The shell reserves a square — its own
     * `FishLogo` is a 50x50 viewBox rendered at `size` both ways — and this
     * artwork is not square: the hamster's viewBox is 1200x746, so a mark set
     * to `size` tall and `auto` wide came out half again as wide as the space
     * kept for it. Nothing clips while the sidebar is open, so it read as
     * merely large; collapsed to the rail, the rail is the box, and the far
     * side of the hamster was cut off.
     *
     * So both axes are the box and `object-fit: contain` fits the artwork
     * inside it, which preserves the aspect ratio rather than squashing it.
     * A wide mark in a square box is shorter than a square one — that is what
     * fitting means, and it is the trade for occupying exactly the room the
     * layout has.
     *
     * @param {{size?: number, className?: string}} props - the host's requested presentation.
     * @returns {object} the mark.
     */
    /**
     * The deployment's own neutrals, in place of the shell's.
     *
     * The shell's greys lean blue — every step of its ramp has more blue in it
     * than red, by two parts at the light end and fifteen in the middle. The
     * front door's do not: its paper is a warm off-white, and the two surfaces
     * sitting side by side did not look like one product.
     *
     * What is changed is TEMPERATURE and nothing else. Each step keeps the
     * luminance it had — computed, not eyeballed — so every contrast ratio in
     * the interface is the one upstream chose, and only the cast is different.
     * Three are pinned rather than converted, and they are the ones the eye
     * actually lands on. The front door's mock-up of this window is layered —
     * the window is `#fbfbfa`, its sidebar `#f4f4f2`, and only the composer is
     * paper white — while the shell paints its base and all three layers from
     * the lightest step, so in light mode it has no layers and they are all
     * pure white. Converting that step by luminance kept it white, which is
     * exactly the difference that was still visible: the application read as
     * white where the front door reads as off-white.
     *
     * So the lightest step takes the window's colour, and step 50 takes the
     * sidebar's — 50 because that is what `--dsw-specific-sidebar-fill`
     * resolves to, which is the only way to know: the sidebar is drawn by its
     * own plugin, and the token it paints with is neither of the two the shell
     * itself uses. Guessing at `bg-module-platform` by its name left the
     * sidebar a shade off the window instead of a shade under it.
     *
     * That step is also the dark mode's text colour, and it wants the same
     * value for a different reason: `#f4f4f2` is the warm white
     * `docs/brand.md` sets the mark in on dark surfaces.
     *
     * The darkest step is the brand's ink, which is what the front door sets
     * its text in.
     *
     * The ramp is what is overridden, not the seventy-eight aliases built on
     * it: those are `var()` references, so they follow. The accent and the
     * state colours are not neutrals and are left exactly alone — a running
     * sandbox is the same green it was.
     *
     * `html body` because the shell defines this on `body`, and a plugin that
     * loads first would otherwise be overwritten by the one that owns it.
     */
    const PALETTE_CSS = `
      html body {
        --dsw-static-neutral-bluish-00: #fbfbfa;
        --dsw-static-neutral-bluish-50: #f4f4f2;
        --dsw-static-neutral-bluish-60: #f8f6f4;
        --dsw-static-neutral-bluish-75: #f5f3f1;
        --dsw-static-neutral-bluish-100: #f0eeec;
        --dsw-static-neutral-bluish-150: #eeecea;
        --dsw-static-neutral-bluish-200: #e7e5e3;
        --dsw-static-neutral-bluish-300: #d4d2d0;
        --dsw-static-neutral-bluish-400: #b2b1b0;
        --dsw-static-neutral-bluish-500: #9d9c9b;
        --dsw-static-neutral-bluish-600: #868584;
        --dsw-static-neutral-bluish-700: #656565;
        --dsw-static-neutral-bluish-750: #454545;
        --dsw-static-neutral-bluish-800: #363636;
        --dsw-static-neutral-bluish-850: #2c2c2c;
        --dsw-static-neutral-bluish-875: #232323;
        --dsw-static-neutral-bluish-900: #1b1b1b;
        --dsw-static-neutral-bluish-950: #151515;
        --dsw-static-neutral-bluish-1000: #101113;
      }

      /* The composer, which has to be paper.

         It fills with --dsw-specific-input-major, and that resolves to the
         lightest step of the ramp — which is now the window's own off-white, so
         the box the tenant types into became the same colour as the thing it
         sits on and stopped having an edge. The front door has the same
         layering and answers it the same way: its window is off-white and its
         composer is white. */
      html body { --dsw-specific-input-major: #ffffff; }

      /* No blue.

         The shell's action colour is DeepSeek's — a filled button, an accent
         label, the highlight on a message. The front door's is ink: its send
         button is near-black on light and near-white on dark, and its only
         strong colour is the green a running sandbox wears. Two products'
         worth of accent in one window is what made this look unresolved.

         The fills and the accents therefore take the mark's own two colours,
         and turn over with the theme exactly as the mark does. The TINTS —
         bubbles, the active nav row — take neutral steps from the ramp above
         rather than ink, because they are grounds and not marks: ink at 6% is
         a grey, and inventing one here when the ramp already has one is how
         two greys end up next to each other. */
      html body {
        --dsw-alias-button-info-fill: #101113;
        --dsw-alias-button-info-hover: #2a2c2f;
        --dsw-alias-state-business-primary: #101113;
        --dsw-alias-brand-primary-new-colorprimary-new-color: #101113;
        --dsw-alias-label-primary-bluish: #101113;
        --dsw-alias-state-business-tertiary: var(--dsw-static-neutral-bluish-100);
        --dsw-specific-bubble: var(--dsw-static-neutral-bluish-60);
        --dsw-specific-bubble-highlight: var(--dsw-static-neutral-bluish-100);
        --dsw-specific-sidebar-nav-item-active-accent: var(--dsw-static-neutral-bluish-100);
      }
      html body[data-ds-dark-theme] {
        --dsw-alias-button-info-fill: #f4f4f2;
        --dsw-alias-button-info-hover: #e4e4e2;
        --dsw-alias-state-business-primary: #f4f4f2;
        --dsw-alias-brand-primary-new-colorprimary-new-color: #f4f4f2;
        --dsw-alias-label-primary-bluish: #f4f4f2;
        --dsw-alias-state-business-tertiary: var(--dsw-static-neutral-bluish-800);
        --dsw-specific-bubble: var(--dsw-static-neutral-bluish-850);
        --dsw-specific-bubble-highlight: var(--dsw-static-neutral-bluish-800);
        --dsw-specific-sidebar-nav-item-active-accent: var(--dsw-static-neutral-bluish-800);
      }

      /* The send button's glyph, which the fills above broke.

         Upstream draws that button as \`background: var(--dsw-alias-button-info-fill)\`
         with \`color: rgb(255, 255, 255)\` — a literal, not a token, and a
         correct one for the fill it was written against: DeepSeek's blue is
         dark in both schemes, so a white glyph always read. The fills above
         make that fill the mark's own ink, which is near-black on light and
         near-WHITE on dark — so in the dark theme the button became #f4f4f2
         with a #ffffff glyph, and the arrow disappeared into it.

         It is a token here rather than a second literal, and it is stated for
         both schemes rather than only for the dark one: the pair is
         "whatever contrasts with the primary fill", which is #fbfbfa on light
         and #0f1115 on dark, and that is exactly the flip the fill makes. One
         rule then follows the theme the way the fill does, and there is no
         second copy of white to keep true.

         The hook is the composer's published slot plus upstream's own local
         class name. Class names are content hashes — \`uV2eYG_primary\` — and
         the hash half changes between builds while the local half does not, so
         the substring is the stable part of it. Written to fail by doing
         nothing: it sets a colour and nothing else, so a build that renames
         the class leaves the button exactly as upstream draws it, and the
         worst an over-match can reach is the stop button that replaces this
         one mid-stream — which has the same fill and needs the same glyph. */
      html body [data-slot='conversation.composer.bar'] button[class*='_primary'] {
        color: var(--dsw-alias-label-primary-foreground);
      }
    `

    /**
     * The rule that decides which way the mark is drawn.
     *
     * The mark is one ink-black line drawing embedded as an img, so it
     * inherits no colour, and an img-embedded SVG resolves
     * prefers-color-scheme against the SYSTEM rather than against the shell it
     * sits in — a shell switched to dark on a light system showed a black mark
     * on a black ground. The shell says which way it is being read with
     * data-ds-dark-theme on the body, so that is what this asks.
     *
     * Injected once, from a plugin that otherwise mounts no styles at all: a
     * filter is not something an inline style can make conditional.
     */
    const MARK_CSS = `
      img[src="${MARK}"] { filter: none; }
      body[data-ds-dark-theme] img[src="${MARK}"] { filter: invert(1); }

      /* Reversed out of an ink block, and sized in em units so it tracks
         whatever the sidebar sets the word at.

         A line-height of 1 is what keeps it tight. Inherited, the box is as
         tall as a line of text rather than as tall as the letters, and the chip
         stands off the word by a leading it has no use for. */
      .${CLASS}-hq {
        display: inline-block;
        padding: .1em .2em;
        line-height: 1;
        border-radius: .2em;
        background: ${INK};
        color: ${PAPER};
        /* A lockup rather than running text: the word's negative tracking would
           pull these two letters into each other. */
        letter-spacing: 0;
      }
      /* Over, on a dark ground: the same two colours, the other way round. */
      body[data-ds-dark-theme] .${CLASS}-hq {
        background: ${PAPER};
        color: ${INK};
      }
    `

    function BrandMark({ size, className }) {
      const box = `${size ?? 20}px`
      return React.createElement('img', {
        src: MARK,
        alt: '',
        className,
        // `block` kills the inline-baseline gap that would otherwise push the
        // mark a pixel or two below the wordmark beside it.
        style: { width: box, height: box, objectFit: 'contain', display: 'block' },
      })
    }

    /**
     * The name, set in the shell's own type rather than in artwork.
     *
     * The official occupant renders a wordmark image; this renders text,
     * because a name in text inherits the sidebar's font, weight and colour in
     * both themes and needs no second asset to keep in step with them.
     *
     * @returns {object} the wordmark.
     */
    function BrandName() {
      return React.createElement(
        'span',
        {
          className: `${CLASS}-word`,
          style: {
            fontSize: '15px', fontWeight: 600, letterSpacing: '-0.02em', whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'baseline', gap: '.18em',
          },
        },
        NAME,
        React.createElement('span', { className: `${CLASS}-hq` }, MARK_TEXT),
      )
    }

    return {
      inject: ['slots'],

      /**
       * Fill the three brand slots, and the two things that are not slots.
       *
       * @param {object} ctx - the client root context.
       */
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-brand-style', '')
          style.textContent = `${PALETTE_CSS}\n${MARK_CSS}`
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'brand: the palette, and a mark that reads on both grounds')

        // One declaration-aware registration set, nested the way the shipped
        // package nests it: the rows may activate in either order relative to
        // the sidebar and conversation declarers, and a partial brand — our
        // name beside their whale — must not be a state this can be caught in.
        ctx.effect(
          () => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.inject('conversation.hero.brand.mark', function* () {
            // `priority: -1` so this occupies the seat even where the shipped
            // brand row is still mounted: priority is the shadowing rank and
            // the lowest renders. The composition disables that row as well,
            // and this does not depend on it having been disabled.
            yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, BrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, BrandName)
            yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -1 }, BrandMark)
          }))),
          'brand: this deployment’s mark and name in the shipped brand slots',
        )

        // The tab, which is not a slot: upstream selects the title at build
        // time from `DSH_CLIENT_TITLE` and the icon from a `<link>` in the
        // published `index.html`, so neither can be occupied and both are set
        // here instead.
        //
        // The icon is set once, because nothing rewrites it. The title is
        // watched, because something does: setting it on apply held for as long
        // as it took the shell to name the current session, and then the old
        // name came back. So this substitutes rather than assigns — whatever
        // the shell puts in the tab keeps its session name and loses the
        // trademark — and it watches the element rather than polling.
        ctx.effect(() => {
          const link = document.querySelector('link[rel~="icon"]')
          const icon = link?.getAttribute('href')
          if (link !== null) link.setAttribute('href', FAVICON)

          const title = document.querySelector('title')
          const original = document.title

          /** Rewrite the tab, if what is in it names the harness. */
          const rebrand = () => {
            const rebranded = document.title.split(UPSTREAM).join(NAME)
            // Guarded, or the write below is itself a mutation and this
            // observes its own work forever. After one pass the name is gone,
            // so the second pass is a no-op and the loop ends either way — but
            // ending it here costs nothing and says so.
            if (rebranded !== document.title) document.title = rebranded
          }
          rebrand()

          const watch = title === null ? undefined : new MutationObserver(rebrand)
          watch?.observe(title, { childList: true, characterData: true, subtree: true })

          // Put both back if this row is ever withdrawn, which is what an
          // effect promises and what HMR relies on.
          return () => {
            watch?.disconnect()
            document.title = original
            if (link !== null && icon !== null && icon !== undefined) link.setAttribute('href', icon)
          }
        }, 'brand: the tab’s name and icon')
      },
    }
  },
})
