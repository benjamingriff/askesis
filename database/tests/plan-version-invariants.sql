-- Run only against the disposable test database. All changes roll back.
BEGIN;
DO $$
DECLARE athlete uuid := gen_random_uuid(); plan uuid := gen_random_uuid();
    version uuid := gen_random_uuid(); goal uuid := gen_random_uuid();
BEGIN
    INSERT INTO athletes(id, display_name) VALUES (athlete, 'Invariant test');
    INSERT INTO plans(id, owner_id, display_name, current_draft_version_id)
        VALUES (plan, athlete, 'Invariant test', version);
    INSERT INTO plan_versions(id, plan_id, start_date, end_date)
        VALUES (version, plan, '2026-09-01', '2026-09-30');
    INSERT INTO plan_briefs(id, plan_version_id, goal_text)
        VALUES (goal, version, 'Run consistently');
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    BEGIN
        INSERT INTO plan_versions(plan_id) VALUES (plan);
        RAISE EXCEPTION 'Second draft unexpectedly succeeded';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    BEGIN
        UPDATE plans SET activated_at = now() WHERE id = plan;
        RAISE EXCEPTION 'Draft-only activation unexpectedly succeeded';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE plans SET archived_at = now() WHERE id = plan;
    BEGIN
        UPDATE plan_briefs SET goal_text = 'forbidden' WHERE id = goal;
        RAISE EXCEPTION 'Archived draft edit unexpectedly succeeded';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE plans SET archived_at = NULL WHERE id = plan;
    UPDATE plan_versions SET state = 'locked', version_number = 1,
        content_hash = repeat('a', 64), content_hash_version = 1,
        validator_version = 1, validation_findings = '[]',
        acknowledged_warning_codes = '{}', change_summary = '{}', locked_at = now()
        WHERE id = version;
    UPDATE plans SET current_draft_version_id = NULL, current_locked_version_id = version
        WHERE id = plan;
    SET CONSTRAINTS ALL IMMEDIATE;
    BEGIN
        UPDATE plan_briefs SET goal_text = 'forbidden' WHERE id = goal;
        RAISE EXCEPTION 'Locked child update unexpectedly succeeded';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        DELETE FROM plan_briefs WHERE id = goal;
        RAISE EXCEPTION 'Locked child deletion unexpectedly succeeded';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        INSERT INTO plan_briefs(plan_version_id, goal_text) VALUES (version, 'Other goal');
        RAISE EXCEPTION 'Locked child insertion unexpectedly succeeded';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        UPDATE plan_versions SET description = 'forbidden' WHERE id = version;
        RAISE EXCEPTION 'Locked version update unexpectedly succeeded';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE plans SET display_name = 'Renamed', activated_at = now() WHERE id = plan;
    UPDATE plans SET activated_at = NULL, archived_at = now() WHERE id = plan;
    BEGIN
        UPDATE plans SET display_name = 'forbidden' WHERE id = plan;
        RAISE EXCEPTION 'Archived rename unexpectedly succeeded';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE plans SET archived_at = NULL WHERE id = plan;
    RAISE NOTICE 'Plan creation, promotion, locked-child guards and archive guards passed';
END $$;
ROLLBACK;
