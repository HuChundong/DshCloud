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

    /** What this deployment is called, in the one place the sidebar shows it. */
    const NAME = 'HamsterHQ'

    /**
     * The mark, served by nginx from the deployment's own root.
     *
     * An `img` rather than an inlined SVG: the file is 29 KB of path data for a
     * glyph drawn at twenty pixels, it is the same file the sign-in page and
     * the landing page use, and one copy served from one place is what keeps
     * the three from drifting apart.
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
     * The mark, at whatever size its host surface asks for.
     *
     * `width: auto` because the artwork is wider than it is tall — a hamster
     * standing, not a disc — and the slot's `size` is a height. Forcing it
     * square would letterbox it into a fifth of the space.
     *
     * @param {{size?: number, className?: string}} props - the host's requested presentation.
     * @returns {object} the mark.
     */
    function BrandMark({ size, className }) {
      return React.createElement('img', {
        src: MARK,
        alt: '',
        className,
        // `block` kills the inline-baseline gap that would otherwise push the
        // mark a pixel or two below the wordmark beside it.
        style: { height: `${size ?? 20}px`, width: 'auto', display: 'block' },
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
      return React.createElement('span', {
        style: { fontSize: '15px', fontWeight: 600, letterSpacing: '-0.02em', whiteSpace: 'nowrap' },
      }, NAME)
    }

    return {
      inject: ['slots'],

      /**
       * Fill the three brand slots, and the two things that are not slots.
       *
       * @param {object} ctx - the client root context.
       */
      apply(ctx) {
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
