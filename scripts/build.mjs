import {build} from 'esbuild';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0,12);
await rm('dist',{recursive:true,force:true});
await mkdir('dist/assets',{recursive:true});
const out = await build({
  entryPoints:['client/app.js'],bundle:true,write:false,format:'iife',platform:'browser',
  minify:true,target:['es2022'],legalComments:'none',logLevel:'warning'
});
const js = out.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const css = await readFile('client/style.css');
const jsName='app.'+hash(js)+'.js', cssName='style.'+hash(css)+'.css';
await writeFile('dist/assets/'+jsName,js);
await writeFile('dist/assets/'+cssName,css);
const page=(await readFile('client/index.html','utf8'))
  .replace('<!--STYLE-->', '<link rel="stylesheet" href="/assets/'+cssName+'">')
  .replace('<!--SCRIPT-->', '<script defer src="/assets/'+jsName+'"></script>');
await writeFile('dist/index.html',page);
console.log('Built content-hashed assets:',jsName,cssName);
