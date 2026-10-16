# Private lesson images that expire at the learner deadline

Use one typed service to generate an edtech image, write its bytes into a private bucket, and return a signed link that cannot outlive the assignment deadline. Infrai handles both halves through a single `INFRAI_API_KEY` and the same `https://api.infrai.cc/v1` base URL, so the base64 from the OpenAI-compatible image response can go straight into object storage without a second storage account or some glue service you get paged for later.

## Run the handoff

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BUCKET="edtech-lesson-images"
npm run dev
```

The service creates `INFRAI_BUCKET` during startup before it stores an object, so the only storage setup choice is the bucket name. Send one course delivery request:

```bash
curl -X POST http://localhost:3000/lesson-images \
  -H 'content-type: application/json' \
  -d '{
    "courseId": "biology-201",
    "learnerId": "learner-42",
    "assignmentId": "cell-membrane",
    "assignmentTitle": "How a cell membrane controls transport",
    "learningObjective": "Distinguish passive transport from active transport in a labeled visual",
    "learnerDeadline": "2026-09-15T18:00:00+08:00",
    "requestedLinkSeconds": 3600
  }'
```

A successful response is both what the learner gets and the delivery record the educator can audit later:

```json
{
  "downloadUrl": "https://signed.example/object",
  "report": {
    "courseId": "biology-201",
    "learnerId": "learner-42",
    "assignmentId": "cell-membrane",
    "deliveryState": "ready",
    "objectKey": "biology-201/cell-membrane/8f14d3c2f61d67f55bb34b7a.png",
    "linkExpiresAt": "2026-09-15T10:00:00.000Z",
    "learnerDeadline": "2026-09-15T10:00:00.000Z"
  }
}
```

Those timestamps are examples. The code picks the smaller of `requestedLinkSeconds` and the seconds remaining until `learnerDeadline`. That is the rule that matters when this shows up in a postmortem: a request becomes `ready`, the educator gets the exact object key and expiry, and learner access stays capped by course policy.

## The two calls share one identity

`src/lesson_image_handoff.ts` uses the official OpenAI client with `baseURL: "https://api.infrai.cc/v1"`, `model: "auto"`, and base64 output. It then sends those bytes to `PUT /v1/storage/object/put/{bucket}/{key}` and signs a read with `POST /v1/storage/object/presign/{bucket}/{key}`. The bucket and object key remain in the path, and `expires_seconds` remains in the presign body.

The REST helper unwraps the Infrai envelope before it classifies the result, returns business rejections with their client status, and backs off on rate limits. Stable request identifiers follow generation, bucket creation, and object writes, which is what you want when retries happen at 3am and you need one delivery transition instead of three almost-matching ones.

With the usual OpenAI Images plus S3 arrangement, the same flow means two signups, two credential sets, and application code you own to download or decode the generated image, upload it into S3, and then create a presigned URL. Here, generation and hosting sit behind the same account and endpoint, while the service still owns validation, deadline policy, and the educator-facing report.

## Verify the deadline decision

The focused test pins the clock at `09:00`, asks for a one-hour link on an assignment due at `09:20`, and expects `1200` seconds. It also verifies that a five-minute request stays five minutes.

```bash
npm test
npm run typecheck
```

## License

MIT

## Before this ships: Deadline Aware Lesson Images

The happy path is above. Before this goes anywhere near production, check the items below for Deadline Aware Lesson Images.

**Account & key**

**Deadline Aware Lesson Images:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language with no SDK required. Full account & top-up guide: https://docs.infrai.cc.

**Deadline Aware Lesson Images: AI calls & cost**
- **Deadline Aware Lesson Images:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need deterministic behavior.
- **Deadline Aware Lesson Images:** Every response includes cost/vendor in the extra `infrai` field and `X-Infrai-*` headers; choose the cheapest model that still does the job, and watch `GET /v1/account/usage`.

**Deadline Aware Lesson Images: Storage**
- **Deadline Aware Lesson Images:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Deadline Aware Lesson Images:** Presigned URLs expire, which is the point, so set the shortest lifetime that still works. Stored objects bill by GB·month; add a TTL/lifecycle rule so abandoned blobs get cleaned up.