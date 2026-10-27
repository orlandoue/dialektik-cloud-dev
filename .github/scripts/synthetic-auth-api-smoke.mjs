import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
function stop(code){throw new Error(code)}
if(process.env.DIALEKTIK_AUTH_API_SYNTHETIC_ONLY!=='TRUE'||
   process.env.SUPABASE_DB_PASSWORD||process.env.DATABASE_URL||
   process.env.DIALEKTIK_DEV_BACKUP_DATABASE_URL||process.env.SUPABASE_ACCESS_TOKEN)
   stop('AUTH_SYNTHETIC_ENVIRONMENT_INVALID');
let status;
try{
  const output=execFileSync('npx',['--yes','supabase@2.120.0','status','-o','json'],
    {encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']});
  status=JSON.parse(output);
}catch{stop('AUTH_LOCAL_STATUS_UNAVAILABLE')}
const url=new URL(status.API_URL??status.apiUrl??'invalid:');
if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||
   url.username||url.password||url.search||url.hash)stop('AUTH_API_NOT_LOCALHOST');
const anon=status.ANON_KEY??status.anonKey;
if(typeof anon!=='string'||anon.length<32)stop('AUTH_SYNTHETIC_ANON_KEY_MISSING');
const headers={apikey:anon,'content-type':'application/json'};
const email='dialektik-smoke-'+randomBytes(6).toString('hex')+'@example.invalid';
const password='SyntheticOnly-'+randomBytes(28).toString('hex')+'!';
const endpoint=path=>new URL(path,url).toString();
async function request(path,{method='GET',body,token}={}){
  const response=await fetch(endpoint(path),{method,redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{...headers,...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>null);
  return {status:response.status,data};
}
async function main(){
  const health=await request('/auth/v1/health');
  if(health.status!==200)stop('AUTH_API_HEALTH_FAILED');
  const signup=await request('/auth/v1/signup',{method:'POST',body:{email,password}});
  if(![200,201].includes(signup.status))stop('AUTH_SYNTHETIC_SIGNUP_FAILED');
  const good=await request('/auth/v1/token?grant_type=password',
    {method:'POST',body:{email,password}});
  if(good.status!==200||typeof good.data?.access_token!=='string'||good.data.access_token.length<40)
    stop('AUTH_SYNTHETIC_PASSWORD_LOGIN_FAILED');
  const profile=await request('/auth/v1/user',{token:good.data.access_token});
  if(profile.status!==200||profile.data?.email!==email||
     profile.data?.id!==signup.data?.user?.id)stop('AUTH_SYNTHETIC_JWT_USER_MISMATCH');
  const bad=await request('/auth/v1/token?grant_type=password',
    {method:'POST',body:{email,password:'DefinitelyWrongPassword!'}});
  if(![400,401,422].includes(bad.status))stop('AUTH_SYNTHETIC_WRONG_PASSWORD_ACCEPTED');
  const anonymous=await request('/auth/v1/user');
  if(![401,403].includes(anonymous.status))stop('AUTH_SYNTHETIC_UNAUTHORIZED_USER_ACCEPTED');
  console.log('LOCAL_GOTRUE_HEALTH=PASS');
  console.log('LOCAL_SYNTHETIC_SIGNUP_PASSWORD_LOGIN=PASS');
  console.log('LOCAL_SYNTHETIC_JWT_USER_BINDING=PASS');
  console.log('LOCAL_AUTH_REJECTS_WRONG_PASSWORD_AND_MISSING_TOKEN=PASS');
  console.log('RESTORED_AUTH_ACCOUNT_LOGIN=NOT_EXECUTED');
  console.log('DEV_ACCOUNT_CREDENTIALS_USED=FALSE');
}
main().catch(()=>{console.error('LOCAL_AUTH_API_SMOKE=FAIL_REDACTED');process.exitCode=1});
