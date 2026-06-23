/**
 * PENDING 출금 큐를 수동으로 1회 처리 (개발·운영 점검용)
 * 사용: npm run payout:run
 */
import { processPayoutQueue } from "../src/lib/payoutQueue";

processPayoutQueue()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
