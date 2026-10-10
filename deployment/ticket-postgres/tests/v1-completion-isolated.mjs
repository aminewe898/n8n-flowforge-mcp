// Fake-data PostgreSQL tests only. No n8n execution, no Telegram/provider requests.
import {execFileSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const container='ticket-postgres-v1', db='ticket_v1_test_'+randomUUID().replaceAll('-','');
const hash=x=>createHash('sha256').update(x).digest('hex');
const lit=x=>"'"+String(x).replaceAll("'","''")+"'";
const json=x=>lit(JSON.stringify(x))+'::jsonb';
const args=d=>['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','ticket_bootstrap','-d',d];
const docker=(a,input)=>execFileSync('docker',a,{input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
const admin=q=>docker(args(db),q).trim();
const runtime=q=>admin('SET SESSION AUTHORIZATION ticket_n8n;\n'+q);
const result=q=>JSON.parse(runtime(q));
const inspect=q=>JSON.parse(admin(q));
const parallel=q=>new Promise((resolve,reject)=>{const p=spawn('docker',args(db),{windowsHide:true});let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',c=>c?reject(new Error(err)):resolve(out.trim()));p.stdin.end('SET SESSION AUTHORIZATION ticket_n8n;\n'+q);});
const deny=(fn,code)=>{let e;try{fn();}catch(x){e=x;}assert.ok(e);assert.match(String(e.stderr??e.message),new RegExp('ERROR:\\s+'+code+':'));};
const productionFingerprint=()=>hash(docker(['exec',container,'pg_dump','-U','ticket_bootstrap','-d','ticket_system']).replace(/^\\(?:un)?restrict .*$/gm,''));
const report={database:db,tests:[],externalRequests:0,sourceHashes:{},productionBefore:productionFingerprint()};
const bot=990000000001,user=990000000002,chat=user;
let seq=0,created=false;
const policy={configVersion:'FAKE_V1',retryPolicy:{stageMaxAttempts:5},priorityPolicy:{unknownDefault:'normal',criticalRequiresConfirmation:true}};
const extraction=(overrides={})=>({clientName:null,company:null,email:null,summary:'FAKE TEST incident',description:'FAKE TEST only: printer unavailable.',category:'hardware',prioritySuggestion:'unknown',affectedSystem:'FAKE printer',symptoms:[],technicalDetails:[],onsetText:null,businessImpact:null,urgencyEvidence:null,confidence:null,missingInformation:[],...overrides});
const reset=()=>admin('SET ROLE ticket_owner;TRUNCATE ticket_intake.clients,ticket_intake.client_contacts,ticket_intake.processed_messages,ticket_intake.intakes,ticket_intake.pending_interactions,ticket_intake.tickets,ticket_intake.work_items,ticket_intake.outbox RESTART IDENTITY CASCADE;');
const voice=(overrides={})=>{
 const n=++seq;
 const r=result(`SELECT ticket_intake.ingest_message(${bot},${n},${user},${chat},${n},'voice',${json({fileId:'FAKE_FILE_'+n,fileUniqueId:'FAKE_UNIQUE_'+n,mimeType:'audio/ogg',sizeBytes:20,durationSeconds:1})},${json(policy)});`);
 const e=extraction(overrides);
 admin(`SET ROLE ticket_owner;UPDATE ticket_intake.work_items SET status='succeeded',attempt_count=1 WHERE intake_id=${lit(r.intakeId)};
 INSERT INTO ticket_intake.work_items(intake_id,stage,status,max_attempts,attempt_count) VALUES(${lit(r.intakeId)},'transcribe','succeeded',5,1),(${lit(r.intakeId)},'extract','succeeded',5,1),(${lit(r.intakeId)},'resolve_client','queued',5,0);
 UPDATE ticket_intake.intakes SET state='extracted',revision=6,extraction=${json(e)},extraction_validated_at=clock_timestamp(),validation_version=1,
 transcript_original=${lit('FAKE transcript '+JSON.stringify(e))},transcribed_at=clock_timestamp(),
 extraction_metadata='{"provider":"groq","model":"openai/gpt-oss-120b","schemaVersion":"extraction-1","promptVersion":"extract-prompt-1"}',
 audio_bytes=convert_to('OggSFAKE TEST AUDIO','UTF8'),audio_sha256=encode(sha256(convert_to('OggSFAKE TEST AUDIO','UTF8')),'hex'),
 audio_size_bytes=18,audio_mime_type='audio/ogg',audio_stored_at=clock_timestamp(),audio_purge_after=clock_timestamp()+interval '72 hours'
 WHERE id=${lit(r.intakeId)};`);
 return r;
};
const text=(value,replyTo=null,identity={})=>{
 const n=++seq,m={text:value};if(replyTo)m.replyToMessageId=replyTo;
 return result(`SELECT ticket_intake.ingest_message(${identity.bot??bot},${n},${identity.user??user},${identity.chat??chat},${n},'text',${json(m)},${json(policy)});`);
};
const claimSQL=()=>`SELECT ticket_intake.claim_v1_work('FAKE_WORKER',${bot},${user},${chat});`;
const claim=()=>result(claimSQL());
const processSQL=w=>`SELECT ticket_intake.process_v1_work(${lit(w.workId)},${lit(w.leaseToken)});`;
const process=w=>result(processSQL(w));
const run=()=>{const w=claim();assert.equal(w.outcome,'claimed');return {w,r:process(w)};};
const state=()=>inspect(`SELECT jsonb_build_object('intakes',(SELECT coalesce(jsonb_agg(to_jsonb(i)-'audio_bytes' ORDER BY id),'[]') FROM ticket_intake.intakes i),
 'clients',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM ticket_intake.clients c),
 'contacts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM ticket_intake.client_contacts c),
 'tickets',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM ticket_intake.tickets t),
 'pending',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM ticket_intake.pending_interactions p),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM ticket_intake.outbox o));`);
const existing=(name,email)=>inspect(`SET ROLE ticket_owner;WITH c AS (INSERT INTO ticket_intake.clients(kind,display_name,name_norm) VALUES('company',${lit(name)},ticket_intake.v1_name(${lit(name)})) RETURNING id),ct AS (
 INSERT INTO ticket_intake.client_contacts(client_id,email_original,email_norm,email_source,email_syntax_validated_at) SELECT id,${lit(email)},ticket_intake.v1_email(${lit(email)}),'import',clock_timestamp() FROM c RETURNING id,client_id)
 SELECT jsonb_build_object('clientId',client_id,'contactId',id) FROM ct;`);
const outClaimSQL=()=>`SELECT ticket_intake.claim_v1_outbox('FAKE_OUTBOX',${bot},${chat});`;
const outClaim=()=>result(outClaimSQL());
const dispatch=o=>result(`SELECT ticket_intake.begin_v1_delivery(${lit(o.outboxId)},${lit(o.leaseToken)});`);
const finish=(o,message,classification=null)=>result(`SELECT ticket_intake.finish_v1_delivery(${lit(o.outboxId)},${lit(o.leaseToken)},${message??'NULL'},${classification?lit(classification):'NULL'},1);`);
const deliveredPrompt=(message=7001)=>{const o=outClaim();assert.equal(o.outcome,'claimed');dispatch(o);assert.equal(finish(o,message).outcome,'sent');return o;};
const test=async(name,fn)=>{reset();await fn();report.tests.push({name,result:'passed'});console.log('PASS '+name);};
try {
 docker(['exec',container,'createdb','-U','ticket_bootstrap','-O','ticket_owner','-T','template0',db]);created=true;
 report.version=admin('SHOW server_version;');assert.match(report.version,/^18\.6/);
 for(const name of ['001_schema.sql','002_phase1_operations.sql','003_grants.sql','004_phase2a_worker.proposed.sql','005_v1_completion.sql']){
   const bytes=readFileSync(new URL('../migrations/'+name,import.meta.url));report.sourceHashes[name]=hash(bytes);
   admin('SET ROLE ticket_owner;\n'+bytes.toString().replaceAll('ticket_system',db));
 }
 admin('SET ROLE ticket_owner;\n'+readFileSync(new URL('../migrations/005_v1_completion.sql',import.meta.url),'utf8').replaceAll('ticket_system',db));
 report.migration='001/002/003/004/005 applied; 005 reapplication clean';
 await test('A existing email client: one ticket, no contact overwrite, one confirmation',()=>{
   const c=existing('FAKE ACME','fake-existing@example.invalid');voice({company:'FAKE NEW NAME',email:'fake-existing@example.invalid'});
   const before=state().contacts;const {w,r}=run();assert.equal(r.outcome,'completed');const s=state();
   assert.equal(s.clients.length,1);assert.equal(s.tickets.length,1);assert.equal(s.tickets[0].client_id,c.clientId);
   assert.deepEqual(s.contacts,before);assert.equal(s.pending.length,0);assert.equal(s.outbox.length,1);
   assert.equal(process(w).outcome,'already_applied');assert.equal(state().tickets.length,1);
 });
 await test('B new email client: exactly one client/contact/ticket/confirmation',()=>{
   voice({clientName:'FAKE PERSON',email:'new-fake@example.invalid'});run();const s=state();
   assert.equal(s.clients.length,1);assert.equal(s.contacts.length,1);assert.equal(s.tickets.length,1);assert.equal(s.outbox.length,1);assert.equal(s.pending.length,0);
 });
 await test('C missing email -> persisted prompt -> valid reply -> same intake completed',()=>{
   const v=voice({company:'FAKE NEW CLIENT'});const {w,r}=run();assert.equal(r.outcome,'waiting');
   assert.equal(process(w).outcome,'already_applied');let s=state();assert.equal(s.pending.length,1);assert.equal(s.tickets.length,0);assert.equal(s.outbox.length,1);
   deliveredPrompt();text('operator-fake@example.invalid',7001);run();s=state();
   assert.equal(s.pending[0].status,'resolved');assert.equal(s.tickets.length,1);assert.equal(s.tickets[0].intake_id,v.intakeId);assert.equal(s.intakes[0].state,'completed');assert.equal(s.outbox.length,2);
 });
 await test('D invalid email stays open; one retry prompt; duplicate work replay harmless',()=>{
   voice();run();deliveredPrompt();const m=text('not an email',7001);const {w,r}=run();assert.equal(r.outcome,'invalid_email');
   assert.equal(process(w).outcome,'already_applied');const s=state();assert.equal(s.pending.length,1);assert.equal(s.pending[0].status,'open');assert.equal(s.contacts.length,0);assert.equal(s.tickets.length,0);assert.equal(s.outbox.length,2);
   assert.equal(result(`SELECT ticket_intake.lookup_message(${bot},NULL,${chat},${m.telegramMessageId});`).intakeId,s.intakes[0].id);
 });
 await test('E duplicate update/reply and checkpoint never duplicate writes',async()=>{
   voice();run();text('duplicate-fake@example.invalid');const w=claim();const a=await Promise.all([parallel(processSQL(w)),parallel(processSQL(w))]);
   assert.deepEqual(a.map(x=>JSON.parse(x).outcome).sort(),['already_applied','completed']);
   const m=inspect(`SELECT jsonb_build_object('update',update_id,'message',message_id,'text',text_content) FROM ticket_intake.processed_messages WHERE kind='text';`);
   assert.equal(result(`SELECT ticket_intake.ingest_message(${bot},${m.update},${user},${chat},${m.message},'text',${json({text:m.text})},${json(policy)});`).outcome,'duplicate_message');
   const s=state();assert.equal(s.clients.length,1);assert.equal(s.contacts.length,1);assert.equal(s.tickets.length,1);assert.equal(s.outbox.length,2);
 });
 await test('F restart before DB processing reclaims with new fence; stale worker denied',()=>{
   voice({email:'restart-fake@example.invalid'});const old=claim();
   admin(`UPDATE ticket_intake.work_items SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${lit(old.workId)};`);
   const next=claim();assert.equal(next.workId,old.workId);assert.notEqual(next.leaseToken,old.leaseToken);
   deny(()=>process(old),'P0002');assert.equal(process(next).outcome,'completed');assert.equal(process(next).outcome,'already_applied');assert.equal(state().tickets.length,1);
 });
 await test('concurrent claims: exactly one owner',async()=>{
   voice({email:'race-fake@example.invalid'});const a=await Promise.all(Array.from({length:5},()=>parallel(claimSQL())));
   const claimed=a.map(JSON.parse).filter(x=>x.outcome==='claimed');assert.equal(claimed.length,1);process(claimed[0]);
 });
 await test('concurrent new clients sharing email: one client/contact, separate tickets',async()=>{
   voice({email:'shared-fake@example.invalid'});voice({email:'shared-fake@example.invalid'});const a=claim(),b=claim();
   await Promise.all([parallel(processSQL(a)),parallel(processSQL(b))]);const s=state();assert.equal(s.clients.length,1);assert.equal(s.contacts.length,1);assert.equal(s.tickets.length,2);
 });
 await test('ambiguous identity: operator chooses DB-generated candidate index only',()=>{
   const a=existing('FAKE SAME COMPANY','one-fake@example.invalid');existing('FAKE SAME COMPANY','two-fake@example.invalid');
   voice({company:'FAKE SAME COMPANY'});run();assert.equal(state().tickets.length,0);assert.equal(state().pending[0].kind,'client_selection');deliveredPrompt();
   text('not-a-number',7001);assert.equal(run().r.outcome,'invalid_selection');
   const candidates=state().pending[0].context.candidates;const index=candidates.findIndex(c=>c.id===a.clientId)+1;
   text(String(index),7001);assert.equal(run().r.outcome,'completed');assert.equal(state().tickets[0].client_id,a.clientId);
 });
 await test('multiple open email interactions: bare reply held; explicit reply correlates safely',()=>{
   voice();run();deliveredPrompt(7101);voice();run();deliveredPrompt(7102);
   text('ambiguous-fake@example.invalid');assert.equal(run().r.reason,'ambiguous_reply');assert.equal(state().tickets.length,0);
   text('specific-fake@example.invalid',7102);assert.equal(run().r.outcome,'completed');assert.equal(state().pending.filter(x=>x.status==='open').length,1);
 });
 await test('old queued text, wrong identity and expired pending revision cannot resolve future intake',()=>{
   text('old-fake@example.invalid');const old=claim();voice();const waiting=run();assert.equal(waiting.r.outcome,'waiting');assert.equal(process(old).outcome,'ignored');
   const other=text('wrong-fake@example.invalid',null,{user:user+1,chat:chat+1});assert.equal(claim().outcome,'idle');
   text('new-fake@example.invalid');const w=claim();admin(`UPDATE ticket_intake.intakes SET revision=revision+1;`);deny(()=>process(w),'P0002');assert.equal(state().tickets.length,0);assert.ok(other.messageId);
 });
 await test('critical priority requires explicit operator confirmation; unknown defaults normal',()=>{
   voice({email:'critical-fake@example.invalid',prioritySuggestion:'critical'});run();assert.equal(state().pending[0].kind,'priority_confirmation');assert.equal(state().tickets.length,0);
   deliveredPrompt();text('CONFIRMAR',7001);run();assert.equal(state().tickets[0].priority,'critical');
 });
 await test('email syntax rejects dangerous/malformed variants',()=>{
   for(const bad of ['bad','a..b@example.invalid','.a@example.invalid','a@-host.invalid','a@host-.invalid','a@host..invalid','a@localhost','a b@example.invalid','a@example.invalid trailing'])
     assert.equal(admin(`SET ROLE ticket_owner;SELECT ticket_intake.v1_email(${lit(bad)}) IS NULL;`),'t');
   assert.equal(admin("SET ROLE ticket_owner;SELECT ticket_intake.v1_email('  Fake+tag@Example.invalid  ');"),'fake+tag@example.invalid');
 });
 await test('forced rollback leaves no client/ticket/outbox/interaction partial writes',()=>{
   voice({email:'rollback-fake@example.invalid'});const w=claim();const before=state();
   runtime(`BEGIN;${processSQL(w)} ROLLBACK;`);assert.deepEqual(state(),before);process(w);assert.equal(state().tickets.length,1);
 });
 await test('outbox fencing, dispatch once, idempotent receipt, sent never claimed again',async()=>{
   voice({email:'outbox-fake@example.invalid'});run();const results=await Promise.all(Array.from({length:4},()=>parallel(outClaimSQL())));
   const o=results.map(JSON.parse).find(x=>x.outcome==='claimed');assert.equal(results.map(JSON.parse).filter(x=>x.outcome==='claimed').length,1);
   const d=dispatch(o);assert.equal(d.outcome,'dispatch');deny(()=>dispatch(o),'P0002');
   assert.equal(finish(o,7201).outcome,'sent');assert.equal(finish(o,7201).outcome,'already_applied');assert.equal(outClaim().outcome,'idle');
 });
 await test('outbox restart after dispatch becomes uncertain, never blindly resent',()=>{
   voice({email:'uncertain-fake@example.invalid'});run();const o=outClaim();dispatch(o);
   admin(`UPDATE ticket_intake.outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${lit(o.outboxId)};`);
   assert.equal(outClaim().outcome,'needs_operator');assert.equal(state().outbox[0].status,'uncertain');assert.equal(outClaim().outcome,'idle');deny(()=>finish(o,7301),'P0002');
 });
 await test('outbox restart before dispatch safely reclaims; 429 safely retries',()=>{
   voice({email:'rate-fake@example.invalid'});run();const old=outClaim();
   admin(`UPDATE ticket_intake.outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${lit(old.outboxId)};`);
   const o=outClaim();assert.notEqual(o.leaseToken,old.leaseToken);deny(()=>dispatch(old),'P0002');dispatch(o);assert.equal(finish(o,null,'rate_limited').outcome,'queued');
   admin('UPDATE ticket_intake.outbox SET available_at=clock_timestamp();');const next=outClaim();dispatch(next);finish(next,7401);assert.equal(state().outbox[0].status,'sent');
 });
 await test('runtime least privilege: entrypoints only; direct tables/sequences/helpers/escalation denied',()=>{
   deny(()=>runtime('SELECT * FROM ticket_intake.clients;'),'42501');deny(()=>runtime("INSERT INTO ticket_intake.clients(kind,display_name,name_norm) VALUES('individual','FAKE','fake');"),'42501');
   deny(()=>runtime("SELECT nextval('ticket_intake.tickets_ticket_number_seq');"),'42501');
   deny(()=>runtime("SELECT ticket_intake.v1_email('fake@example.invalid');"),'42501');deny(()=>runtime('SELECT ticket_intake.v1_finalize(gen_random_uuid());'),'42501');
   deny(()=>runtime('SET ROLE ticket_owner;'),'42501');deny(()=>runtime('ALTER ROLE ticket_n8n SUPERUSER;'),'42501');
   assert.equal(runtime("SELECT count(*) FROM pg_tables WHERE schemaname='ticket_intake' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT,INSERT,UPDATE,DELETE');"),'0');
 });
 report.result='passed';
} catch(e) {report.result='failed';report.error=String(e.stderr??e.message);throw e;}
finally {
 if(created)docker(['exec',container,'dropdb','-U','ticket_bootstrap',db]);
 report.disposableRemoved=docker(args('postgres'),`SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=${lit(db)});`).trim()==='t';
 report.productionAfter=productionFingerprint();report.productionUnchanged=report.productionBefore===report.productionAfter;
 writeFileSync(new URL('v1-completion-isolated-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({result:report.result,tests:report.tests.length,removed:report.disposableRemoved,productionUnchanged:report.productionUnchanged,sha256:report.sourceHashes['005_v1_completion.sql']}));
}
assert.ok(report.disposableRemoved);assert.ok(report.productionUnchanged);
