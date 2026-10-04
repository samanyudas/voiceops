import { Effect, Schema } from "effect";
import { Report, Assessment } from "../domain/models.js";
import { PgClient } from "@effect/sql-pg";
export const seed = Effect.gen(function*() {
  const sql = yield* PgClient.PgClient;
  yield* sql.withTransaction(Effect.gen(function*() {
    yield* sql`SELECT pg_advisory_xact_lock(71190324)`;
    yield* sql`INSERT INTO assets(id,name,type) VALUES ('P-101','Fictional transfer pump','pump'),('C-201','Fictional process compressor','compressor'),('V-301','Fictional separator','separator') ON CONFLICT DO NOTHING`;
    yield* sql`INSERT INTO technicians(id) VALUES ('Tech-01'),('Tech-02'),('Tech-03') ON CONFLICT DO NOTHING`;
    yield* sql`INSERT INTO technician_skills(technician_id,skill) VALUES ('Tech-01','mechanical'),('Tech-01','rotating-equipment'),('Tech-02','electrical'),('Tech-03','mechanical'),('Tech-03','instrumentation') ON CONFLICT DO NOTHING`;
    const exists = yield* sql`SELECT 1 FROM maintenance_history LIMIT 1`;
    if (exists.length === 0) yield* sql`INSERT INTO maintenance_history(asset_id,at,note) VALUES ('P-101',clock_timestamp()-interval '2 days','Synthetic seal inspection. No diagnosis is implied.'),('C-201',clock_timestamp()-interval '1 day','Synthetic vibration report.'),('V-301',clock_timestamp()-interval '3 days','Synthetic instrument calibration.')`;
  }));
});

export const seedDemo = Effect.gen(function*() {
  yield* seed;
  const sql = yield* PgClient.PgClient;
  yield* sql.withTransaction(Effect.gen(function*() {
    yield* sql`SELECT pg_advisory_xact_lock(71190324)`;
    const fixtures = [
      { id: 'demo-busy-rotating', assetId: 'C-201', category: 'abnormal-vibration', technician: 'Tech-01', skill: 'rotating-equipment', priority: 'HIGH', rank: 1 },
      { id: 'demo-busy-mechanical', assetId: 'P-101', category: 'mechanical-leak', technician: 'Tech-03', skill: 'mechanical', priority: 'HIGH', rank: 1 }
    ];
    for (const fixture of fixtures) {
      const existing = yield* sql`SELECT id FROM work_orders WHERE id=${fixture.id}`;
      if (existing.length > 0) continue;
      const report = yield* Schema.decodeUnknownEffect(Report)({ assetId: fixture.assetId, category: fixture.category, observations: 'Synthetic demonstration job already in progress.', facts: { equipment:'unavailable', leak:'none', fireOrSmoke:'no', personnelHazard:'no', vibration:'normal', temperature:'normal' } });
      const assessment = yield* Schema.decodeUnknownEffect(Assessment)({ kind:'eligible',priority:fixture.priority,requiredSkill:fixture.skill,reasons:['Synthetic unavailable-equipment fixture.'] });
      yield* sql`INSERT INTO work_orders(id,asset_id,category,assessment,priority,priority_rank,required_skill,lifecycle,dispatch_status,report_count) VALUES (${fixture.id},${fixture.assetId},${fixture.category},${sql.json(assessment)},${fixture.priority},${fixture.rank},${fixture.skill},'IN_PROGRESS','ASSIGNED',1)`;
      yield* sql`INSERT INTO reports(work_order_id,report) VALUES (${fixture.id},${sql.json(report)})`;
      yield* sql`INSERT INTO assignments(work_order_id,technician_id) VALUES (${fixture.id},${fixture.technician})`;
      yield* sql`INSERT INTO events(work_order_id,action,reason) VALUES (${fixture.id},'SEEDED_IN_PROGRESS','Synthetic fixture starts with occupied capacity. This is not an operational state transition.')`;
    }
  }));
});
