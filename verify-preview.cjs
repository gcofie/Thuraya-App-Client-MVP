'use strict';
// Static, read-only gate: never import application code or invoke cloud APIs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SITE='67278e0e-2924-4556-ba05-be91e505ec36';
const PUBLIC='qualification-preview',FUNCTIONS='qualification-empty-functions';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(directory,prefix=''){
 const rows=[];
 for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const relative=prefix+entry.name,absolute=path.join(directory,entry.name);
  if(entry.isSymbolicLink())throw Error('SYMLINK_NOT_ALLOWED');
  if(entry.isDirectory())rows.push(...inventory(absolute,relative+'/'));
  else if(entry.isFile())rows.push({path:relative,sha256:hash(fs.readFileSync(absolute))});
  else throw Error('NONREGULAR_FILE_NOT_ALLOWED');
 }
 return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
function verify({root=__dirname,env=process.env}={}){
 if(env.SITE_ID!==SITE||env.CONTEXT!=='deploy-preview')throw Error('EXACT_EXISTING_PRODUCTION_SITE_PREVIEW_ONLY');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'preview-deployment-manifest.json'),'utf8'));
 if(manifest.sourceTarget!=='PRODUCTION'||manifest.sourceKind!=='LOCAL_QUALIFIED_RELEASE_PACKAGE'||manifest.sourceCandidate!=='84d15b780a2fa92435cacb852a983002d4006b50'||manifest.sourcePackageSha256!=='5b93a904a8b5c1f477c838d976655317d9bd2e5fef6a6249b31dfc86883db2e5'||manifest.sourceBase!=='5c0006db02a03d2b6efacf277ff5e36ea95a9281'||manifest.repository!=='gcofie/Thuraya-App-Client-MVP'||manifest.channel!=='client'||manifest.files?.length!==12)throw Error('EXACT_A_PRODUCTION_PUBLIC_SOURCE_BINDING_REQUIRED');
 if(manifest.schema!==1||manifest.kind!=='STATIC_PREVIEW_ONLY'||manifest.siteId!==SITE||manifest.publishDirectory!==PUBLIC||manifest.functionsDirectory!==FUNCTIONS||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('INVALID_STATIC_MANIFEST');
 const seen=new Set();
 for(const row of manifest.files){
  if(typeof row.path!=='string'||!row.path||row.path.includes('\\')||row.path.split('/').some(part=>!part||part==='.'||part==='..')||path.posix.isAbsolute(row.path)||/^[a-z]:/i.test(row.path)||!/^[a-f0-9]{64}$/.test(row.sha256)||seen.has(row.path.toLowerCase()))throw Error('INVALID_ASSET_PATH_OR_HASH');
  seen.add(row.path.toLowerCase());
 }
 const actual=inventory(path.join(root,PUBLIC));
 if(JSON.stringify(actual)!==JSON.stringify(manifest.files))throw Error('EXACT_STATIC_ASSET_SET_REQUIRED');
 if(hash(fs.readFileSync(path.join(root,'netlify.toml')))!==manifest.netlifyConfigSha256)throw Error('NETLIFY_CONFIG_DRIFT');
 const fn=inventory(path.join(root,FUNCTIONS));
 if(fn.length!==1||fn[0].path!=='.gitkeep'||fs.statSync(path.join(root,FUNCTIONS,'.gitkeep')).size!==0)throw Error('FUNCTIONS_MUST_BE_EMPTY');
 const attributes=fs.readFileSync(path.join(root,'.gitattributes'),'utf8');
 if(!attributes.includes('/'+PUBLIC+'/** -text'))throw Error('RAW_ASSET_BYTES_REQUIRED');
 return{status:'STATIC_PREVIEW_GUARD_PASS',siteId:SITE,context:env.CONTEXT,files:actual.length,assetListSha256:hash(JSON.stringify(actual)),functions:0,applicationModulesExecuted:0};
}
if(require.main===module){try{console.log(JSON.stringify(verify()));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={verify,inventory,hash,SITE,PUBLIC,FUNCTIONS};
