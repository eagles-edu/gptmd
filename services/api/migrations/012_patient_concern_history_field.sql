-- New sessions pin schema version 3, which adds the cue-gated patientConcern
-- history field. Existing immutable scenarios keep their stored version.
UPDATE app_sessions
SET schema_version = 3
WHERE status = 'initializing' AND schema_version < 3;
