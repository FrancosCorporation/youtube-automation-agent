'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {exitState,receiptState,sortState}=require('./motion.cjs');
// Conservative actor envelope includes bent elbows and the carried parcel.
// This gate covers these authored paths/doors, not arbitrary mesh topology.
function checkDoorPassage({z,door,wallZ=0,halfWidth=.48,halfDepth=.32}) {
  const inDoor=Math.abs(z-wallZ)<halfDepth+.09;
  return !inDoor || .8*door>=halfWidth+.04;
}
function validate(){
  const problems=[];let checked=0;
  for(let frame=0;frame<=1800;frame++){
    const p=frame/1800,s=exitState(p),r=receiptState(p);
    for(const item of [
      {name:'courier body',z:s.z,door:s.door},
      {name:'carried parcel',z:s.z+.43,door:s.door,halfWidth:.28,halfDepth:.2},
      {name:'recipient body',z:r.recipientZ,door:r.door,wallZ:-1},
    ]){checked++;if(!checkDoorPassage(item))problems.push({frame,subject:item.name});}
    const separation=Math.hypot(r.courierX,1-r.recipientZ);
    if(separation<.72)problems.push({frame,subject:'human bodies overlap'});
    const parcel=sortState(p);
    for(const dx of [-.28,.28])for(const dz of [-.2,.2]){
      const x=parcel.x+dx,z=parcel.z+dz;
      const supported=(x>=-2.9&&x<=2.1&&Math.abs(z)<=.525)||(x>=1.4&&x<=2.2&&z>=-.15&&z<=2.15);
      if(!supported)problems.push({frame,subject:'parcel leaves conveyor support'});
    }
  }
  return {status:problems.length?'failed':'passed',sampledStates:checked,problems,
    scope:'Conservative body/parcel envelopes against authored doors and mutual body separation; not a universal mesh/contact or aesthetic audit.'};
}
if(require.main===module){
  const report=validate();fs.mkdirSync(path.join(__dirname,'reports'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'reports/staging-qa.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));if(report.status!=='passed')process.exitCode=1;
}
module.exports={checkDoorPassage,validate};
