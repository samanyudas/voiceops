import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
async function command(path,args,env) {
  const child=spawn(process.execPath,[path,...args],{env:{...process.env,...env}});
  let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();});child.stderr.on('data',chunk=>{output+=chunk.toString();});
  const [code]=await once(child,'exit');return {code,output};
}
test('invalid startup configuration never logs capability or database credentials',async()=>{
  const result=await command('dist/tools/server.js',[],{DATABASE_URL:'postgres://user:SENTINEL_DATABASE_SECRET@127.0.0.1/voiceops',TOOL_API_KEY:'SENTINEL_OPERATOR_SECRET',TECHNICIAN_API_KEY:'bad'});
  assert.notEqual(result.code,0);assert.match(result.output,/Backend startup failed/);assert.doesNotMatch(result.output,/SENTINEL_DATABASE_SECRET|SENTINEL_OPERATOR_SECRET/);
});
test('technician CLI refuses redirects without sending its capability to the target',async()=>{
  let targetCalls=0;
  const target=createServer((request,response)=>{targetCalls++;response.end('{}');});
  const redirect=createServer((request,response)=>{const address=target.address();response.writeHead(302,{location:`http://127.0.0.1:${address.port}/target`});response.end();});
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));
  try {const address=redirect.address();const result=await command('dist/tools/technician.js',['state'],{VOICEOPS_URL:`http://127.0.0.1:${address.port}`,TECHNICIAN_API_KEY:'synthetic-test-credential'});assert.notEqual(result.code,0);assert.equal(targetCalls,0);} finally {await new Promise(resolve=>redirect.close(resolve));await new Promise(resolve=>target.close(resolve));}
});
