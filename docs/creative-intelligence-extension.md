# Cove Creative Intelligence extension contract

The engine is intentionally configuration-driven. Adding a future vertical should not copy the generator.

1. Add the vertical identifier to `CreativeVertical` and define its initial core/adjacent/experimental prior.
2. Add its Meta targeting profile through the existing targeting builder. Financial Products, validation, conversion, and readback protections stay shared.
3. Add approved carrier/product rows to `MetaProductCapability`. Unknown eligibility must remain `null`; never infer carrier facts.
4. Register claim patterns and capability requirements. An aggressive claim needs current approval evidence and a matching product capability before launch.
5. Add researched macro families to `families.ts`, including market evidence, class, compatible layouts, copy grammar, visual directions, selector type, and disclosures.
6. Reuse compatible layouts from `layouts.ts`; add a layout only when its feed-visible hierarchy is genuinely new.
7. Add the funnel template and selector handling. The creative and funnel must share the exact `SelectorContract`.
8. Add native-language copy as authored copy, not a word-for-word translation layer.
9. Add approved assets through `MetaCreativeAsset`; record source/license/approval and let global use counts influence selection.
10. Add the vertical to the combination, claim, visual-render, capacity, and attribution tests before enabling it.

Historical family IDs and launched render metadata are immutable inputs. New taxonomy may classify old records as active, legacy, deprioritized, migrated, or historical-only, but it must never rewrite launched ads or attribution history.
