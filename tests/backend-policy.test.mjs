import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, isDuplicate, mergeAssessment, raisePriority, transition } from '../dist/src/policy/maintenance.js';
const normal = { assetId: 'P-101', category: 'mechanical-leak', observations: 'Synthetic report.', facts: { equipment:'operating', leak:'none', fireOrSmoke:'no', personnelHazard:'no', vibration:'normal', temperature:'normal' } };
for (const [fact,value,priority] of [['personnelHazard','yes','CRITICAL'],['fireOrSmoke','yes','CRITICAL'],['leak','significant','CRITICAL'],['equipment','unavailable','HIGH'],['vibration','severe','HIGH'],['temperature','severe','HIGH'],['vibration','abnormal','MEDIUM'],['leak','minor','LOW']]) {
  test(`explicit ${fact} ${value} derives ${priority}`,()=> assert.equal(assess({...normal,facts:{...normal.facts,[fact]:value}}).priority,priority));
}
test('unknown safety facts retain known urgency and block dispatch',()=>{
  const assessment=assess({...normal,facts:{...normal.facts,personnelHazard:'yes',fireOrSmoke:'unknown'}});
  assert.equal(assessment.kind,'manual-review'); assert.equal(assessment.knownPriority,'CRITICAL'); assert.deepEqual(assessment.missing,['fireOrSmoke']);
});
test('unclassified reports cannot derive a skill',()=>assert.equal(assess({...normal,category:'unclassified'}).kind,'manual-review'));
test('manual holds remain after enrichment and urgency cannot fall',()=>{
  const held=assess({...normal,facts:{...normal.facts,equipment:'unknown',personnelHazard:'yes'}});
  const result=mergeAssessment(held,assess(normal));
  assert.equal(result.kind,'manual-review'); assert.equal(result.knownPriority,'CRITICAL'); assert.equal(raisePriority('HIGH','LOW'),'HIGH');
});
test('only unresolved asset and category matches are duplicates',()=>{
  for (const lifecycle of ['NEW','VALIDATED','PRIORITIZED','ASSIGNED','ACKNOWLEDGED','IN_PROGRESS']) assert.equal(isDuplicate(normal,{...normal,lifecycle}),true);
  for (const lifecycle of ['RESOLVED','CLOSED']) assert.equal(isDuplicate(normal,{...normal,lifecycle}),false);
  assert.equal(isDuplicate(normal,{...normal,assetId:'C-201',lifecycle:'ASSIGNED'}),false);
});
test('lifecycle prevents skipping and supports acknowledgement replay',()=>{
  assert.deepEqual(transition('ASSIGNED','start'),{kind:'invalid'});
  assert.deepEqual(transition('ACKNOWLEDGED','acknowledge'),{kind:'allowed',next:'ACKNOWLEDGED'});
  assert.deepEqual(transition('IN_PROGRESS','resolve'),{kind:'allowed',next:'RESOLVED'});
  assert.deepEqual(transition('CLOSED','resolve'),{kind:'invalid'});
});

test('operating equipment with degraded performance derives medium priority',()=>assert.equal(assess({...normal,category:'performance-degradation'}).priority,'MEDIUM'));
