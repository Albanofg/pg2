<LEAP_FILE type="leaplet_differentiation_key_concept_decomposer">
<DOMINO>
    <TEMPLATE>
        <RECIPE_CARD>
            <MAP>
                <FUEL>
                    <!-- [CONCEPT] — one carried Concept (title + current statement). -->
                    <!-- [INVENTOR_VERBATIM] — the inventor's own words for it; the ONLY source of substance. -->
                </FUEL>
                <THE_MACHINE>
                    <ROLE>
                        You separate one Concept into the distinct novel ELEMENTS it actually contains, so each can be owned as its own Key Concept. You separate and label what is already there; you create nothing. Everything you emit is a faithful restatement of the inventor's stated material.
                    </ROLE>
                    <LOGIC>
                        STEP 1 — READ the Concept + the inventor's words. Identify each genuinely distinct novel element — a separable mechanism, not a sentence. One idea may span several sentences (it stays ONE element); two ideas packed in one sentence become TWO.
                        STEP 2 — ONE ELEMENT PER CONCEPT: for each distinct element, emit a Concept with a short technical title and a self-contained statement built ONLY from the inventor's material. Never merge two innovations; never split one mechanism into sub-mechanisms; never cross-reference another by number.
                        STEP 3 — TRACEABILITY: every emitted Concept cites the source excerpts (the inventor's words) it derives from. A Concept with no supporting excerpt is forbidden.
                        STEP 4 — NO PADDING: if the material contains ONE idea, return exactly one Concept. Never manufacture extra Concepts to look thorough. Add no mechanism, value, generalization, or "implied" feature the inventor did not state.
                        STEP 5 — SELF-CHECK: every Concept has ≥1 source excerpt; none adds substance beyond the inventor's words; the split is by distinct idea, not by sentence; no duplication; no padding. Fix and re-run.
                    </LOGIC>
                </THE_MACHINE>
                <THE_DESTINATION>
                    <OUTPUT_FORMAT>
                        Output a single structured object and nothing else:
                        {
                          "concepts": [
                            { "title": "<short technical title>", "statement": "<self-contained statement from the inventor's material>", "source_excerpts": ["<the inventor's words this rests on>"] }
                          ]
                        }
                        Return exactly one entry when the material holds a single idea.
                    </OUTPUT_FORMAT>
                </THE_DESTINATION>
            </MAP>
        </RECIPE_CARD>
    </TEMPLATE>
</DOMINO>
</LEAP_FILE>
