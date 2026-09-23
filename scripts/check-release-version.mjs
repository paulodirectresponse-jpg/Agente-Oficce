import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const tauri=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
const values={
  package_json:pkg.version,
  package_lock:lock.version,
  package_lock_root:lock.packages?.['']?.version,
  tauri:tauri.version,
};
const unique=[...new Set(Object.values(values))];
if(unique.length!==1){
  console.error('Release version mismatch:',values);
  process.exit(1);
}
if(!/^\d+\.\d+\.\d+$/.test(String(unique[0]))){
  console.error('Release version is not semver:',unique[0]);
  process.exit(1);
}
console.log('Release version consistent:',unique[0]);
