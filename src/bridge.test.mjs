import { bridgeStatus, readDafeiyuEntries, readDafeiyuJobs } from './bridge.mjs';

console.log('=== bridgeStatus ===');
console.log(JSON.stringify(bridgeStatus(), null, 2));

console.log('\n=== readDafeiyuEntries ===');
const r = readDafeiyuEntries();
console.log('entries:', r.entries.length, 'error:', r.error);
console.log(JSON.stringify(r.entries.slice(0, 3), null, 2));

console.log('\n=== readDafeiyuJobs ===');
console.log(JSON.stringify(readDafeiyuJobs(), null, 2));
