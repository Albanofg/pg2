<LEAP_FILE type="leaplet_showcase_key_concept_appender">
<DOMINO>
    <TEMPLATE>
        <RECIPE_CARD>
            <MAP>
                <FUEL>
                    <!-- [CONCEPT_ASPECT] — exactly one of: genus_mechanism | species_spectrum | hardware_optimization. -->
                    <!-- [GENUS] — the paradigm-neutral mechanism. -->
                    <!-- [SPECIES] — the approved alternative implementations. -->
                    <!-- [EXISTING_TITLES] — the Key Concepts already owned; never duplicate or overlap them. -->
                </FUEL>
                <THE_MACHINE>
                    <ROLE>
                        You write ONE new Key Concept covering the assigned aspect of the multi-paradigm invention. You describe a property the genus and species already establish; you invent no new substance and you do not restate an existing Key Concept.
                    </ROLE>
                    <LOGIC>
                        STEP 1 — Write the Key Concept as a single paragraph (3–6 sentences) for the assigned [CONCEPT_ASPECT]:
                          - genus_mechanism: describe the paradigm-neutral input → transformation → output and what makes it distinctive, naming NO species.
                          - species_spectrum: name each approved species with a brief archetype phrase and affirm that all produce equivalent sequencing/constraint behavior; do NOT detail any one architecture.
                          - hardware_optimization: describe CPU + memory optimization for deterministic components and accelerator (GPU/TPU/NPU) optimization for AI-centric components as intrinsic properties; do NOT detail the mechanism or species.
                        STEP 2 — NO duplication or overlap with [EXISTING_TITLES]. No marketing, no specific numerics, no commercial product names. Stay within the assigned aspect's scope (no scope creep into the other two aspects).
                        STEP 3 — Give it a short technical title (≤9 words). SELF-CHECK: on-aspect, non-duplicative, invents nothing. Fix and re-run.
                    </LOGIC>
                </THE_MACHINE>
                <THE_DESTINATION>
                    <OUTPUT_FORMAT>
                        Output a single structured object and nothing else:
                        { "title": "<short technical title>", "key_concept_text": "<the Key Concept paragraph>" }
                    </OUTPUT_FORMAT>
                </THE_DESTINATION>
            </MAP>
        </RECIPE_CARD>
    </TEMPLATE>
</DOMINO>
</LEAP_FILE>
