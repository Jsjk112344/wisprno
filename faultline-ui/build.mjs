import {build} from 'esbuild';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['node_modules/@tailwindcss/cli/dist/index.mjs','-i','src/hero.css','-o','compiled.css','--minify'],{stdio:'inherit'});
await build({entryPoints:['src/main.jsx'],bundle:true,minify:true,format:'iife',loader:{'.svg':'dataurl'},outfile:'compiled.js',define:{'process.env.NODE_ENV':'"production"'}});
const css=fs.readFileSync('compiled.css','utf8'),js=fs.readFileSync('compiled.js','utf8');
const icon=(name)=>'data:image/svg+xml;base64,'+fs.readFileSync('../ui/brand/'+name).toString('base64');
const icons='<link rel="icon" type="image/svg+xml" media="(prefers-color-scheme: dark)" href="'+icon('WisprNo-icon-mono-dark.svg')+'"><link rel="icon" type="image/svg+xml" media="(prefers-color-scheme: light)" href="'+icon('WisprNo-icon-mono-light.svg')+'">';
const html='<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>WisprNo · Attack map</title>'+icons+'<meta name="theme-color" content="#21182c"><link rel="canonical" href="https://wisprno.us/"><meta name="description" content="The scammer your voice agent hasn’t met yet."><style>'+css+'</style></head><body><div id="root"></div><script>'+js.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html',html);fs.writeFileSync('dist/Faultline.html',html);
console.log('Built self-contained React + Tailwind HTML:',html.length,'bytes');

fs.writeFileSync('dist/Faultline_Hero_Demo.html',html);
