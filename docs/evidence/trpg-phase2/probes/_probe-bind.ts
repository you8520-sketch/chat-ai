import { submissionAuthorizesLocation, destinationRefinesDeclared } from "../src/lib/trpg/campaignLedger";
const cases: Array<[string,string,string]> = [
 ["R3","어시장에서 들은 이야기를 확인하러 선원 조합 회관으로 향한다.","선원 조합 회관"],
 ["R5","알게 된 내용을 확인하러 곶 끝의 등대로 이동한다.","곶 끝의 등대 외곽"],
 ["R5b","알게 된 내용을 확인하러 곶 끝의 등대로 이동한다.","곶 끝의 등대"],
 ["R6","등대 위로 올라가 바다 쪽을 살핀다.","곶 끝의 등대 내부"],
 ["R7","지금까지 알아낸 것을 정리하고, 다음에 가 볼 곳을 정해 세관으로 향한다.","세관 청사 1층"],
 ["R7b","지금까지 알아낸 것을 정리하고, 다음에 가 볼 곳을 정해 세관으로 향한다.","세관"],
 ["R9","세관에서 얻은 단서를 들고 다시 어시장으로 돌아가 아까 만난 사람을 찾는다.","어시장"],
 ["R9b","세관에서 얻은 단서를 들고 다시 어시장으로 돌아가 아까 만난 사람을 찾는다.","마레노 어시장 외곽 부두"],
];
for (const [k,b,d] of cases) console.log(k, "refines=",destinationRefinesDeclared(b,d), "authorizes=",submissionAuthorizesLocation({participantId:1,body:b,tier:null,acceptedRoute:null} as never,d), "|",d);
