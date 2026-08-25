import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nock from "nock";
import request from "supertest";
import app from "../server.js";

const SANDBOX = "https://sandbox.safaricom.co.ke";
const PRODUCTION = "https://api.safaricom.co.ke";
const TOKEN_PATH = "/oauth/v1/generate";
const PUSH_PATH = "/mpesa/stkpush/v1/processrequest";

const PAYLOAD = {
  environment: "sandbox",
  shortcode: "174379",
  passkey: "test-passkey",
  consumerKey: "ck",
  consumerSecret: "cs",
  accountType: "Paybill",
  amount: 250,
  phoneNumber: "254700000000"
};

/** Captures the request headers/body Daraja would have received. */
function interceptToken(host = SANDBOX, { token = "token-abc" } = {}) {
  const captured = {};
  nock(host)
    .get(TOKEN_PATH)
    .query({ grant_type: "client_credentials" })
    .reply(function () {
      captured.authorization = this.req.headers.authorization;
      return [200, { access_token: token }];
    });
  return captured;
}

function interceptPush(host = SANDBOX, { status = 200, body = { ResponseCode: "0" } } = {}) {
  const captured = {};
  nock(host)
    .post(PUSH_PATH)
    .reply(function (uri, requestBody) {
      captured.body = requestBody;
      captured.authorization = this.req.headers.authorization;
      return [status, body];
    });
  return captured;
}

beforeEach(() => {
  nock.disableNetConnect();
  nock.enableNetConnect("127.0.0.1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  nock.cleanAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe("POST /stk-push", () => {
  it("returns the Daraja STK push response", async () => {
    interceptToken();
    interceptPush(SANDBOX, { body: { CheckoutRequestID: "ws_CO_1", ResponseCode: "0" } });

    const res = await request(app).post("/stk-push").send(PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ CheckoutRequestID: "ws_CO_1", ResponseCode: "0" });
  });

  it("authenticates against the sandbox host with basic auth", async () => {
    const token = interceptToken();
    interceptPush();

    await request(app).post("/stk-push").send(PAYLOAD);

    expect(token.authorization).toBe(`Basic ${Buffer.from("ck:cs").toString("base64")}`);
  });

  it("uses the production host when the environment is production", async () => {
    interceptToken(PRODUCTION);
    const push = interceptPush(PRODUCTION);

    const res = await request(app)
      .post("/stk-push")
      .send({ ...PAYLOAD, environment: "production" });

    expect(res.status).toBe(200);
    expect(push.body).toBeDefined();
  });

  it("builds the timestamp and password from the shortcode and passkey", async () => {
    interceptToken();
    const push = interceptPush();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5));

    await request(app).post("/stk-push").send(PAYLOAD);

    expect(push.body.Timestamp).toBe("20260102030405");
    expect(push.body.Password).toBe(
      Buffer.from("174379test-passkey20260102030405").toString("base64")
    );
  });

  it("forwards the caller's amount, phone and bearer token", async () => {
    interceptToken(SANDBOX, { token: "token-xyz" });
    const push = interceptPush();

    await request(app).post("/stk-push").send(PAYLOAD);

    expect(push.body).toMatchObject({
      BusinessShortCode: "174379",
      TransactionType: "CustomerPayBillOnline",
      Amount: 250,
      PartyA: "254700000000",
      PartyB: "174379",
      PhoneNumber: "254700000000",
      AccountReference: "AssetGuardPro"
    });
    expect(push.authorization).toBe("Bearer token-xyz");
  });

  it("maps a till account type to a buy goods transaction", async () => {
    interceptToken();
    const push = interceptPush();

    await request(app)
      .post("/stk-push")
      .send({ ...PAYLOAD, accountType: "Till" });

    expect(push.body.TransactionType).toBe("CustomerBuyGoodsOnline");
  });

  it("propagates the Daraja status and payload when the push is rejected", async () => {
    interceptToken();
    interceptPush(SANDBOX, { status: 400, body: { errorMessage: "Invalid Amount" } });

    const res = await request(app).post("/stk-push").send(PAYLOAD);

    expect(res.status).toBe(400);
    expect(res.body.upstream).toEqual({ errorMessage: "Invalid Amount" });
    expect(res.body.error).toBeTruthy();
  });

  it("falls back to the raw error message when the token request fails", async () => {
    nock(SANDBOX)
      .get(TOKEN_PATH)
      .query({ grant_type: "client_credentials" })
      .replyWithError("socket hang up");
    const push = interceptPush();

    const res = await request(app).post("/stk-push").send(PAYLOAD);

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("socket hang up");
    expect(push.body).toBeUndefined();
  });
});

describe("app configuration", () => {
  it("enables CORS for browser callers", async () => {
    interceptToken();
    interceptPush();

    const res = await request(app).post("/stk-push").send(PAYLOAD);

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("does not respond to unknown routes", async () => {
    const res = await request(app).get("/unknown");

    expect(res.status).toBe(404);
  });
});
