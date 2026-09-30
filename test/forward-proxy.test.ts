import { expect, test } from "bun:test";
import { createServer, request } from "node:http";
import { connect, createServer as createTcpServer } from "node:net";
import { createForwardProxy } from "../scripts/fixtures/forward-proxy";

test("HTTP proxy authenticates, restricts destinations and paths, and strips private/hop headers", async () => {
  let hits = 0;
  const upstream = createServer((req, res) => {
    hits++;
    expect(req.headers["proxy-authorization"]).toBeUndefined();
    expect(req.headers["x-aperture-relay-capability"]).toBeUndefined();
    expect(req.headers["x-hop"]).toBeUndefined();
    res.setHeader("connection", "x-response-hop");
    res.setHeader("x-response-hop", "private");
    req.pipe(res);
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  const target = `http://127.0.0.1:${address.port}`;
  const proxy = await createForwardProxy(new URL(target));
  const url = new URL(proxy.url);
  const auth = `Basic ${Buffer.from(`${url.username}:${url.password}`).toString("base64")}`;
  function rawStatus(path: string, authorization = auth) {
    return new Promise<number>((resolve, reject) => {
      const socket = connect({ host: url.hostname, port: Number(url.port) });
      let data = "";
      socket.setTimeout(2_000, () => socket.destroy(new Error("Test request timeout")));
      socket.on("error", reject);
      socket.on("data", chunk => {
        data += chunk.toString();
        if (data.includes("\r\n")) {
          resolve(Number(data.split(" ")[1]));
          socket.destroy();
        }
      });
      socket.on("connect", () => socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${url.host}\r\nProxy-Authorization: ${authorization}\r\nConnection: close\r\n\r\n`,
      ));
    });
  }
  function send(path: string, authorization?: string) {
    return new Promise<{ status: number; body: string; hop: unknown }>((resolve, reject) => {
      const req = request({
        hostname: url.hostname, port: url.port, path, method: "POST",
        headers: {
          ...(authorization ? { "proxy-authorization": authorization } : {}),
          "x-aperture-relay-capability": "synthetic",
          connection: "x-hop", "x-hop": "private",
        },
        agent: false,
      }, res => {
        let body = "";
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, body, hop: res.headers["x-response-hop"] }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end("streamed body");
    });
  }
  try {
    expect((await send(`${target}/api/providers`)).status).toBe(407);
    expect((await send(`${target}/api/providers`, "Basic wrong")).status).toBe(407);
    for (const path of [
      "/api/providers", `${target}/other`, `${target}/api/providers?x=1`,
      `${target}/api/providers#fragment`, `${target.replace("http:", "https:")}/api/providers`,
      `http://localhost:${address.port}/api/providers`, "http://127.0.0.1:1/api/providers",
      `${target.replace("http://", "http://user:pass@")}/api/providers`,
    ]) expect(await rawStatus(path), path).toBe(403);
    expect(hits).toBe(0);
    for (const path of ["/api/providers", "/codex/responses"]) {
      expect(await send(`${target}${path}`, auth)).toEqual({ status: 200, body: "streamed body", hop: undefined });
    }
    expect(hits).toBe(2);
    const response = await fetch(`${target}/api/providers`, { proxy: proxy.url, method: "POST", body: "bun proxy" });
    expect(await response.text()).toBe("bun proxy");
  } finally {
    await proxy.close();
    await proxy.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});

test("CONNECT authenticates and restricts authority, preserves head bytes, and closes live tunnels", async () => {
  let hits = 0;
  const upstream = createTcpServer(socket => {
    hits++;
    socket.pipe(socket);
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  const authority = `127.0.0.1:${address.port}`;
  const proxy = await createForwardProxy(new URL(`https://${authority}`));
  const httpProxy = await createForwardProxy(new URL(`http://${authority}`));
  async function tunnel(proxyUrl: string, host: string, authenticated: boolean, payload = "") {
    const url = new URL(proxyUrl);
    const auth = Buffer.from(`${url.username}:${url.password}`).toString("base64");
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    const response = await new Promise<string>((resolve, reject) => {
      let data = "";
      socket.setTimeout(2_000, () => socket.destroy(new Error("Test tunnel timeout")));
      socket.on("error", reject);
      socket.on("data", chunk => {
        data += chunk.toString();
        if (data.includes("\r\n\r\n") && (!payload || data.endsWith(payload))) resolve(data);
      });
      socket.on("connect", () => socket.write(
        `CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\n${authenticated ? `Proxy-Authorization: Basic ${auth}\r\n` : ""}\r\n${payload}`,
      ));
    });
    return { socket, response };
  }
  try {
    for (const [proxyUrl, host, authenticated, status] of [
      [proxy.url, authority, false, 407],
      [proxy.url, "127.0.0.1:1", true, 403],
      [httpProxy.url, authority, true, 403],
    ] as const) {
      const result = await tunnel(proxyUrl, host, authenticated);
      expect(result.response.startsWith(`HTTP/1.1 ${status}`)).toBe(true);
      result.socket.destroy();
    }
    expect(hits).toBe(0);
    const { socket, response } = await tunnel(proxy.url, authority, true, "synthetic tunnel bytes");
    expect(response).toBe("HTTP/1.1 200 Connection Established\r\n\r\nsynthetic tunnel bytes");
    expect(hits).toBe(1);
    const disconnected = new Promise<void>(resolve => socket.once("close", resolve));
    await proxy.close();
    await disconnected;
  } finally {
    await proxy.close();
    await httpProxy.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});

test("fixture rejects non-loopback or non-root target configuration", async () => {
  for (const target of [
    "http://localhost:1234", "http://192.0.2.1", "ftp://127.0.0.1",
    "http://user:pass@127.0.0.1", "http://127.0.0.1/base",
    "http://127.0.0.1/?query", "http://127.0.0.1/#hash",
  ]) await expect(createForwardProxy(new URL(target))).rejects.toThrow("Invalid proxy fixture target");
});

test("HTTP cancellation and fixture disposal terminate streaming upstream requests", async () => {
  let upstreamClosed = () => {};
  const upstream = createTcpServer(socket => {
    socket.on("close", () => upstreamClosed());
    socket.once("data", () => socket.write(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nb\r\nfirst chunk\r\n",
    ));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  const target = `http://127.0.0.1:${address.port}`;
  const proxy = await createForwardProxy(new URL(target));
  try {
    for (const dispose of [false, true]) {
      const disconnected = new Promise<void>(resolve => { upstreamClosed = resolve; });
      const url = new URL(proxy.url);
      const auth = Buffer.from(`${url.username}:${url.password}`).toString("base64");
      const client = connect({ host: url.hostname, port: Number(url.port) });
      await new Promise<void>((resolve, reject) => {
        let data = "";
        client.on("error", reject);
        client.on("data", chunk => {
          data += chunk.toString();
          if (data.includes("first chunk")) resolve();
        });
        client.on("connect", () => client.write(
          `GET ${target}/codex/responses HTTP/1.1\r\nHost: ${url.host}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`,
        ));
      });
      const clientClosed = new Promise<void>(resolve => client.once("close", resolve));
      if (dispose) {
        await proxy.close();
      } else client.destroy();
      await clientClosed;
      await disconnected;
    }
  } finally {
    await proxy.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});

test("disposal closes clients with incomplete headers", async () => {
  const proxy = await createForwardProxy(new URL("http://127.0.0.1:1"));
  const url = new URL(proxy.url);
  const client = connect({ host: url.hostname, port: Number(url.port) });
  try {
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    client.write("GET /api/providers HTTP/1.1\r\n");
    const disconnected = new Promise<void>(resolve => client.once("close", resolve));
    await proxy.close();
    await disconnected;
  } finally {
    client.destroy();
    await proxy.close();
  }
});
