import test from 'node:test';
import assert from 'node:assert/strict';
import {authMode,jellyfinAuthorized,jellyfinAllowed,stremioAllowed} from '../server/access.js';
test('default authentication requires only Stremio, without Plex or Jellyfin',()=>{
  assert.equal(authMode,'stremio');
  assert.equal(jellyfinAuthorized(null),true);
  assert.equal(stremioAllowed('someone@example.com'),true);
});
test('no Jellyfin allowlist is open by accident',()=>{
  assert.equal(jellyfinAllowed({username:'admin',id:'123'}),false);
});

test('Jellyfin mode enforces configured username allowlist and a 12-hour login',async()=>{
  const {execFileSync}=await import('node:child_process');
  const script=[
    "import {authMode,jellyfinAllowed,jellyfinAuthorized} from './server/access.js';",
    "const now=Date.now();",
    "console.log(JSON.stringify({mode:authMode,",
    "allow:jellyfinAllowed({username:'Alice',id:'123'}),",
    "deny:jellyfinAllowed({username:'Eve',id:'234'}),",
    "fresh:jellyfinAuthorized({jellyfin:{username:'Alice',authenticatedAt:now}},now),",
    "expired:jellyfinAuthorized({jellyfin:{username:'Alice',authenticatedAt:now-13*3600000}},now),",
    "missing:jellyfinAuthorized({})}));"
  ].join('\n');
  const output=execFileSync(process.execPath,['--input-type=module','-e',script],{
    cwd:process.cwd(),encoding:'utf8',env:{...process.env,AUTH_MODE:'jellyfin',
      JELLYFIN_URL:'http://127.0.0.1:8096',JELLYFIN_ALLOWLIST:'alice,abc'}
  });
  assert.deepEqual(JSON.parse(output),{
    mode:'jellyfin',allow:true,deny:false,fresh:true,expired:false,missing:false
  });
});
