# Local browser verification — 15 October 2026

Verified the real Vite/API/PostgreSQL application at port 5825 with the dedicated Clerk verification account and the twelve-week cycling example (5 October–27 December). The plan remained locked at version 2 throughout logging.

- Quick Done, optional RPE and reload persistence.
- Edit through Training log history; change actual time to 35 minutes, reload and confirm it persists.
- Change an existing log to Skipped; confirm effort/actuals are removed, then clear the entry and recreate it.
- Session-specific strength questions, weights and RPE saved on Today.
- Interval feedback with RPE 8, faded repetitions, tiredness, poor sleep and a note saved and sent to the plan conversation; typed feedback card and completed reply appeared.
- Phone viewport (390 × 1000): feedback controls, scrolling and save actions; run-down check-in, duration/preference/return style saved and sent to the same conversation.

Screenshots: [Today](desktop-today.png), [feedback on phone](phone-feedback.png), [coaching reference](desktop-coaching.png), [check-in on phone](phone-check-in.png), [edited history after reload](desktop-history.png). Data and notes shown are synthetic demonstration entries.

The local environment uses simulated coaching. This verifies persisted messages/references and the complete UI interaction, rather than live model amendment quality. Disposable PostgreSQL integration tests exercise current/changed/cleared references through the real worker contract, restore/relock history, owner isolation and archive guards. A component test verifies result preview/attach does not record calibration until the separate confirmation and update action.

The first browser conversation attempt exposed a PostgreSQL JSON-array serialization error. The insert now serializes the validated reference array as JSON text; the interaction and worker integration test passed after the fix.
