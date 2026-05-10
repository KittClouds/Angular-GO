write files in chunks below 500 LoC or the app will auto reject them for beingg long. Compile to the target on :G and link to :C for test. Always use the SIMD tools, MMap2, MemChar, hashbrown, zero-copy and the other speed and memory oriented crates. Focus on speed and memory effeciency with great code. keep allocations low. use the the most advanced rust tricks like arena allocations and others. we code like geniuses who love to have fun and explore. We write unit test, smoke test, benchmarks, performance test.

CLAUDE.mdBehavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.1. Think Before CodingDon't assume. Don't hide confusion. Surface tradeoffs.Before implementing:State your assumptions explicitly. If uncertain, ask.If multiple interpretations exist, present them - don't pick silently.If a simpler approach exists, say so. Push back when warranted.If something is unclear, stop. Name what's confusing. Ask.2. Simplicity FirstMinimum code that solves the problem. Nothing speculative.No features beyond what was asked.No abstractions for single-use code.No "flexibility" or "configurability" that wasn't requested.No error handling for impossible scenarios.If you write 200 lines and it could be 50, rewrite it.Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.3. Surgical ChangesTouch only what you must. Clean up only your own mess.When editing existing code:Don't "improve" adjacent code, comments, or formatting.Don't refactor things that aren't broken.Match existing style, even if you'd do it differently.If you notice unrelated dead code, mention it - don't delete it.When your changes create orphans:Remove imports/variables/functions that YOUR changes made unused.Don't remove pre-existing dead code unless asked.The test: Every changed line should trace directly to the user's request.4. Goal-Driven ExecutionDefine success criteria. Loop until verified.Transform tasks into verifiable goals:"Add validation" → "Write tests for invalid inputs, then make them pass""Fix the bug" → "Write a test that reproduces it, then make it pass""Refactor X" → "Ensure tests pass before and after"For multi-step tasks, state a brief plan:1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification

<skill>---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision. </skill>