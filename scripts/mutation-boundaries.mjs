import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { registerGoogleAdsTools } from '../dist/tools/google-ads-tools.js';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'ads-mutation-fixture-'));
const previousHome=process.env.HOME;
const previousGate=process.env.GOOGLE_ADS_ALLOW_MUTATIONS;
const originalFetch=globalThis.fetch;
let fetchCalls=0;
let socketCalls=0;
const originalConnect=net.Socket.prototype.connect;
const originalSend=dgram.Socket.prototype.send;
try {
 process.env.HOME=home;
 const blockSocket=()=>{socketCalls++;throw new Error('Network socket forbidden in isolated test');};
 net.Socket.prototype.connect=blockSocket;
 dgram.Socket.prototype.send=blockSocket;
 process.env.GOOGLE_ADS_ALLOW_MUTATIONS='false';
 globalThis.fetch=async()=>{fetchCalls++;throw new Error('Network forbidden in synthetic mutation-boundary test');};
 const handlers=new Map();
 registerGoogleAdsTools({registerTool:(name,_options,handler)=>handlers.set(name,handler)});
 const names=['pause_keyword','resume_keyword','set_keyword_bid_micros','set_campaign_budget_micros','pause_campaign','resume_campaign'];
 for(const name of names){
  for(const intent of [false,true]){
   const result=await handlers.get('google_ads_'+name)({customer_id:'1234567890',ad_group_id:'111',criterion_id:'222',campaign_id:'333',campaign_budget_id:'444',cpc_bid_micros:10000,amount_micros:10000,explicit_user_intent:intent,response_format:'json'});
   assert.equal(result.isError,true);
   assert.match(JSON.stringify(result),/Write tools are disabled/);
  }
 }
 // Explicit owner authorization applies only to this isolated, credential-free
 // harness: enable the global gate but NEVER provide per-call intent=true.
 process.env.GOOGLE_ADS_ALLOW_MUTATIONS='true';
 for(const name of names){
  const result=await handlers.get('google_ads_'+name)({customer_id:'1234567890',ad_group_id:'111',criterion_id:'222',campaign_id:'333',campaign_budget_id:'444',cpc_bid_micros:10000,amount_micros:10000,explicit_user_intent:false,response_format:'json'});
  assert.equal(result.isError,true);
  assert.match(JSON.stringify(result),/USER_ACTION_REQUIRED/);
 }
 assert.equal(fetchCalls,0);
 assert.equal(socketCalls,0);
 console.log(JSON.stringify({ok:true,suite:'mutation-boundaries',handlers:6,cases:18,enabledGateCases:'intent=false only',fetchCalls,socketCalls}));
}finally{
 globalThis.fetch=originalFetch;
 net.Socket.prototype.connect=originalConnect;
 dgram.Socket.prototype.send=originalSend;
 if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;
 if(previousGate===undefined)delete process.env.GOOGLE_ADS_ALLOW_MUTATIONS;else process.env.GOOGLE_ADS_ALLOW_MUTATIONS=previousGate;
 fs.rmSync(home,{recursive:true,force:true});
}
