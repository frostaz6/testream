import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGuide,parseXmltvDate,currentPrograms} from '../server/xmltv.js';

test('XMLTV time parsing handles UTC and offset and time order',()=>{
  assert.equal(parseXmltvDate('20261108170000 +0000'),Date.UTC(2026,10,8,17));
  assert.equal(parseXmltvDate('20261108090000 -0800'),Date.UTC(2026,10,8,17));
  assert.equal(parseXmltvDate('202611081830 +0130'),Date.UTC(2026,10,8,17));
  assert.equal(parseXmltvDate('not a time'),null);
});
test('XMLTV maps now and next programmes by tvg-id',()=>{
  const xml='<?xml version="1.0"?><tv>'+
  '<channel id="espn.us"><display-name>ESPN</display-name></channel>'+
  '<programme start="20261108160000 +0000" stop="20261108180000 +0000" channel="espn.us">'+
  '<title lang="en">College Volleyball</title><desc>Live semifinal</desc></programme>'+
  '<programme start="20261108180000 +0000" stop="20261108193000 +0000" channel="espn.us">'+
  '<title>SportsCenter</title></programme></tv>';
  const at=Date.UTC(2026,10,8,17);
  const guide=parseGuide(xml,{from:at-1000,to:at+4*3600000});
  assert.equal(guide.get('espn.us').length,2);
  const {now,next}=currentPrograms(guide.get('espn.us'),at);
  assert.equal(now.title,'College Volleyball');
  assert.equal(now.description,'Live semifinal');
  assert.equal(next.title,'SportsCenter');
  assert.equal(currentPrograms(guide.get('missing'),at).now,null);
});
test('XMLTV rejects internal/external entities and invalid documents',()=>{
  assert.throws(()=>parseGuide('<!DOCTYPE tv [<!ENTITY x "test">]><tv/>'));
  assert.throws(()=>parseGuide('<!DOCTYPE tv SYSTEM "http://example.com/a.dtd"><tv/>'));
  assert.throws(()=>parseGuide('<a/>'));
});
