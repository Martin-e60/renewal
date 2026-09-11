import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import Stripe from "stripe";
import { createBilling } from "../server/billing.js";
test("Stripe lifecycle: signatures, checkout reuse, paid entitlement, portal and cancellation", async () => {
  let subscriptions = [],
    sessions = [],
    customers = 0;
  const canceled = [];
  const fake = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = new URLSearchParams(raw),
      url = new URL(req.url, "http://test");
    let result;
    if (url.pathname === "/v1/prices/price_month")
      result = {
        id: "price_month",
        active: true,
        type: "recurring",
        billing_scheme: "per_unit",
        currency: "eur",
        unit_amount: 499,
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "licensed",
        },
      };
    else if (url.pathname === "/v1/customers" && req.method === "POST")
      result = { id: "cus_" + ++customers };
    else if (url.pathname.startsWith("/v1/customers/"))
      result = { id: url.pathname.split("/").at(-1) };
    else if (url.pathname === "/v1/subscriptions")
      result = {
        object: "list",
        data: subscriptions,
        has_more: false,
        url: "/v1/subscriptions",
      };
    else if (
      url.pathname.startsWith("/v1/subscriptions/") &&
      req.method === "DELETE"
    ) {
      canceled.push(url.pathname.split("/").at(-1));
      subscriptions = subscriptions.map((s) => ({ ...s, status: "canceled" }));
      result = subscriptions[0];
    } else if (
      url.pathname === "/v1/checkout/sessions" &&
      req.method === "POST"
    ) {
      result = {
        id: "cs_" + (sessions.length + 1),
        url: "https://checkout.stripe.com/test",
        status: "open",
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      };
      sessions.push(result);
    } else if (url.pathname === "/v1/checkout/sessions")
      result = {
        object: "list",
        data: sessions.filter((s) => s.status === "open"),
        has_more: false,
        url: "/v1/checkout/sessions",
      };
    else if (url.pathname.endsWith("/expire")) {
      result = sessions.find((s) => url.pathname.includes(s.id));
      result.status = "expired";
    } else if (url.pathname.startsWith("/v1/checkout/sessions/"))
      result = sessions.find((s) => url.pathname.endsWith(s.id));
    else if (url.pathname === "/v1/billing_portal/sessions") {
      assert.equal(body.get("customer"), "cus_1");
      result = { url: "https://billing.stripe.com/test" };
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: { message: req.url } }));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  const keys = [
      "NODE_ENV",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_MONTHLY",
      "STRIPE_TEST_API_BASE",
    ],
    old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_PRICE_MONTHLY: "price_month",
    STRIPE_TEST_API_BASE: `http://127.0.0.1:${fake.address().port}`,
  });
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);CREATE TABLE account_data(user_id INTEGER,payload TEXT)",
  );
  let user = { id: 1, email: "a@example.test", name: "Test" };
  const billing = createBilling({
    db,
    appOrigin: "https://app.example",
    json: (res, status, data) => {
      res.status = status;
      res.data = data;
    },
    getCurrentUser: () => user,
    readBody: async (req) => req.body || {},
    rateLimited: () => false,
  });
  const call = async (path, body, method = body ? "POST" : "GET") => {
    const res = {};
    await billing.handle(
      { method, body },
      res,
      new URL(path, "https://app.example"),
    );
    return res;
  };
  try {
    assert.equal((await call("/api/billing/plans")).data.plans[0].amount, 499);
    assert.equal((await call("/api/pro/insights")).status, 403);
    assert.equal(
      (await call("/api/billing/checkout", { priceId: "evil" })).status,
      400,
    );
    assert.equal(
      (await call("/api/billing/checkout", { priceId: "price_month" })).status,
      200,
    );
    assert.equal(
      (await call("/api/billing/checkout", { priceId: "price_month" })).status,
      200,
    );
    assert.equal(sessions.length, 1);
    assert.equal(customers, 1);
    subscriptions = [
      {
        id: "sub_1",
        status: "active",
        created: 1,
        items: {
          data: [
            {
              price: { id: "price_month" },
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        },
      },
    ];
    const webhook = async (id, signature = true) => {
      const payload = JSON.stringify({
        id,
        type: "invoice.paid",
        livemode: false,
        data: { object: { customer: "cus_1" } },
      });
      const req = {
        method: "POST",
        headers: {
          "stripe-signature": signature
            ? Stripe.webhooks.generateTestHeaderString({
                payload,
                secret: "whsec_fixture",
              })
            : "bad",
        },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(payload);
        },
      };
      const res = {};
      await billing.webhook(req, res);
      return res;
    };
    assert.equal((await webhook("evt_bad", false)).status, 400);
    assert.equal(billing.summary(1).pro, false);
    assert.equal((await webhook("evt_1")).status, 200);
    assert.equal(billing.summary(1).pro, true);
    assert.equal((await webhook("evt_1")).status, 200);
    assert.equal(
      (await call("/api/billing/checkout", { priceId: "price_month" })).status,
      409,
    );
    assert.equal((await call("/api/billing/portal", {})).status, 200);
    subscriptions[0].status = "past_due";
    await webhook("evt_2");
    assert.equal(billing.summary(1).pro, false);
    subscriptions[0].status = "active";
    await call("/api/billing/refresh", {});
    assert.equal(billing.summary(1).pro, true);
    await billing.deleteAccount(1, () =>
      db.prepare("DELETE FROM users WHERE id=1").run(),
    );
    assert.deepEqual(canceled, ["sub_1"]);
    assert.equal(sessions[0].status, "expired");
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM billing_accounts").get().n,
      0,
    );
    user = null;
    assert.equal((await call("/api/billing/status")).status, 401);
  } finally {
    db.close();
    await new Promise((r) => fake.close(r));
    for (const k of keys)
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
  }
});
