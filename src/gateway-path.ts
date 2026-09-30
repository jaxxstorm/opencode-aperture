// Validate raw request targets before URL parsing can normalize traversal or slashes.
export function resolveGatewayPath(path: string): { pathname: string; managed: boolean } | undefined {
  if (path === "/codex/responses") return { pathname: path, managed: false };
  const match = /^\/(gateway|forward)(\/[^?#]*)(?:\?([^#]*))?$/.exec(path);
  if (!match) return;
  const managed = match[1] === "gateway";
  const pathname = match[2]!;
  const fixed = /^\/v1\/(responses|chat\/completions|messages)$/.test(pathname);
  const bedrock = /^\/bedrock\/model\/([^/]+)\/converse(?:-stream)?$/.exec(pathname);
  const google = /^\/v1beta\/models\/([^/]+):(generateContent|streamGenerateContent)$/.exec(pathname);
  if (!fixed && !bedrock && !google) return;
  const model = bedrock?.[1] ?? google?.[1];
  if (model !== undefined) {
    if (!/^(?:[A-Za-z0-9_.~!$&'()*+,;=:@-]|%[0-9a-fA-F]{2})+$/.test(model)) return;
    try {
      const decoded = decodeURIComponent(model);
      if (/[\\?#%\s\x00-\x1f\x7f]/.test(decoded) || decoded.split("/").some(v => !v || v === "." || v === "..")) return;
    } catch { return; }
  }
  if (match[3] === undefined) return { pathname, managed };
  if (!google || !match[3]) return;
  const query = new URLSearchParams(match[3]);
  const seen = new Set<string>();
  for (const [key, value] of query) {
    if (seen.has(key)) return;
    seen.add(key);
    if (key === "alt" && value === "sse" && google[2] === "streamGenerateContent") continue;
    // Managed SDK query credentials are discarded, never sent to the gateway.
    if (key === "key" && managed && value && !/[\x00-\x1f\x7f]/.test(value)) continue;
    return;
  }
  return { pathname: pathname + (seen.has("alt") ? "?alt=sse" : ""), managed };
}
