'use strict';
// Invoke through ../shared/guard.cjs to share the production lock and gate.
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const cli=path.resolve(__dirname,'../node_modules/.bin/remotion');
for(const [composition,frame] of [['ParcelLandscape',90],['ParcelLandscape',450],['ParcelLandscape',980],['ParcelLandscape',1190],['ParcelLandscape',1450],['ParcelPortrait',1190]]){
  const output=path.join(__dirname,'preview-'+composition+'-'+frame+'.png');
  execFileSync(cli,['still',path.join(__dirname,'index.jsx'),composition,output,'--frame='+frame,'--config='+path.resolve(__dirname,'../remotion.config.js'),'--public-dir='+path.join(__dirname,'public'),'--gl=angle','--log=error'],{cwd:root,stdio:'pipe',timeout:120000});
  console.log(JSON.stringify({composition,frame,output}));
}
