'use strict';
const clamp=(x)=>Math.max(0,Math.min(1,x));
const smooth=(x)=>{x=clamp(x);return x*x*(3-2*x);};
const span=(p,a,b)=>smooth((p-a)/(b-a));
function exitState(p){
  const open=span(p,0,.18)*(1-span(p,.93,1));
  const travel=span(p,.25,.85);
  return {door:open,z:-1.6+3.4*travel,travel:3.4*travel,walk:p>.25&&p<.85};
}
function receiptState(p){
  const arrive=span(p,.3,.56),handover=span(p,.61,.79),leave=span(p,.86,1);
  return {door:span(p,.08,.25),recipientZ:-1.8+1.8*arrive,arrive,handover,leave,courierX:1.3*leave,parcelZ:.45-.03*handover};
}
function sortState(p){return {x:-2.4+4.2*span(p,.05,.63),z:1.65*span(p,.65,.93)};}
module.exports={clamp,smooth,span,exitState,receiptState,sortState};
