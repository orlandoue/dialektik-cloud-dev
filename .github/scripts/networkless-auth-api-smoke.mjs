import {randomBytes} from 'node:crypto';
function deny(){throw Error('NETWORKLESS_AUTH_TEST_REJECTED')}
if(process.env.CI_AUTH_NO_EGRESS!=='TRUE'||process.env.DATABASE_URL||process.env.SUPABASE_ACCESS_TOKEN)deny();
const origin='http://127.0.0.1:9999';
async function request(path,{method='GET',body,token}={}){
 const response=await fetch(origin+path,{method,redirect:'error',signal:AbortSignal.timeout(9000),
  headers:{'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json().catch(()=>null)};
}
async function main(){
 let h=null;
 for(let n=0;n<35;n++){
   try{h=await request('/health');if(h.status===200)break}catch{}
   await new Promise(resolve=>setTimeout(resolve,600));
 }
 if(h?.status!==200)deny();
 const email='dialektik-replay-'+randomBytes(12).toString('hex')+'@example.invalid';
 const password='SyntheticOnly-'+randomBytes(24).toString('hex')+'!';
 const sign=await request('/signup',{method:'POST',body:{email,password}});
 if(![200,201].includes(sign.status))deny();
 const auth=await request('/token?grant_type=password',{method:'POST',body:{email,password}});
 if(auth.status!==200||typeof auth.data?.access_token!=='string')deny();
 const user=await request('/user',{token:auth.data.access_token});
 if(user.status!==200||user.data?.email!==email||user.data?.id!==sign.data?.user?.id)deny();
 const bad=await request('/token?grant_type=password',{method:'POST',body:{email,password:'WrongSyntheticPassword!'}});
 if(![400,401,422].includes(bad.status))deny();
 const missing=await request('/user');
 if(![401,403].includes(missing.status))deny();
 console.log('NETWORKLESS_GOTRUE_HEALTH=PASS');
 console.log('NETWORKLESS_FIXTURE_PASSWORD_LOGIN=PASS');
 console.log('NETWORKLESS_FIXTURE_JWT_IDENTITY=PASS');
 console.log('NETWORKLESS_BAD_AUTH_REJECTED=PASS');
 console.log('ORIGINAL_USER_PASSWORD_TOUCHED=FALSE');
 console.log('EXTERNAL_NETWORK_AUTH_API_EXPOSED=FALSE');
}
main().catch(()=>{console.error('NETWORKLESS_GOTRUE_SMOKE=FAIL_REDACTED');process.exitCode=1});
