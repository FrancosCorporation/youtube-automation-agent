import React,{useLayoutEffect,useMemo} from 'react';
import {useThree} from '@react-three/fiber';
import {staticFile} from 'remotion';
import * as THREE from 'three';
import {RiggedHuman} from '../shared/RiggedHuman';
import motion from './motion.cjs';
import board from './storyboard.json';
const {clamp,span,exitState,receiptState,sortState}=motion;

export function sceneAt(frame){
  const starts=[0,board.sentences[2].startFrame,board.sentences[3].startFrame,board.sentences[4].startFrame,board.sentences[5].startFrame,board.sentences[6].startFrame,board.durationInFrames];
  let shot=0;while(shot<5&&frame>=starts[shot+1])shot++;
  return {shot,p:clamp((frame-starts[shot])/(starts[shot+1]-starts[shot])),label:['IDENTIFICAÇÃO','TRIAGEM POR DESTINO','TRANSPORTE ENTRE UNIDADES','DISTRIBUIÇÃO','ENTREGA AO DESTINATÁRIO','ETAPAS DO RASTREAMENTO'][shot]};
}
function Box({position,size,color='#d2d8ce',rotation,metalness=0}){
  return <mesh position={position} rotation={rotation} castShadow receiveShadow><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={.58} metalness={metalness}/></mesh>;
}
function Parcel({position=[0,.99,0],rotation=[0,0,0]}){return <group position={position} rotation={rotation}>
  <Box size={[.56,.32,.4]} color="#c89557"/><Box position={[0,.163,0]} size={[.09,.006,.4]} color="#e2c38d"/>
  <Box position={[.12,.168,0]} size={[.19,.008,.22]} color="#fff6e3"/>
  {Array.from({length:8},(_,i)=><Box key={i} position={[.055+i*.018,.174,-.015]} size={[i%3===0?.009:.004,.004,.12]} color="#20333a"/>)}
  <Box position={[0,0,.202]} size={[.35,.12,.006]} color="#f6e6c7"/>
</group>;}
function Door({open=0,z=0,house=false}){return <group position={[0,0,z]}>
  <Box position={[-2.1,1.25,0]} size={[2.8,2.5,.18]} color={house?'#d7bea1':'#b2c6bf'}/>
  <Box position={[2.1,1.25,0]} size={[2.8,2.5,.18]} color={house?'#d7bea1':'#b2c6bf'}/>
  <Box position={[0,2.4,0]} size={[1.4,.2,.18]} color="#466561"/>
  {[-1,1].map((side)=><group key={side} position={[side*(.35+.8*open),0,0]}>
    <Box position={[0,1.15,-.01]} size={[.7,2.3,.08]} color={house?'#466b68':'#6a9292'}/>
    <Box position={[-side*.24,1.1,.05]} size={[.035,.25,.04]} color="#e0bc7f"/>
    <Box position={[0,1.7,.04]} size={[.48,.45,.012]} color="#a8c8c4"/>
  </group>)}
</group>;}
function Floor({color='#d5d4bb',width=12,depth=8}){return <Box position={[0,-.08,0]} size={[width,.16,depth]} color={color}/>;}
const male=staticFile('parcel/crew-01.glb'),female=staticFile('parcel/crew-02.glb');
const hands=(z=.43,y=1.04)=>({left:[.27,y,z],right:[-.27,y,z]});
function Receiving({p,seconds}){
  const scan=span(p,.12,.88),scanner=[.08+.19*Math.sin(scan*Math.PI*2),1.27,.12];
  return <><Floor/>
    <Box position={[0,.8,.15]} size={[1.8,.08,.8]} color="#66857a"/>
    {[-.75,.75].map(x=><Box key={x} position={[x,.39,.15]} size={[.08,.78,.6]} color="#4c6461"/>)}
    <Parcel position={[0,1,.12]}/>
    <RiggedHuman src={male} position={[0,0,-.55]} seconds={seconds} hands={{left:[.29,1.02,.57],right:[scanner[0],scanner[1],scanner[2]+.55]}}/>
    <Box position={scanner} size={[.12,.1,.2]} color="#183f49"/>
    <Box position={[scanner[0],1.175,.12]} size={[.1,.008,.15]} color="#a0e1ba"/>
    {[-2.6,-1.4].map(x=><Box key={x} position={[x,1,-1.6]} size={[.05,2,.7]} color="#5a7770"/>)}
    {[.26,.79,1.32].map((y)=><group key={y}><Box position={[-2,y,-1.6]} size={[1.25,.04,.7]} color="#5a7770"/><Parcel position={[-2,y+.18,-1.55]}/></group>)}
  </>;
}
function Sorting({p,seconds}){
  const {x,z}=sortState(p);
  return <><Floor/>
    <Box position={[-.4,.72,0]} size={[5,.16,1.05]} color="#36555a"/>
    {Array.from({length:22},(_,i)=><Box key={i} position={[-2.8+i*.23,.81,0]} size={[.13,.02,1]} color={i%2?'#77908b':'#657e79'}/>)}
    {[-2.4,-.4,1.8].map((xx)=><Box key={xx} position={[xx,.35,0]} size={[.12,.7,.85]} color="#647974"/>)}
    <Box position={[1.8,.72,1]} size={[.8,.16,2.3]} color="#36555a"/>
    {Array.from({length:10},(_,i)=><Box key={i} position={[1.8,.81,.05+i*.21]} size={[.78,.02,.12]} color="#82a597"/>)}
    <Box position={[1.8,.35,1.6]} size={[.7,.7,.12]} color="#647974"/>
    <Parcel position={[x,.98,z]}/>
    <RiggedHuman src={male} position={[-.45,0,-1.3]} seconds={seconds} yaw={.2*Math.sin(p*Math.PI)} hands={{right:[-.12,1.15,.42]}}/>
  </>;
}
function Van({x=0}){return <group position={[x,0,0]}>
  <Box position={[0,.68,0]} size={[2.7,.95,1.1]} color="#88bbaa"/>
  <Box position={[1.48,.53,0]} size={[.75,.65,1.1]} color="#c2d9c3"/>
  <Box position={[1.49,.9,0]} size={[.7,.45,1.06]} color="#7c9ea1"/>
  {[-.85,1.35].flatMap(xx=>[-.6,.6].map(zz=><mesh key={xx+':'+zz} position={[xx,.32,zz]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.28,.28,.16,20]}/><meshStandardMaterial color="#253840"/></mesh>))}
  <Box position={[0,1.18,0]} size={[.8,.07,.5]} color="#e3c394"/>
