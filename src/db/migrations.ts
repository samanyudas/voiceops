import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { PgMigrator } from "@effect/sql-pg";

const schema = `
CREATE TABLE assets (id text PRIMARY KEY, name text NOT NULL, type text NOT NULL);
CREATE TABLE maintenance_history (asset_id text NOT NULL REFERENCES assets(id), at timestamptz NOT NULL, note text NOT NULL);
CREATE TABLE technicians (id text PRIMARY KEY);
CREATE TABLE technician_skills (technician_id text NOT NULL REFERENCES technicians(id), skill text NOT NULL CHECK (skill IN ('mechanical','rotating-equipment','electrical','instrumentation')), PRIMARY KEY (technician_id,skill));
CREATE TABLE work_orders (id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), category text NOT NULL, assessment jsonb NOT NULL, priority text CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')), priority_rank int, required_skill text, lifecycle text NOT NULL CHECK (lifecycle IN ('NEW','VALIDATED','PRIORITIZED','ASSIGNED','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED')), dispatch_status text NOT NULL CHECK (dispatch_status IN ('HELD','QUEUED','ASSIGNED','COMPLETED')), escalation_required boolean NOT NULL DEFAULT false, report_count int NOT NULL CHECK (report_count > 0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_report_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK ((dispatch_status = 'HELD') OR (priority IS NOT NULL AND required_skill IS NOT NULL)), CONSTRAINT correct_priority_rank CHECK (priority_rank IS NOT DISTINCT FROM CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END));
CREATE INDEX work_order_duplicates ON work_orders(asset_id,category) WHERE lifecycle NOT IN ('RESOLVED','CLOSED');
CREATE INDEX dispatch_queue ON work_orders(priority_rank,created_at,id) WHERE dispatch_status='QUEUED';
CREATE TABLE drafts (id text PRIMARY KEY, report jsonb NOT NULL, assessment jsonb NOT NULL, expires_at timestamptz NOT NULL, decision_key text, result jsonb, CHECK ((decision_key IS NULL) = (result IS NULL)));
CREATE TABLE reports (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, work_order_id text NOT NULL REFERENCES work_orders(id), report jsonb NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE assignments (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, work_order_id text NOT NULL REFERENCES work_orders(id), technician_id text NOT NULL REFERENCES technicians(id), allocated_at timestamptz NOT NULL DEFAULT clock_timestamp(), released_at timestamptz, CHECK (released_at IS NULL OR released_at >= allocated_at));
CREATE UNIQUE INDEX one_active_job_per_technician ON assignments(technician_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX one_active_technician_per_job ON assignments(work_order_id) WHERE released_at IS NULL;
CREATE TABLE events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, work_order_id text NOT NULL REFERENCES work_orders(id), action text NOT NULL, reason text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE action_receipts (request_id text PRIMARY KEY, fingerprint text NOT NULL, result jsonb NOT NULL);
CREATE FUNCTION protect_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'History is append-only'; END $$;
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION protect_immutable_history();
CREATE TRIGGER reports_append_only BEFORE UPDATE OR DELETE ON reports FOR EACH ROW EXECUTE FUNCTION protect_immutable_history();
`;
const statements = [
  ...schema.slice(0, schema.indexOf("CREATE FUNCTION")).split(";").map(s => s.trim()).filter(Boolean),
  schema.slice(schema.indexOf("CREATE FUNCTION"), schema.indexOf("CREATE TRIGGER")),
  ...schema.slice(schema.indexOf("CREATE TRIGGER")).split(";").map(s => s.trim()).filter(Boolean)
];
export const migrations = PgMigrator.layer({ loader: PgMigrator.fromRecord({ "0001_initial": Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) yield* sql.unsafe(statement);
}) }) });
