const fs=require("fs");
const token=fs.readFileSync("/tmp/b1-capture/token","utf8").trim();
const H={"Content-Type":"application/json",cookie:`session=${token}`};
const plan=(o)=>({version:1,startingSituation:"",centralConflict:"",goal:"",secret:"",endingConditions:[],majorEvents:[],clues:[],forbiddenEvents:[],boss:"",specialRules:[],difficulty:"normal",climax:"",endingCandidates:[],factionChanges:[],gmDirection:"",playLength:"medium",provenance:null,...o});
const existing={title:"안개 속 사라진 등대",summary:"등대가 꺼진 밤 배가 사라진다.",content:"",secretContent:"",startLocation:"선술집 안개 항아리",startInventory:["손전등"],npcs:[],plan:plan({startingSituation:"등대가 꺼진 항구, 실종된 배 한 척.",centralConflict:"조합과 길드가 서로를 의심한다.",goal:"실종된 배의 진상을 밝힌다.",endingConditions:["진상이 밝혀지고 항구가 안정된다."]}),touchedFields:[]};
const cases=[
 ["partial regen: goal only (selected)",{mode:"regenerate_selected",selectedFields:["goal"],lockedFields:[]}],
 ["partial regen: majorEvents+clues, endings locked",{mode:"regenerate_selected",selectedFields:["majorEvents","clues"],lockedFields:["endingConditions"]}],
 ["regenerate_all with title locked",{mode:"regenerate_all",selectedFields:[],lockedFields:["title"]}],
 ["fill_empty on partially written draft",{mode:"fill_empty",selectedFields:[],lockedFields:[]}],
];
(async()=>{for(const [name,extra] of cases){
 const t0=Date.now();
 const r=await fetch("http://localhost:3203/api/trpg/scenarios/ai-draft",{method:"POST",headers:H,body:JSON.stringify({worldId:null,existingDraft:existing,...extra})});
 const j=await r.json(); const d=j.draft; const p=d?.plan;
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 console.log(name,"|",r.status,((Date.now()-t0)/1000).toFixed(1)+"s","| changed:",(j.changedFields||[]).join(",")||"-", d?`| title kept=${d.title===existing.title} goal kept=${p.goal===existing.plan.goal} endings kept=${same(p.endingConditions,existing.plan.endingConditions)} endingsN=${p.endingConditions.length} loc kept=${d.startLocation===existing.startLocation}`:JSON.stringify(j).slice(0,160));
 await new Promise(r=>setTimeout(r,9000));
}})();
