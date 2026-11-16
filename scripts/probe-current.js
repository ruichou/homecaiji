import { connectAt, evaluate } from '../tools/lib.mjs';
const p = await connectAt(9222);
const s = await evaluate(p.send, `({url: location.href, hasVideo: !!document.querySelector('video'),
  t: (document.querySelector('video') || {}).currentTime || 0,
  dur: (document.querySelector('video') || {}).duration || 0})`);
console.log(JSON.stringify(s, null, 2));
p.close();
