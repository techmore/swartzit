import test from 'node:test';
import assert from 'node:assert/strict';
import { autoplayEnabled, observeAutoplay } from './autoplay-video.mjs';

test('autoplay defaults on and honors a saved off preference', () => {
  assert.equal(autoplayEnabled({getItem:()=>null}), true);
  assert.equal(autoplayEnabled({getItem:()=> 'off'}), false);
});

test('visible videos play muted, pause out of view, and honor explicit user controls', () => {
  const win = new EventTarget(); const doc = new EventTarget(); doc.hidden = false;
  win.innerHeight = 500; win.localStorage = {getItem:()=>null};
  let observer;
  win.IntersectionObserver = class { constructor(callback) { this.callback=callback; observer=this; } observe() {} disconnect() { this.disconnected=true; } };
  const video = new EventTarget(); Object.assign(video,{paused:true,muted:false,rect:{top:0,bottom:300,height:300},plays:0});
  video.getBoundingClientRect = () => video.rect;
  video.play = () => { video.plays++; video.paused=false; return Promise.resolve(); };
  video.pause = () => { video.paused=true; video.dispatchEvent(new Event('pause')); };
  const action=observeAutoplay(video,win,doc);
  observer.callback(); assert.equal(video.muted,true); assert.equal(video.plays,1);
  video.pause(); observer.callback(); assert.equal(video.plays,1, 'manual pause remains respected in view');
  video.rect={top:600,bottom:900,height:300}; observer.callback();
  video.rect={top:0,bottom:300,height:300}; observer.callback(); assert.equal(video.plays,2);
  win.dispatchEvent(new CustomEvent('swartzit-autoplay-change',{detail:{enabled:false}})); assert.equal(video.paused,true);
  video.muted=false; win.dispatchEvent(new CustomEvent('swartzit-autoplay-change',{detail:{enabled:true}})); assert.equal(video.muted,true); assert.equal(video.plays,3);
  doc.hidden=true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(video.paused,true);
  action.destroy(); assert.equal(observer.disconnected,true);
});
