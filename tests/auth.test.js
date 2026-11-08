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
