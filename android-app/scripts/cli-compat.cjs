// Capacitor CLI 6 uses TypeScript default imports of the old CJS tar/rimraf.
// Their maintained releases expose named exports plus __esModule. Keep the
// native runtime unchanged and adapt those three build-tool imports explicitly.
const fs=require('node:fs');
const path=require('node:path');
const root=path.dirname(require.resolve('@capacitor/cli/package.json'));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
if(!/^6\./.test(version))throw Error('Review cli-compat before changing Capacitor CLI major version');
for(const [file,moduleName] of [['dist/util/template.js','tar'],['dist/tasks/migrate.js','rimraf'],['dist/ios/build.js','rimraf']]){
 const target=path.join(root,file),before=`tslib_1.__importDefault(require("${moduleName}"))`,after=`({default:require("${moduleName}")})`;
 const source=fs.readFileSync(target,'utf8');
 if(!source.includes(before)&&!source.includes(after))throw Error(`Unexpected CLI import in ${file}`);
 fs.writeFileSync(target,source.replace(before,after));
}
console.log('Applied Capacitor 6 build-tool compatibility for maintained tar/rimraf');
