import { responseStream } from "./responses";

// Missing requires_client_auth intentionally means gateway-managed credentials.
export const gatewayCatalog = [
  { id: "mixed", models: ["gpt-gateway", "claude-gateway", "vendor/chat-gateway"], compatibility: { openai_responses: true, anthropic_messages: true, openai_chat: true } },
  { id: "aws", models: ["anthropic.claude-gateway-v1:0"], compatibility: { bedrock_converse: true } },
];
export const gatewayModels = [
  { providerID: "aperture-mixed:responses", modelID: "gpt-gateway", path: "/v1/responses", wire: "mixed/gpt-gateway", protocol: "responses" },
  { providerID: "aperture-mixed:messages", modelID: "claude-gateway", path: "/v1/messages", wire: "mixed/claude-gateway", protocol: "messages" },
  { providerID: "aperture-mixed:chat", modelID: "vendor/chat-gateway", path: "/v1/chat/completions", wire: "mixed/vendor/chat-gateway", protocol: "chat" },
  { providerID: "aperture-aws", modelID: "anthropic.claude-gateway-v1:0", path: "/bedrock/model/anthropic.claude-gateway-v1%3A0/converse-stream", protocol: "bedrock" },
] as const;

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function gatewayStream(protocol: string, text: string): Response {
  if (protocol === "responses") return responseStream(text);
  if (protocol === "bedrock") {
    const events = [
      ["messageStart", { role: "assistant" }],
      ["contentBlockDelta", { contentBlockIndex: 0, delta: { text } }],
      ["contentBlockStop", { contentBlockIndex: 0 }],
      ["messageStop", { stopReason: "end_turn" }],
      ["metadata", { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, metrics: { latencyMs: 1 } }],
    ] as const;
    const frames = events.map(([type, payload]) => {
      const headers = Buffer.concat(Object.entries({ ":event-type": type, ":content-type": "application/json", ":message-type": "event" }).map(([name, value]) => {
        const size = Buffer.alloc(2); size.writeUInt16BE(Buffer.byteLength(value));
        return Buffer.concat([Buffer.from([name.length]), Buffer.from(name), Buffer.from([7]), size, Buffer.from(value)]);
      }));
      const body = Buffer.from(JSON.stringify(payload));
      const frame = Buffer.alloc(16 + headers.length + body.length);
      frame.writeUInt32BE(frame.length, 0); frame.writeUInt32BE(headers.length, 4);
      frame.writeUInt32BE(crc32(frame.subarray(0, 8)), 8);
      headers.copy(frame, 12); body.copy(frame, 12 + headers.length);
      frame.writeUInt32BE(crc32(frame.subarray(0, -4)), frame.length - 4);
      return frame;
    });
    return new Response(Buffer.concat(frames), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
  }
  const events = protocol === "messages" ? [
    { type: "message_start", message: { id: "msg_gateway", type: "message", role: "assistant", model: "claude-gateway", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ] : [
    { id: "chat_gateway", object: "chat.completion.chunk", created: 1, model: "chat-gateway", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { id: "chat_gateway", object: "chat.completion.chunk", created: 1, model: "chat-gateway", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ];
  return new Response(events.map(event => `${"type" in event ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join("") + (protocol === "chat" ? "data: [DONE]\n\n" : ""), { headers: { "content-type": "text/event-stream" } });
}