</group>;}
function Transport({p}){return <><Floor width={16} depth={9} color="#7c9b87"/>
  <Box position={[0,.015,0]} size={[15,.035,2]} color="#52636b"/>
  {Array.from({length:15},(_,i)=><Box key={i} position={[-7+i, .04,0]} size={[.5,.01,.05]} color="#ead8aa"/>)}
  <Van x={-4.3+8.6*span(p,.06,.93)}/>
  {[-5.4,5.4].map((x)=><group key={x} position={[x,0,-2.5]}><Box position={[0,.8,0]} size={[2.2,1.6,1.5]} color="#d4d4bc"/><Box position={[0,1.7,0]} size={[2.4,.2,1.7]} color="#527a74"/><Box position={[0,.65,.76]} size={[.8,1.3,.04]} color="#54757c"/></group>)}
</>;}
function Distribution({p,seconds}){const s=exitState(p);return <>
  <Floor/><Door open={s.door}/>
  <Box position={[0,.01,1.4]} size={[1.1,.02,2.6]} color="#adbb9b"/>
  <RiggedHuman src={male} position={[0,0,s.z]} seconds={seconds} walk={s.walk} distance={s.travel} hands={hands()}/>
  <Parcel position={[0,1.04,s.z+.43]}/>
</>;}
function Delivery({p,seconds}){const s=receiptState(p);
  const hold=hands(.43,1.04),courierHands=p<.83?hold:null;
  return <><Floor color="#b8c7ae"/><Door z={-1} open={s.door} house/>
    <Box position={[0,.005,1]} size={[2,.018,4.5]} color="#d2c5a8"/>
    <Box position={[-2,.7,-.87]} size={[.85,.85,.03]} color="#6c9c9a"/>
    <RiggedHuman src={male} seconds={seconds} position={[s.courierX,0,1]} yaw={Math.PI-(Math.PI/2)*span(p,.83,.89)} walk={s.leave>0&&s.leave<1} distance={s.courierX} hands={courierHands}/>
    <RiggedHuman src={female} seconds={seconds} phase={.7} position={[0,0,s.recipientZ]} walk={p>.3&&p<.56} distance={1.8*s.arrive} hands={p>.56?hands(s.parcelZ-s.recipientZ,1.04):null}/>
    <Parcel position={[0,1.04,s.parcelZ]}/>
  </>;}
