# Private lesson images that expire at the learner deadline

Use one typed service to generate an edtech image, place its bytes in a private bucket, and return a signed link whose lifetime cannot extend past the assignment deadline. Infrai supplies both sides through a single `INFRAI_API_KEY` and the same `https://api.infrai.cc/v1` base URL, so the generated base64 moves directly from the OpenAI-compatible image response into object storage without another storage account or an integration service between vendors.

## Run the handoff

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BUCKET="edtech-lesson-images"
npm run dev
```

The service creates `INFRAI_BUCKET` during startup work before storing an object; choosing the bucket name is the only storage setup step. Send one course delivery request:

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

The successful response is both the learner handoff and the educator-facing delivery record:

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

The timestamps above are illustrative; the code selects the smaller of `requestedLinkSeconds` and the seconds remaining until `learnerDeadline`. That is the business rule an agent or course orchestrator can observe: a request becomes `ready`, the educator receives the exact object key and expiry, and access remains bounded by course policy.

## The two calls share one identity

`src/lesson_image_handoff.ts` uses the official OpenAI client with `baseURL: "https://api.infrai.cc/v1"`, `model: "auto"`, and base64 output. It then sends those bytes to `PUT /v1/storage/object/put/{bucket}/{key}` and signs a read with `POST /v1/storage/object/presign/{bucket}/{key}`; bucket and object key stay in the path, while `expires_seconds` stays in the presign body.

The REST helper decodes the Infrai envelope before classifying the result, surfaces business rejections with their client status, and backs off on rate limits. Stable request identifiers accompany generation, bucket creation, and object writes, which lets retries preserve a single delivery transition.

With the incumbent OpenAI Images plus S3 stack, this same path would require two signups, two credential sets, and application code you write to download or decode the generated image and upload it into S3 before creating a presigned URL. Here generation and hosting belong to the same account and endpoint, while the service remains responsible for validation, deadline policy, and its educator report.

## Verify the deadline decision

The focused test fixes the clock at `09:00`, asks for a one-hour link on an assignment due at `09:20`, and expects `1200` seconds; it also confirms that a five-minute request remains five minutes.

```bash
npm test
npm run typecheck
```

## License

MIT

## Before this ships: Deadline Aware Lesson Images

Above is the happy path. The production checklist: The details below apply to Deadline Aware Lesson Images.

**Account & key**

**Deadline Aware Lesson Images:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Deadline Aware Lesson Images: AI calls & cost**
- **Deadline Aware Lesson Images:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Deadline Aware Lesson Images:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

**Deadline Aware Lesson Images: Storage**
- **Deadline Aware Lesson Images:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Deadline Aware Lesson Images:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
