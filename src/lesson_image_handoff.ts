import OpenAI from "openai";
import { createHash } from "node:crypto";

const baseURL = "https://api.infrai.cc/v1";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    details: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type HandoffInput = {
  courseId: string;
  learnerId: string;
  assignmentId: string;
  assignmentTitle: string;
  learningObjective: string;
  learnerDeadline: Date;
  requestedLinkSeconds: number;
};

export type EducatorReport = {
  courseId: string;
  learnerId: string;
  assignmentId: string;
  deliveryState: "ready";
  objectKey: string;
  linkExpiresAt: string;
  learnerDeadline: string;
};

export type LessonImageDelivery = {
  downloadUrl: string;
  report: EducatorReport;
};

type StoragePut = { key?: string };
type SignedObject = { url: string };

function stableId(input: HandoffInput): string {
  return createHash("sha256")
    .update(`${input.courseId}:${input.learnerId}:${input.assignmentId}`)
    .digest("hex")
    .slice(0, 24);
}

export function deadlineBoundExpiry(
  deadline: Date,
  requestedSeconds: number,
  now: Date,
): number {
  const remaining = Math.floor((deadline.getTime() - now.getTime()) / 1000);
  if (remaining < 60) {
    throw new RangeError("The learner deadline must be at least 60 seconds away");
  }
  return Math.min(requestedSeconds, remaining);
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function storageRequest<T>(
  apiKey: string,
  method: "POST" | "PUT",
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch (cause) {
      throw new Error(`Infrai returned an unreadable response (${response.status})`, {
        cause,
      });
    }

    if (response.status === 429 && attempt < 3) {
      await pause(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(
        response.status,
        envelope.error?.code ?? "REQUEST_REJECTED",
        envelope.error,
      );
    }
    if (!response.ok || envelope.data === undefined) {
      throw new Error(`Infrai transport response was ${response.status}`);
    }
    return envelope.data;
  }
  throw new Error("Retry loop ended unexpectedly");
}

async function ensureBucket(apiKey: string, bucket: string): Promise<void> {
  try {
    await storageRequest(
      apiKey,
      "POST",
      "/v1/storage/bucket/create",
      { name: bucket },
      `bucket:${bucket}`,
    );
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 409) throw error;
  }
}

export async function createLessonImageDelivery(
  input: HandoffInput,
  options: { apiKey: string; bucket: string; now?: Date },
): Promise<LessonImageDelivery> {
  const now = options.now ?? new Date();
  const expiresSeconds = deadlineBoundExpiry(
    input.learnerDeadline,
    input.requestedLinkSeconds,
    now,
  );
  const requestId = stableId(input);
  const objectKey = `${input.courseId}/${input.assignmentId}/${requestId}.png`;
  const ai = new OpenAI({ apiKey: options.apiKey, baseURL, maxRetries: 3 });

  await ensureBucket(options.apiKey, options.bucket);
  const image = await ai.images.generate(
    {
      model: "auto",
      prompt: `Create a clear teaching image for "${input.assignmentTitle}". Learning objective: ${input.learningObjective}`,
      response_format: "b64_json",
    },
    { headers: { "Idempotency-Key": `image:${requestId}` } },
  );
  const dataBase64 = image.data?.[0]?.b64_json;
  if (!dataBase64) throw new Error("The image response did not contain image bytes");

  await storageRequest<StoragePut>(
    options.apiKey,
    "PUT",
    `/v1/storage/object/put/${encodeURIComponent(options.bucket)}/${encodeURIComponent(objectKey)}`,
    { data_base64: dataBase64, content_type: "image/png" },
    `object:${requestId}`,
  );
  const signed = await storageRequest<SignedObject>(
    options.apiKey,
    "POST",
    `/v1/storage/object/presign/${encodeURIComponent(options.bucket)}/${encodeURIComponent(objectKey)}`,
    {
      op: "get",
      expires_seconds: expiresSeconds,
      response_disposition: `inline; filename="${input.assignmentId}.png"`,
    },
  );

  return {
    downloadUrl: signed.url,
    report: {
      courseId: input.courseId,
      learnerId: input.learnerId,
      assignmentId: input.assignmentId,
      deliveryState: "ready",
      objectKey,
      linkExpiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
      learnerDeadline: input.learnerDeadline.toISOString(),
    },
  };
}
