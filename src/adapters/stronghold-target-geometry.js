// Enemy hit detection and deployment occupancy are intentionally separate.
export function targetGeometry(scene) {
  const boss=(scene.targetShape??'point')==='boss';
  const row=Number(scene.targetRow),col=Number(scene.targetCol);
  const keys=[];const blocked=[];const flanks=[];
  if(boss){for(let r=row;r<=row+2;r++)for(let c=col-2;c<=col+2;c++){keys.push(r*21+c);(Math.abs(c-col)<2?blocked:flanks).push(r*21+c);}}
  else keys.push(row*21+col);
  return {boss,keys,blocked,flanks,hitArea:boss?{w:4.95,h:2.95,dx:0,dy:1}:null,
    contains:(r,c)=>keys.includes(r*21+c),blocks:(r,c)=>blocked.includes(r*21+c),flank:(r,c)=>flanks.includes(r*21+c)};
}
