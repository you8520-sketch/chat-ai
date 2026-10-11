import { submissionAuthorizesLocation, destinationRefinesDeclared } from "../src/lib/trpg/campaignLedger";
import { declaresTraversalIntent, tokenizeSceneLabel } from "../src/lib/trpg/actionCheckContext";
const cases: Array<[string,string]> = [
 ["승강장에서 대합실로 돌아가 잠긴 역장실 문을 살피고 열쇠 구멍과 문틈을 조사한다.","대합실"],
 ["대합실에서 승강장으로 달려가 다친 동료 앞을 막아서며 사냥꾼의 시선을 끈다.","승강장"],
 ["들은 이야기를 따라 어시장으로 가서 상인들에게 소문에 대해 묻는다.","어시장"],
 ["어시장에서 들은 이야기를 확인하러 선원 조합 회관으로 향한다.","선원 조합 회관"],
 ["알게 된 내용을 확인하러 곶 끝의 등대로 이동한다.","등대"],
 ["렌과 함께 어시장으로 이동해 가판대 사이를 둘러본다.","어시장"],
 ["렌을 따라 선원 조합 회관으로 걸어간다.","선원 조합 회관"],
];
for (const [body,dest] of cases) {
  console.log(JSON.stringify({body:body.slice(0,28),dest,trav:declaresTraversalIntent(body),refines:destinationRefinesDeclared(body,dest),auth:submissionAuthorizesLocation({participantId:1,body,tier:"SUCCESS"},dest),tok:tokenizeSceneLabel(body).slice(0,12)}));
}
