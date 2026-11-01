'use strict';
const sceneRoi=portrait=>portrait?[40,330,1000,1050]:[40,240,1460,620];
function sceneFreezeFilter(portrait=false){
  const [x,y,width,height]=sceneRoi(portrait);
  return 'crop='+[width,height,x,y].join(':')+',freezedetect=n=-80dB:d=3';
}
module.exports={sceneRoi,sceneFreezeFilter};
