import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import {
  createLessonImageDelivery,
  InfraiError,
} from "./lesson_image_handoff";

const requestSchema = z.object({
  courseId: z.string().min(1).max(80),
  learnerId: z.string().min(1).max(80),
  assignmentId: z.string().min(1).max(80),
  assignmentTitle: z.string().min(3).max(160),
  learningObjective: z.string().min(10).max(800),
  learnerDeadline: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  requestedLinkSeconds: z.number().int().min(60).max(86_400).default(3_600),
});

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 32_768) throw new RangeError("Request body is too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const bucket = process.env.INFRAI_BUCKET ?? "edtech-lesson-images";
const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/lesson-images") {
    json(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const input = requestSchema.parse(await readJson(request));
    const delivery = await createLessonImageDelivery(
      { ...input, learnerDeadline: input.learnerDeadline! },
      { apiKey, bucket },
    );
    json(response, 201, delivery);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError) {
      json(response, 400, { error: "Invalid lesson image request" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      json(response, error.status, { error: error.code });
      return;
    }
    console.error(error);
    json(response, 502, { error: "Upstream request failed" });
  }
});

server.listen(port, () => {
  console.log(`Course delivery service listening on http://localhost:${port}`);
});
