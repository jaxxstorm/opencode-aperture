export const model = "gpt-5.5";
export const catalog = [{ id: "synthetic-subscription", models: [model], requires_client_auth: true, compatibility: { openai_responses: true } }];
export const toolName = "aperture_fixture";
export const callId = "call_aperture_fixture";
export const toolResult = "APERTURE_TOOL_RESULT_7";

export function responseStream(text: string, tool = false): Response {
  const id = `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const item = tool
    ? { id: "fc_fixture", type: "function_call", call_id: callId, name: toolName, arguments: "{}", status: "completed" }
    : { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
  const response = { id, object: "response", created_at: 1, model, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events: Record<string, unknown>[] = [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", ...(tool ? { arguments: "" } : { content: [] }) } },
  ];
  if (tool) events.push(
    { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: "{}" },
    { type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: "{}" },
  );
  else events.push(
    { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: text },
    { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text },
    { type: "response.content_part.done", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text, annotations: [] } },
  );
  events.push({ type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response });
  return new Response(events.map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
