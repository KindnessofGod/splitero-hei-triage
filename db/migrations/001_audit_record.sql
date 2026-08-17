-- The audit store. Append-only, enforced by the database rather than by the
-- application choosing not to issue an UPDATE.
--
-- Design rationale: docs/design/PHASE1A_AUDIT_RETROFIT.md §2.1

CREATE TABLE audit_record (
  record_id        uuid        PRIMARY KEY,
  correlation_id   text        NOT NULL,   -- = case id, threaded through everything
  run_id           uuid        NOT NULL,   -- one pass through the pipeline
  parent_record_id uuid        REFERENCES audit_record (record_id),
  sequence         bigint      NOT NULL,   -- monotonic per correlation_id; replay orders by this
  record_kind      text        NOT NULL
    CHECK (record_kind IN ('STEP','RULE_EVALUATION','MODEL_CALL','HUMAN_ACTION',
                           'STATE_MUTATION','VERDICT','CORRECTION')),
  step_name        text        NOT NULL,
  step_version     text        NOT NULL,
  actor_type       text        NOT NULL CHECK (actor_type IN ('SYSTEM','HUMAN','MODEL')),
  actor_id         text        NOT NULL,
  occurred_at      timestamptz NOT NULL,
  duration_ms      integer,
  outcome          text        NOT NULL CHECK (outcome IN ('OK','FAIL','SKIPPED','ERROR')),
  input_digest     bytea       NOT NULL,
  output_digest    bytea,
  payload          jsonb       NOT NULL,
  idempotency_key  text,
  attempt          smallint    NOT NULL DEFAULT 1,
  supersedes       uuid        REFERENCES audit_record (record_id),

  CONSTRAINT audit_sequence_unique UNIQUE (correlation_id, sequence)
);

CREATE INDEX audit_by_case      ON audit_record (correlation_id, sequence);
CREATE INDEX audit_by_run       ON audit_record (run_id, sequence);
CREATE INDEX audit_by_kind      ON audit_record (record_kind, occurred_at DESC);
CREATE INDEX audit_payload_gin  ON audit_record USING gin (payload jsonb_path_ops);

-- Append-only. A correction is a new row with `supersedes` set, never an edit.
-- Two independent mechanisms, because a superuser bypasses grants but not rules.
CREATE RULE audit_record_no_update AS ON UPDATE TO audit_record DO INSTEAD NOTHING;
CREATE RULE audit_record_no_delete AS ON DELETE TO audit_record DO INSTEAD NOTHING;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_record FROM PUBLIC;

COMMENT ON TABLE audit_record IS
  'Append-only decision trace. One record per step, including steps that changed '
  'nothing and rules that passed. Corrections supersede, never overwrite.';
COMMENT ON COLUMN audit_record.sequence IS
  'Replay orders by this, not by occurred_at: timestamps collide and clocks move.';