function Tracking({p}){
  const event=Math.min(3,Math.floor(p*4));
  const texture=useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=960;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#e6eada';ctx.fillRect(0,0,640,960);
    ctx.fillStyle='#183e49';ctx.font='bold 44px Arial';ctx.fillText('Seu envio',55,95);
    ctx.font='22px Arial';ctx.fillText('Consulta ilustrativa',55,138);
    ['Identificação','Triagem','Transporte','Entrega'].forEach((label,i)=>{
      ctx.fillStyle=i<=event?'#397e68':'#83938e';ctx.beginPath();ctx.arc(78,255+i*155,17,0,Math.PI*2);ctx.fill();
      ctx.font='bold 33px Arial';ctx.fillText(label,120,266+i*155);
      ctx.font='21px Arial';ctx.fillText(i<=event?'Etapa registrada':'Aguardando registro',120,304+i*155);
      if(i<3){ctx.fillRect(75,280+i*155,6,105);}
    });
    ctx.fillStyle='#3d5d5d';ctx.font='20px Arial';ctx.fillText('Confira endereço e CEP no envio.',45,900);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return map;
  },[event]);
  return <><Floor/>
    <group position={[0,.98,0]} rotation={[0,-.13,0]}>
      <Box size={[1.18,1.95,.11]} color="#20363e"/>
      <mesh position={[0,0,.061]}><planeGeometry args={[1.08,1.7]}/><meshBasicMaterial map={texture}/></mesh>
      <Box position={[0,.92,.062]} size={[.23,.03,.006]} color="#93a9a5"/>
    </group>
  </>;
}
export function ParcelScene({frame,portrait=false}){
  const {shot,p}=sceneAt(frame),seconds=frame/30,{camera}=useThree();
  useLayoutEffect(()=>{
    const views=[[[2.7,2.2,4.3],[0,1,0]],[[5,3.4,7],[0,.8,0]],[[7,6,9],[0,.6,-.4]],[[3,2.5,4.5],[0,1,.2]],[[2.8,2.3,4],[0,1,.4]],[[.9,1.6,3.3],[0,1,0]]];
    const [from,target]=views[shot],drift=.16*Math.sin(p*Math.PI);
    camera.position.set(from[0]*(portrait?1.22:1)+drift,from[1]*(portrait?1.12:1),from[2]*(portrait?1.22:1));
    camera.lookAt(...target);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  },[camera,shot,p,portrait]);
  return <><color attach="background" args={['#17343e']}/><ambientLight intensity={1.25}/><hemisphereLight args={['#f3ead3','#526d73',1]}/>
    <directionalLight position={[-4,8,6]} intensity={2.1} color="#ffeed3" castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9}/>
    <directionalLight position={[5,4,-2]} intensity={.8} color="#93c2cf"/>
    {shot===0?<Receiving p={p} seconds={seconds}/>:shot===1?<Sorting p={p} seconds={seconds}/>:shot===2?<Transport p={p}/>:shot===3?<Distribution p={p} seconds={seconds}/>:shot===4?<Delivery p={p} seconds={seconds}/>:<Tracking p={p}/>}
  </>;
}
