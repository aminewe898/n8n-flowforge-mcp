// Explicitly authorized disposable PostgreSQL tests. No n8n/provider calls.
import {execFileSync, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const container='ticket-postgres-v1';
const scratch='ticket_phase2a_test_'+randomUUID().replaceAll('-','');
assert.match(scratch,/^ticket_phase2a_test_[a-f0-9]{32}$/);
const root=new URL('../migrations/',import.meta.url);
const report={testDatabase:scratch,fakeDataOnly:true,postgresVersion:null,tests:[],failures:[],concurrency:[]};
const hash=s=>createHash('sha256').update(s).digest('hex');
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>literal(JSON.stringify(value))+'::jsonb';
const docker=(args,input)=>execFileSync('docker',args,{encoding:'utf8',input,windowsHide:true,
  timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
const admin=input=>docker(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1',
  '-v','VERBOSITY=verbose','-At','-U','ticket_bootstrap','-d',scratch],input).trim();
// The password is read/exported only inside the container; never returned or logged.
const authenticatedArgs=['exec','-i',container,'bash','-c',
  'set -eu; export PGPASSWORD="$(< /run/secrets/ticket_runtime_password)"; exec psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At -h 127.0.0.1 -U ticket_n8n -d "$1"',
  'phase2a-authentication','ticket_system'];
const runtimeArgs=['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1',
  '-v','VERBOSITY=verbose','-At','-U','ticket_bootstrap','-d',scratch];
const runtime=input=>docker(runtimeArgs,'SET SESSION AUTHORIZATION ticket_n8n;\n'+input).trim();
const result=input=>JSON.parse(runtime(input).split(/\r?\n/).find(s=>s.startsWith('{')));
const inspect=input=>JSON.parse(admin(input));
const parallel=input=>new Promise((resolve,reject)=>{
  const p=spawn('docker',runtimeArgs,{windowsHide:true}); let output='',error='';
  p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>error+=x);
  p.on('error',reject);p.on('close',code=>code===0?resolve(output):reject(new Error(error)));
  p.stdin.end('SET SESSION AUTHORIZATION ticket_n8n;\n'+input);
});
const expectError=(operation,code)=>{
  let caught;try{operation();}catch(e){caught=e;}
  assert.ok(caught,'expected SQL rejection '+code);
  assert.match(String(caught.stderr??caught.message),new RegExp('ERROR:\\s+'+code+':'));
};
const productionFingerprint=()=>{
  const dump=docker(['exec',container,'pg_dump','-U','ticket_bootstrap','-d','ticket_system']);
  // PostgreSQL18 pg_dump creates random client-side restrict nonces per dump.
  return hash(dump.replace(/^\\(?:un)?restrict .*$/gm,''));
};
const roleFingerprint=()=>hash(docker(['exec',container,'psql','-X','-q','-At','-U','ticket_bootstrap','-d','postgres','-c',
  `BEGIN READ ONLY;SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r),
  'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m));COMMIT;`]));
const n8nFingerprint=()=>hash(docker(['inspect','n8n','--format',
  '{{.Id}} {{.State.Status}} {{.State.StartedAt}} {{json .NetworkSettings.Networks}} {{json .Mounts}}']));
const productionBefore=productionFingerprint(),rolesBefore=roleFingerprint(),n8nBefore=n8nFingerprint();
const policy={version:'phase2a-1',maxAudioBytes:10000000,maxDurationSeconds:600,
  leaseSeconds:300,hardTtlHours:72,successGraceHours:1};
const bot=900000000001,user=900000000002,chat=user;
let sequence=0,created=false,failed;
const reset=()=>admin(`SET ROLE ticket_owner;TRUNCATE ticket_intake.clients,ticket_intake.client_contacts,
  ticket_intake.processed_messages,ticket_intake.intakes,ticket_intake.pending_interactions,
  ticket_intake.tickets,ticket_intake.work_items,ticket_intake.outbox RESTART IDENTITY CASCADE;`);
const fixture=(kind='voice')=>{
  const seq=++sequence;
  const message=kind==='voice'?{fileId:'FAKE_PHASE2_FILE_'+seq,fileUniqueId:'FAKE_PHASE2_UNIQUE_'+seq,
    mimeType:'audio/ogg',sizeBytes:100,durationSeconds:3}:{text:'FAKE_PHASE2_TEXT_ONLY'};
  return result(`SELECT ticket_intake.ingest_message(${bot},${seq},${user},${chat},${seq},${literal(kind)},
    ${json(message)},'{"configVersion":"FAKE_PHASE2","retryPolicy":{"stageMaxAttempts":5}}'::jsonb);`);
};
const claimSQL=(owner='FAKE_WORKER')=>`SELECT ticket_intake.claim_work(${literal(owner)},${bot}::bigint,
  ${user}::bigint,${chat}::bigint,${json(policy)});`;
const claim=owner=>result(claimSQL(owner));
const args=(w,token=w.leaseToken,revision=w.revision)=>`${literal(w.workId)}::uuid,${literal(token)}::uuid,${literal(revision)}::bigint`;
const begin=w=>result(`SELECT ticket_intake.begin_stage(${args(w)});`);
const renew=w=>result(`SELECT ticket_intake.renew_work(${args(w)});`);
const checkpointSQL=(w,p)=>`SELECT ticket_intake.checkpoint_stage(${args(w)},${json(p)});`;
const checkpoint=(w,p)=>result(checkpointSQL(w,p));
const fail=(w,classification,token=w.leaseToken)=>result(`SELECT ticket_intake.fail_work(${args(w,token)},${literal(classification)},1);`);
const audio=label=>{const bytes=Buffer.from('OggSFAKE_DATABASE_FIXTURE_ONLY_'+label);
  return {audioBase64:bytes.toString('base64'),mimeType:'audio/ogg',sizeBytes:bytes.length,sha256:hash(bytes)};};
const transcript={transcriptOriginal:'  FAKE TEST: L’ordinador no arrenca. الحاسوب لا يعمل.\n',
  metadata:{provider:'groq',model:'whisper-large-v3-turbo',version:'transcription-1'}};
const extraction={clientName:null,company:null,email:null,summary:'FAKE TEST',description:'FAKE TEST incident only.',
  category:'unknown',prioritySuggestion:'unknown',affectedSystem:null,symptoms:['FAKE symptom'],
  technicalDetails:[],onsetText:null,businessImpact:null,urgencyEvidence:null,confidence:null,missingInformation:['email']};
const extracted=()=>({extraction:{...extraction},metadata:{provider:'groq',model:'openai/gpt-oss-120b',
  schemaVersion:'extraction-1',promptVersion:'extract-prompt-1'}});
const state=()=>inspect(`SELECT jsonb_build_object('intakes',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM ticket_intake.intakes i),
  'work',(SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY id),'[]') FROM ticket_intake.work_items w),
  'tickets',(SELECT count(*) FROM ticket_intake.tickets),'clients',(SELECT count(*) FROM ticket_intake.clients),
  'contacts',(SELECT count(*) FROM ticket_intake.client_contacts));`);
const expire=w=>admin(`UPDATE ticket_intake.work_items SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${literal(w.workId)};`);
const downloadReady=label=>{fixture();const w=begin(claim());renew(w);const payload=audio(label);checkpoint(w,payload);return {w,payload};};
const test=async(name,body)=>{await body();report.tests.push({name,result:'passed'});console.log('PASS '+name);};

try{
  docker(['exec',container,'createdb','-U','ticket_bootstrap','-O','ticket_owner','-T','template0',scratch]);created=true;
  report.postgresVersion=admin('SELECT version();');
  assert.match(admin('SHOW server_version;'),/^18\.6(?:\s|$)/,'validation requires PostgreSQL 18.6');
  const files=['001_schema.sql','002_phase1_operations.sql','003_grants.sql','004_phase2a_worker.proposed.sql'];
  report.sourceHashes={};
  for(const name of files){
    const original=readFileSync(new URL(name,root),'utf8');report.sourceHashes[name]=hash(original);
    // Only database-name guards/GRANT targets are adapted in the disposable copy.
    const source=original.replaceAll('ticket_system',scratch);
    admin('SET ROLE ticket_owner;\n'+source);
  }
  report.migration='applied cleanly to isolated database';
  await test('001/002/003/004 apply; expected eight tables and nine new functions',()=>{
    const tables=JSON.parse(admin(`SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='ticket_intake';`));
    assert.deepEqual(tables,['client_contacts','clients','intakes','outbox','pending_interactions','processed_messages','tickets','work_items']);
    report.functions=JSON.parse(admin(`SELECT jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
      'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'settings',p.proconfig,'runtimeExecute',has_function_privilege('ticket_n8n',p.oid,'EXECUTE'))
      ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ticket_intake';`));
    assert.equal(report.functions.length,15);
    assert.equal(runtime('SELECT current_user;'),'ticket_n8n');
    assert.ok(report.functions.every(f=>f.owner==='ticket_owner'));
    assert.ok(report.functions.filter(f=>f.definer).every(f=>f.settings.includes('search_path=pg_catalog, pg_temp')));
  });
  await test('runtime only eight approved signatures; no table writes, reads, creation or escalation',()=>{
    const allowed=report.functions.filter(f=>f.runtimeExecute).map(f=>f.name+'('+f.arguments.replace(/p_\w+ /g,'')+')').sort();
    const intended=['ingest_message(bigint, bigint, bigint, bigint, bigint, text, jsonb, jsonb)',
      'lookup_message(bigint, bigint, bigint, bigint)','claim_work(text, bigint, bigint, bigint, jsonb)',
      'begin_stage(uuid, uuid, bigint)','renew_work(uuid, uuid, bigint)','checkpoint_stage(uuid, uuid, bigint, jsonb)',
      'fail_work(uuid, uuid, bigint, text, integer)','inspect_work(uuid, uuid)'].sort();
    assert.deepEqual(allowed,intended);
    const privilegeCount=Number(admin(`SELECT count(*) FROM pg_tables WHERE schemaname='ticket_intake' AND
      has_table_privilege('ticket_n8n',quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');`));
    assert.equal(privilegeCount,0);
    for(const query of ["INSERT INTO ticket_intake.clients(kind,display_name,name_norm) VALUES('individual','FAKE','fake');",
      'UPDATE ticket_intake.intakes SET state=state WHERE false;','DELETE FROM ticket_intake.work_items WHERE false;',
      'TRUNCATE ticket_intake.tickets;','SELECT count(*) FROM ticket_intake.processed_messages;',
      'CREATE TEMP TABLE fake_probe(id int);','CREATE TABLE public.fake_probe(id int);',
      "SELECT nextval('ticket_intake.intakes_intake_number_seq');",
      'CREATE FUNCTION ticket_intake.fake_escalation() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;',
      'SET ROLE ticket_owner;',
      'BEGIN; ALTER ROLE ticket_n8n SUPERUSER; ROLLBACK;',
      'BEGIN; CREATE ROLE fake_phase2_escalation_probe; ROLLBACK;',
      "SELECT ticket_intake.claim_work('download','FAKE',300);",
      `SELECT ticket_intake.renew_work('${randomUUID()}'::uuid,'${randomUUID()}'::uuid,300::integer);`,
      "SELECT ticket_intake.phase2_policy_valid('{}');",'SELECT * FROM ticket_intake.purge_audio(1);']) expectError(()=>runtime(query),'42501');
    const identity=docker(authenticatedArgs,'BEGIN READ ONLY;SELECT current_user;COMMIT;').trim();
    assert.equal(identity,'ticket_n8n');
    for(const query of ['SET ROLE ticket_owner;','SET SESSION AUTHORIZATION ticket_bootstrap;']) {
      expectError(()=>docker(authenticatedArgs,'BEGIN READ ONLY;'+query+'ROLLBACK;'),'42501');
    }
    const flags=JSON.parse(docker(authenticatedArgs,`BEGIN READ ONLY;SELECT jsonb_build_object(
      'superuser',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,
      'bypassRls',rolbypassrls,'ownerMembership',pg_has_role(current_user,'ticket_owner','MEMBER'))
      FROM pg_roles WHERE rolname=current_user;COMMIT;`).trim());
    assert.ok(Object.values(flags).every(v=>v===false));
    report.runtimePrivileges={approvedFunctionSignatures:allowed,directTablePrivileges:0,escalation:'denied',
      tcpScramLogin:'passed (real DB read-only identity checks only)',isolatedTests:'SET SESSION AUTHORIZATION ticket_n8n; HBA unchanged',flags};
  });
  await test('Phase1 duplicate ingest and lookup remain compatible after 004',()=>{
    reset();const first=fixture();const seq=sequence;
    const duplicate=result(`SELECT ticket_intake.ingest_message(${bot},${seq},${user},${chat},${seq},'voice',
      ${json({fileId:'FAKE_PHASE2_FILE_'+seq,fileUniqueId:'FAKE_PHASE2_UNIQUE_'+seq,mimeType:'audio/ogg',sizeBytes:100,durationSeconds:3})},
      '{"configVersion":"FAKE_PHASE2","retryPolicy":{"stageMaxAttempts":5}}'::jsonb);`);
    assert.equal(duplicate.outcome,'duplicate_message');assert.equal(duplicate.intakeId,first.intakeId);
    const lookup=result(`SELECT ticket_intake.lookup_message(${bot}::bigint,${seq}::bigint,${chat}::bigint,${seq}::bigint);`);
    assert.equal(lookup.intakeId,first.intakeId);assert.equal(state().work.length,1);
  });
  await test('Groq metadata accepted; invalid providers/models/schema versions rejected atomically',()=>{
    for(const model of ['openai/gpt-oss-120b','openai/gpt-oss-20b']){
      reset();downloadReady('GROQ_METADATA_'+model);let w=begin(claim());renew(w);
      for(const metadata of [
        {...transcript.metadata,provider:'openai'},
        {...transcript.metadata,provider:'nvidia'},
        {...transcript.metadata,model:'whisper-1'},
        {...transcript.metadata,model:null},
        {...transcript.metadata,version:'wrong'},
        {...transcript.metadata,extra:'FAKE_FORBIDDEN'},
      ]){
        const before=state();expectError(()=>checkpoint(w,{...transcript,metadata}),'22023');assert.deepEqual(state(),before);
      }
      assert.equal(checkpoint(w,transcript).nextStage,'extract');
      assert.deepEqual(state().intakes[0].transcription_metadata,transcript.metadata);
      w=begin(claim());renew(w);const payload=extracted();payload.metadata.model=model;
      for(const metadata of [
        {...payload.metadata,provider:'openai'},
        {...payload.metadata,provider:'unknown'},
        {...payload.metadata,provider:null},
        {...payload.metadata,model:'FAKE_UNSUPPORTED_MODEL'},
        {...payload.metadata,model:null},
        {...payload.metadata,provider:'nvidia'},
        {...payload.metadata,schemaVersion:'wrong'},
        {...payload.metadata,promptVersion:'wrong'},
        {...payload.metadata,extra:'FAKE_FORBIDDEN'},
      ]){
        const before=state();expectError(()=>checkpoint(w,{...payload,metadata}),'22023');assert.deepEqual(state(),before);
      }
      for(const bad of [{...extraction,confidence:2},{...extraction,summary:''},
        {...extraction,email:'invented@example.invalid'},{...extraction,clientId:'FAKE_ID'}]){
        const before=state();expectError(()=>checkpoint(w,{...payload,extraction:bad}),'22023');assert.deepEqual(state(),before);
      }
      const r=checkpoint(w,payload);assert.equal(r.nextStage,'resolve_client');assert.equal(r.state,'extracted');
      assert.deepEqual(state().intakes[0].extraction_metadata,payload.metadata);
      assert.equal(checkpoint(w,payload).outcome,'already_applied');
      assert.equal(state().work.filter(j=>j.stage==='resolve_client').length,1);
      assert.equal(state().tickets,0);assert.equal(claim().outcome,'idle');
    }
  });
  await test('reviewed NVIDIA extraction pair accepted; Groq transcription remains mandatory',()=>{
    reset();downloadReady('NVIDIA_METADATA_ONLY');let w=begin(claim());renew(w);checkpoint(w,transcript);
    w=begin(claim());renew(w);const payload=extracted();
    payload.metadata.provider='nvidia';payload.metadata.model='nvidia/nemotron-3-super-120b-a12b';
    assert.equal(checkpoint(w,payload).nextStage,'resolve_client');
    assert.deepEqual(state().intakes[0].extraction_metadata,payload.metadata);
    assert.equal(state().tickets,0);
  });
  await test('single claim returns token and expiry; begin rejects stale token/revision/state',()=>{
    reset();fixture();let w=claim();assert.equal(w.outcome,'claimed');assert.equal(w.stage,'download');
    assert.match(w.leaseToken,/^[a-f0-9-]{36}$/);assert.ok(Date.parse(w.leaseExpiresAt)>Date.now());
    assert.equal(claim().outcome,'idle');
    expectError(()=>runtime(`SELECT ticket_intake.begin_stage(${args(w,randomUUID())});`),'P0002');
    expectError(()=>runtime(`SELECT ticket_intake.begin_stage(${args(w,w.leaseToken,999)});`),'P0002');
    admin(`UPDATE ticket_intake.intakes SET state='extracted' WHERE id=${literal(w.intakeId)};`);
    expectError(()=>begin(w),'22023');
    admin(`UPDATE ticket_intake.intakes SET state='received' WHERE id=${literal(w.intakeId)};`);
    w=begin(w);assert.equal(w.outcome,'begun');assert.equal(w.revision,'1');assert.equal(begin(w).revision,'1');
  });
  await test('eight concurrent claims of one queued item have exactly one owner',async()=>{
    reset();fixture();const outputs=await Promise.allSettled(Array.from({length:8},(_,n)=>parallel(
      'BEGIN;'+claimSQL('FAKE_RACE_'+n)+'SELECT pg_sleep(0.3);COMMIT;')));
    for(const o of outputs)assert.equal(o.status,'fulfilled',o.reason?.message);
    const receipts=outputs.map(o=>JSON.parse(o.value.split(/\r?\n/).find(s=>s.startsWith('{'))));
    assert.equal(receipts.filter(r=>r.outcome==='claimed').length,1);assert.equal(receipts.filter(r=>r.outcome==='idle').length,7);
    const rows=state().work;assert.equal(rows.length,1);assert.equal(rows[0].attempt_count,1);assert.equal(rows[0].status,'leased');
    report.concurrency.push({scenario:'claim same item',sessions:8,owners:1,idle:7});
  });
  await test('one claim does not acquire a batch; bot/user/chat scope enforced',()=>{
    reset();fixture();fixture();const first=claim('FAKE_ONE'),s=state();assert.equal(first.outcome,'claimed');
    assert.equal(s.work.filter(w=>w.status==='leased').length,1);assert.equal(s.work.filter(w=>w.status==='queued').length,1);
    assert.equal(result(`SELECT ticket_intake.claim_work('FAKE_WRONG_BOT',${bot+1}::bigint,${user}::bigint,${chat}::bigint,${json(policy)});`).outcome,'idle');
    assert.equal(result(`SELECT ticket_intake.claim_work('FAKE_WRONG_USER',${bot}::bigint,${user+1}::bigint,${chat}::bigint,${json(policy)});`).outcome,'idle');
    assert.equal(result(`SELECT ticket_intake.claim_work('FAKE_WRONG_CHAT',${bot}::bigint,${user}::bigint,${chat+1}::bigint,${json(policy)});`).outcome,'idle');
  });
  await test('download metadata, atomic successor, identical replay and stale checkpoint',()=>{
    reset();fixture();const w=begin(claim());assert.equal(renew(w).outcome,'renewed');const payload=audio('HAPPY');
    const receipt=checkpoint(w,payload);assert.equal(receipt.nextStage,'transcribe');assert.equal(receipt.state,'audio_ready');
    let s=state();const i=s.intakes[0];assert.equal(i.audio_mime_type,'audio/ogg');assert.equal(i.audio_size_bytes,payload.sizeBytes);
    assert.equal(i.audio_sha256,payload.sha256);assert.ok(i.audio_bytes);assert.ok(i.audio_stored_at);
    assert.ok(Math.abs(Date.parse(i.audio_purge_after)-Date.parse(i.audio_stored_at)-72*3600000)<1000);
    assert.equal(s.work.filter(j=>j.stage==='download'&&j.status==='succeeded').length,1);
    assert.equal(s.work.filter(j=>j.stage==='transcribe'&&j.status==='queued').length,1);
    assert.equal(checkpoint(w,payload).outcome,'already_applied');
    expectError(()=>runtime(`SELECT ticket_intake.checkpoint_stage(${args(w,randomUUID())},${json(payload)});`),'P0002');
    expectError(()=>checkpoint(w,{...payload,sizeBytes:payload.sizeBytes+1}),'22023');
    s=state();assert.equal(s.work.filter(j=>j.stage==='transcribe').length,1);
    const reconciled=result(`SELECT ticket_intake.inspect_work(${literal(w.workId)}::uuid,${literal(w.leaseToken)}::uuid);`);
    assert.equal(reconciled.status,'succeeded');assert.equal(reconciled.checkpointReceipt.nextStage,'transcribe');
  });
  await test('forced successor failure rolls back audio, completion and revision atomically',()=>{
    reset();fixture();const w=begin(claim());renew(w);const before=state();
    admin(`SET ROLE ticket_owner;CREATE FUNCTION ticket_intake.fake_atomic_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.stage='transcribe' THEN RAISE EXCEPTION 'FAKE_ATOMIC_FAILURE'; END IF;RETURN NEW;END $$;
      CREATE TRIGGER fake_atomic_failure BEFORE INSERT ON ticket_intake.work_items FOR EACH ROW EXECUTE FUNCTION ticket_intake.fake_atomic_failure();`);
    try{expectError(()=>checkpoint(w,audio('ROLLBACK')),'P0001');assert.deepEqual(state(),before);}
    finally{admin('SET ROLE ticket_owner;DROP TRIGGER fake_atomic_failure ON ticket_intake.work_items;DROP FUNCTION ticket_intake.fake_atomic_failure();');}
  });
  await test('concurrent identical checkpoints advance once and enqueue one successor',async()=>{
    reset();fixture();const w=begin(claim());renew(w);const payload=audio('CHECKPOINT_RACE');
    const outputs=await Promise.allSettled(Array.from({length:6},()=>parallel('BEGIN;'+checkpointSQL(w,payload)+'SELECT pg_sleep(0.2);COMMIT;')));
    for(const o of outputs)assert.equal(o.status,'fulfilled',o.reason?.message);
    const receipts=outputs.map(o=>JSON.parse(o.value.split(/\r?\n/).find(s=>s.startsWith('{'))));
    assert.equal(receipts.filter(r=>r.outcome==='advanced').length,1);assert.equal(receipts.filter(r=>r.outcome==='already_applied').length,5);
    assert.equal(state().work.filter(j=>j.stage==='transcribe').length,1);
    report.concurrency.push({scenario:'same checkpoint',sessions:6,advanced:1,alreadyApplied:5,successors:1});
  });
  await test('download survives new worker session; transient retry preserves audio and fences old owner',()=>{
    reset();const {payload}=downloadReady('RESTART_A');let w=begin(claim('FAKE_RESTARTED_WORKER'));
    assert.equal(Buffer.from(w.payload.audioBase64,'base64').toString('base64'),payload.audioBase64);assert.equal(w.payload.sha256,payload.sha256);
    renew(w);assert.equal(fail(w,'transient_external').outcome,'retry_scheduled');
    let s=state();assert.equal(s.intakes[0].audio_sha256,payload.sha256);assert.equal(s.intakes[0].state,'retry_pending');
    admin("UPDATE ticket_intake.work_items SET available_at=clock_timestamp()-interval '1 second' WHERE status='queued';");
    const old=w;w=begin(claim('FAKE_RETRY_WORKER'));assert.notEqual(w.leaseToken,old.leaseToken);assert.equal(w.stage,'transcribe');
    const before=state();assert.equal(fail(old,'permanent_external').outcome,'stale_lease');assert.deepEqual(state(),before);
    expectError(()=>checkpoint(old,transcript),'P0002');renew(w);assert.equal(checkpoint(w,transcript).nextStage,'extract');
    s=state();assert.equal(s.intakes[0].transcript_original,transcript.transcriptOriginal);assert.ok(s.intakes[0].transcribed_at);
    assert.deepEqual(s.intakes[0].transcription_metadata,transcript.metadata);assert.equal(s.work.filter(j=>j.stage==='extract').length,1);
  });
  await test('transcript survives new worker session; extract queues resolve_client once then stops',()=>{
    let w=begin(claim('FAKE_RESTARTED_EXTRACT'));assert.equal(w.stage,'extract');assert.equal(w.payload.transcriptOriginal,transcript.transcriptOriginal);
    renew(w);assert.equal(fail(w,'transient_external').outcome,'retry_scheduled');assert.equal(state().intakes[0].transcript_original,transcript.transcriptOriginal);
    admin("UPDATE ticket_intake.work_items SET available_at=clock_timestamp()-interval '1 second' WHERE status='queued';");
    w=begin(claim());renew(w);const before=state();
    expectError(()=>checkpoint(w,{...extracted(),extraction:{...extraction,clientId:'FAKE_FORBIDDEN_ID'}}),'22023');assert.deepEqual(state(),before);
    const r=checkpoint(w,extracted());assert.equal(r.nextStage,'resolve_client');assert.equal(r.state,'extracted');
    assert.equal(checkpoint(w,extracted()).outcome,'already_applied');const s=state();
    assert.equal(s.work.filter(j=>j.stage==='resolve_client'&&j.status==='queued').length,1);assert.equal(s.intakes[0].transcript_original,transcript.transcriptOriginal);
    assert.deepEqual(s.intakes[0].extraction,extraction);assert.ok(s.intakes[0].extraction_validated_at);assert.equal(s.intakes[0].validation_version,1);
    assert.ok(Date.parse(s.intakes[0].audio_purge_after)<=Date.now()+3601000);assert.equal(s.tickets,0);assert.equal(s.clients,0);assert.equal(s.contacts,0);
    assert.equal(claim().outcome,'idle');
  });
  await test('later/operator_reply stages cannot be claimed or begun by phase2 worker',()=>{
    // Even make the later-stage intake state eligible: the stage allowlist must still win.
    admin("UPDATE ticket_intake.intakes SET state='received';");fixture('text');assert.equal(claim().outcome,'idle');
    for(const stage of ['resolve_client','finalize']){
      const token=randomUUID();admin(`UPDATE ticket_intake.work_items SET stage=${literal(stage)},status='queued'
        WHERE intake_id IS NOT NULL AND status='queued';`);assert.equal(claim().outcome,'idle');
      const row=inspect(`UPDATE ticket_intake.work_items SET status='leased',lease_owner='FAKE_OWNER',lease_token=${literal(token)},
        lease_expires_at=clock_timestamp()+interval '300 seconds' WHERE intake_id IS NOT NULL AND status='queued'
        RETURNING jsonb_build_object('workId',id,'leaseToken',lease_token,'revision',(SELECT revision::text FROM ticket_intake.intakes WHERE id=intake_id));`);
      expectError(()=>begin(row),'P0002');admin(`UPDATE ticket_intake.work_items SET status='queued',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=${literal(row.workId)};`);
    }
  });
  await test('permanent/configuration/malformed/unknown failures are terminal; stale fail cannot alter checkpoints',()=>{
    for(const c of ['permanent_external','configuration','malformed_output','provider_unknown_result','invalid_input']){
      reset();const {payload}=downloadReady('TERMINAL_'+c);const w=begin(claim());renew(w);assert.equal(fail(w,c).outcome,'needs_operator');
      const s=state();assert.equal(s.intakes[0].state,'needs_operator');assert.equal(s.intakes[0].audio_sha256,payload.sha256);
      assert.equal(s.work.find(j=>j.id===w.workId).status,'needs_operator');assert.equal(s.work.find(j=>j.id===w.workId).last_failure_class,c);
      assert.equal(claim().outcome,'idle');const before=state();assert.equal(fail(w,'configuration').outcome,'stale_lease');assert.deepEqual(state(),before);
    }
  });
  await test('live lease renews; wrong/expired token cannot renew or checkpoint; download reclaim fences old token',()=>{
    reset();fixture();const w=begin(claim());const beforeExpiry=state().work[0].lease_expires_at;
    assert.equal(renew(w).outcome,'renewed');assert.ok(Date.parse(state().work[0].lease_expires_at)>=Date.parse(beforeExpiry));
    expectError(()=>runtime(`SELECT ticket_intake.renew_work(${args(w,randomUUID())});`),'P0002');expire(w);
    const expired=state();expectError(()=>renew(w),'P0002');expectError(()=>checkpoint(w,audio('EXPIRED')),'P0002');
    assert.equal(fail(w,'configuration').outcome,'stale_lease');assert.deepEqual(state(),expired);
    const newer=claim();assert.equal(newer.outcome,'claimed');assert.notEqual(newer.leaseToken,w.leaseToken);expectError(()=>renew(w),'P0002');
    assert.equal(begin(newer).outcome,'begun');
  });
  await test('expired pre-dispatch AI lease recovers; dispatched unknown AI result does not auto-repeat',()=>{
    reset();downloadReady('RECOVERY');let w=begin(claim());expire(w);const next=claim();assert.equal(next.outcome,'claimed');
    assert.notEqual(next.leaseToken,w.leaseToken);w=begin(next);renew(w);expire(w);const held=claim();
    assert.equal(held.outcome,'needs_operator');assert.equal(held.reason,'provider_unknown_result');assert.equal(state().intakes[0].state,'needs_operator');
  });
  await test('exhausted attempt budget moves to needs_operator without external processing',()=>{
    reset();fixture();admin('UPDATE ticket_intake.work_items SET attempt_count=max_attempts;');
    assert.equal(claim().outcome,'needs_operator');assert.equal(state().work[0].status,'needs_operator');
  });
  await test('two matching audio hashes advance one intake and hold the other without duplicates',async()=>{
    reset();fixture();fixture();const a=begin(claim('FAKE_HASH_A')),b=begin(claim('FAKE_HASH_B'));renew(a);renew(b);const payload=audio('SAME_BYTES');
    const outputs=await Promise.allSettled([a,b].map(w=>parallel('BEGIN;'+checkpointSQL(w,payload)+'SELECT pg_sleep(0.2);COMMIT;')));
    for(const o of outputs)assert.equal(o.status,'fulfilled',o.reason?.message);
    const receipts=outputs.map(o=>JSON.parse(o.value.split(/\r?\n/).find(s=>s.startsWith('{'))));
    assert.equal(receipts.filter(r=>r.outcome==='advanced').length,1);assert.equal(receipts.filter(r=>r.outcome==='needs_operator').length,1);
    assert.equal(state().work.filter(j=>j.stage==='transcribe').length,1);
    report.concurrency.push({scenario:'same audio hash on different intakes',sessions:2,advanced:1,heldForReview:1,successors:1});
  });
  report.result='passed';
}catch(error){
  failed=error;report.result='failed';report.failures.push({name:report.tests.at(-1)?.name??'migration/setup',
    error:String(error.stderr??error.message).slice(0,1800)});
}finally{
  if(created){docker(['exec',container,'dropdb','-U','ticket_bootstrap',scratch]);report.testDatabaseRemoved=true;}
  report.testDatabaseAbsent=JSON.parse(docker(['exec',container,'psql','-X','-q','-At','-U','ticket_bootstrap','-d','postgres','-c',
    `SELECT jsonb_build_object('absent',NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=${literal(scratch)}));`]).trim()).absent;
  report.productionFingerprintBefore=productionBefore;report.productionFingerprintAfter=productionFingerprint();
  report.productionUnchanged=report.productionFingerprintAfter===productionBefore;
  report.clusterRolesUnchanged=roleFingerprint()===rolesBefore;report.n8nContainerUnchanged=n8nFingerprint()===n8nBefore;
  writeFileSync(new URL('phase2a-last-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:report.result,passed:report.tests.length,testDatabaseRemoved:report.testDatabaseRemoved,
    testDatabaseAbsent:report.testDatabaseAbsent,productionUnchanged:report.productionUnchanged,
    clusterRolesUnchanged:report.clusterRolesUnchanged,n8nContainerUnchanged:report.n8nContainerUnchanged}));
}
assert.ok(report.testDatabaseAbsent&&report.productionUnchanged&&report.clusterRolesUnchanged&&report.n8nContainerUnchanged,'isolation verification failed');
if(failed){console.error(String(failed.stderr??failed.message).slice(0,1800));process.exitCode=1;}
